const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function setCors(res) {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', origin !== '*' ? 'true' : 'false');
}

function sendJson(res, status, data) {
  setCors(res);
  return res.status(status).json(data);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = toNumber(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function buildWeeklyIntervals(startAt, endAt, count) {
  const baseStart = new Date(startAt);
  const baseEnd = new Date(endAt);

  return Array.from({ length: count }, (_, index) => {
    const shift = index * WEEK_MS;
    return {
      start_at: new Date(baseStart.getTime() + shift),
      end_at: new Date(baseEnd.getTime() + shift),
    };
  });
}

function expandRecurringContract(contract) {
  const startAt = contract.start_at;
  const endAt = contract.end_at;
  if (!startAt || !endAt) return [];

  const recurrenceMonths = Number(contract.recurrence_months || 0);
  const recurrenceCount =
    Number(contract.recurrence_count) ||
    (recurrenceMonths > 0 ? recurrenceMonths * 4 : 1);

  return buildWeeklyIntervals(startAt, endAt, recurrenceCount);
}

async function insertBookingWithFallback(supabase, payloads) {
  let lastError = null;

  for (const payload of payloads) {
    const { data, error } = await supabase.from('bookings').insert(payload).select('*').single();
    if (!error && data) return data;
    lastError = error;
  }

  throw lastError || new Error('Failed to create booking');
}

async function updateBookingWithFallback(supabase, bookingId, payloads) {
  let lastError = null;

  for (const payload of payloads) {
    const { data, error } = await supabase
      .from('bookings')
      .update(payload)
      .eq('id', bookingId)
      .select('*')
      .single();

    if (!error && data) return data;
    lastError = error;
  }

  return { error: lastError };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY;
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY || !STRIPE_SECRET_KEY) {
      return sendJson(res, 500, {
        error: 'Missing required environment variables',
        details: {
          has_supabase_url: !!SUPABASE_URL,
          has_supabase_key: !!SUPABASE_KEY,
          has_stripe_secret_key: !!STRIPE_SECRET_KEY,
          supabase_url_hint: SUPABASE_URL ? SUPABASE_URL.slice(0, 25) : null,
        },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const stripe = new Stripe(STRIPE_SECRET_KEY);

    const body = parseBody(req);

    const propertyId = toNumber(body.property_id ?? body.propertyId);
    const startAtRaw = body.start_at ?? body.startAt;
    const endAtRaw = body.end_at ?? body.endAt;
    const recurrenceMonthsRaw = body.recurrence_months ?? body.recurrenceMonths;
    const recurrenceUnit = String(body.recurrence_unit ?? body.recurrenceUnit ?? 'weekly').toLowerCase();
    const modeFromClient = String(body.mode ?? '').toLowerCase();
    const customerEmail = body.customer_email ?? body.customerEmail ?? null;

    if (!propertyId || !startAtRaw || !endAtRaw) {
      return sendJson(res, 400, {
        error: 'property_id, start_at and end_at are required',
      });
    }

    const startAt = new Date(startAtRaw);
    const endAt = new Date(endAtRaw);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return sendJson(res, 400, {
        error: 'Invalid start_at or end_at',
      });
    }

    if (endAt <= startAt) {
      return sendJson(res, 400, {
        error: 'end_at must be greater than start_at',
      });
    }

    const propertyRes = await supabase
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .single();

    if (propertyRes.error || !propertyRes.data) {
      return sendJson(res, 404, {
        error: 'Property not found',
        details: propertyRes.error?.message || null,
        property_id: propertyId,
      });
    }

    const property = propertyRes.data;

    const pricePerHour = firstPositiveNumber(
      property.price_per_hour,
      property.hourly_rate,
      property.hourly_price,
      property.price,
      body.price_per_hour,
      body.hourly_rate,
      body.hourly_price
    );

    if (!pricePerHour) {
      return sendJson(res, 400, {
        error: 'Unable to determine price_per_hour for this property',
      });
    }

    const durationHours = (endAt.getTime() - startAt.getTime()) / 36e5;
    const weeklyAmountCents = Math.max(1, Math.round(durationHours * pricePerHour * 100));

    const recurrenceRequested =
      modeFromClient === 'subscription' ||
      (recurrenceMonthsRaw !== undefined && recurrenceMonthsRaw !== null && recurrenceMonthsRaw !== '');

    const recurrenceMonths = recurrenceRequested
      ? Math.min(12, Math.max(1, toNumber(recurrenceMonthsRaw) || 1))
      : 0;

    if (recurrenceRequested && recurrenceUnit !== 'weekly') {
      return sendJson(res, 400, {
        error: 'Only weekly recurrence is supported',
      });
    }

    const recurrenceCount = recurrenceRequested ? recurrenceMonths * 4 : 1;
    const monthlyAmountCents = weeklyAmountCents * 4;
    const totalAmountCents = recurrenceRequested ? monthlyAmountCents : weeklyAmountCents;
    const checkoutMode = recurrenceRequested ? 'subscription' : 'payment';

    const requestedIntervals = buildWeeklyIntervals(startAt, endAt, recurrenceCount);
    const requestedWindowStart = requestedIntervals[0].start_at;
    const requestedWindowEnd = requestedIntervals[requestedIntervals.length - 1].end_at;

    const activeBookingStatuses = [
      'pending',
      'pending_payment',
      'awaiting_payment',
      'reserved',
      'confirmed',
      'paid',
      'active',
      'scheduled',
    ];

    const activeContractStatuses = [
      'pending',
      'confirmed',
      'active',
      'scheduled',
    ];

    const [bookingsRes, contractsRes] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, start_at, end_at, status')
        .eq('property_id', propertyId)
        .in('status', activeBookingStatuses)
        .lt('start_at', requestedWindowEnd.toISOString())
        .gt('end_at', requestedWindowStart.toISOString()),

      supabase
        .from('recurring_contracts')
        .select('id, start_at, end_at, status, recurrence_unit, recurrence_count, recurrence_months')
        .eq('property_id', propertyId)
        .in('status', activeContractStatuses),
    ]);

    if (bookingsRes.error) {
      return sendJson(res, 500, {
        error: 'Error checking bookings conflicts',
        details: bookingsRes.error.message,
      });
    }

    if (contractsRes.error) {
      return sendJson(res, 500, {
        error: 'Error checking recurring contracts conflicts',
        details: contractsRes.error.message,
      });
    }

    for (const booking of bookingsRes.data || []) {
      const existingStart = new Date(booking.start_at);
      const existingEnd = new Date(booking.end_at);

      for (const requested of requestedIntervals) {
        if (overlap(requested.start_at, requested.end_at, existingStart, existingEnd)) {
          return sendJson(res, 409, {
            error: 'Schedule conflict detected',
            conflict: {
              source: 'bookings',
              id: booking.id,
              start_at: booking.start_at,
              end_at: booking.end_at,
            },
          });
        }
      }
    }

    for (const contract of contractsRes.data || []) {
      const expanded = expandRecurringContract(contract);

      for (const existing of expanded) {
        for (const requested of requestedIntervals) {
          if (overlap(requested.start_at, requested.end_at, existing.start_at, existing.end_at)) {
            return sendJson(res, 409, {
              error: 'Schedule conflict detected',
              conflict: {
                source: 'recurring_contracts',
                id: contract.id,
                start_at: contract.start_at,
                end_at: contract.end_at,
              },
            });
          }
        }
      }
    }

    const booking = await insertBookingWithFallback(supabase, [
      {
        property_id: propertyId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: 'pending',
        recurrence_unit: recurrenceRequested ? 'weekly' : null,
        recurrence_months: recurrenceRequested ? recurrenceMonths : null,
        recurrence_count: recurrenceRequested ? recurrenceCount : null,
      },
      {
        property_id: propertyId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: 'pending',
      },
    ]);

    const frontendUrl = String(
      process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:3000'
    ).replace(/\/$/, '');

    const propertyLabel =
      firstString(
        property.title,
        property.name,
        property.space_name,
        property.label,
        property.address,
        property.location
      ) || `Espaço ${propertyId}`;

    const currency = String(property.currency || 'brl').toLowerCase();

    const sessionOptions = {
      mode: checkoutMode,
      success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/checkout/cancel?booking_id=${booking.id}`,
      client_reference_id: String(booking.id),
      locale: 'pt-BR',
      metadata: {
        booking_id: String(booking.id),
        property_id: String(propertyId),
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        recurrence_unit: recurrenceRequested ? 'weekly' : '',
        recurrence_months: recurrenceRequested ? String(recurrenceMonths) : '',
        recurrence_count: recurrenceRequested ? String(recurrenceCount) : '',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: totalAmountCents,
            product_data: {
              name: propertyLabel,
              description: recurrenceRequested
                ? `Locação semanal recorrente (${recurrenceMonths} mês(es))`
                : 'Reserva de espaço',
            },
            ...(checkoutMode === 'subscription'
              ? { recurring: { interval: 'month' } }
              : {}),
          },
        },
      ],
    };

    if (customerEmail) {
      sessionOptions.customer_email = customerEmail;
    }

    if (checkoutMode === 'subscription') {
      sessionOptions.subscription_data = {
        metadata: {
          booking_id: String(booking.id),
          property_id: String(propertyId),
          recurrence_unit: 'weekly',
          recurrence_months: String(recurrenceMonths),
          recurrence_count: String(recurrenceCount),
        },
      };
    } else {
      sessionOptions.payment_intent_data = {
        metadata: {
          booking_id: String(booking.id),
          property_id: String(propertyId),
        },
      };
    }

    const checkoutSession = await stripe.checkout.sessions.create(sessionOptions);

    const updateRes = await updateBookingWithFallback(supabase, booking.id, [
      {
        stripe_checkout_session_id: checkoutSession.id,
        stripe_checkout_session_url: checkoutSession.url,
      },
      {
        stripe_checkout_session_id: checkoutSession.id,
      },
      {
        status: 'pending',
      },
    ]);

    if (updateRes.error) {
      return sendJson(res, 500, {
        error: 'Booking created but failed to update checkout session',
        details: updateRes.error.message,
      });
    }

    return sendJson(res, 200, {
      url: checkoutSession.url,
      checkout_session_id: checkoutSession.id,
      booking_id: booking.id,
      mode: checkoutMode,
      weekly_amount_cents: weeklyAmountCents,
      monthly_amount_cents: monthlyAmountCents,
      recurrence_months: recurrenceMonths,
      recurrence_count: recurrenceCount,
    });
  } catch (error) {
    console.error('create-checkout-session error:', error);
    return sendJson(res, 500, {
      error: 'Internal server error',
      details: error?.message || String(error),
    });
  }
};
