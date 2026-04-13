import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  const origin = process.env.CORS_ORIGIN || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', origin !== '*' ? 'true' : 'false');
}

function json(res, statusCode, data) {
  setCors(res);
  return res.status(statusCode).json(data);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }
  return req.body;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstPositiveNumber(values) {
  for (const value of values) {
    const n = toNumber(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function intervalOverlaps(aStart, aEnd, bStart, bEnd) {
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

function expandExistingRecurringContract(contract) {
  const startAt = contract.start_at || contract.startAt;
  const endAt = contract.end_at || contract.endAt;

  if (!startAt || !endAt) return [];

  const unit = (contract.recurrence_unit || contract.recurrenceUnit || 'weekly').toLowerCase();
  const recurrenceMonths = toNumber(contract.recurrence_months ?? contract.recurrenceMonths) || 0;
  const recurrenceCount =
    toNumber(contract.recurrence_count ?? contract.recurrenceCount) ||
    (recurrenceMonths > 0 ? recurrenceMonths * 4 : 1);

  if (unit !== 'weekly') {
    return [
      {
        start_at: new Date(startAt),
        end_at: new Date(endAt),
      },
    ];
  }

  return buildWeeklyIntervals(startAt, endAt, recurrenceCount);
}

async function tryInsert(table, payloads) {
  let lastError = null;

  for (const payload of payloads) {
    const { data, error } = await supabase.from(table).insert(payload).select('*').single();

    if (!error && data) return data;

    lastError = error;
  }

  throw lastError;
}

async function tryUpdate(table, id, payloads) {
  let lastError = null;

  for (const payload of payloads) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (!error && data) return data;

    lastError = error;
  }

  return { error: lastError };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.STRIPE_SECRET_KEY) {
      return json(res, 500, {
        error: 'Missing required environment variables',
      });
    }

    const body = parseBody(req);

    const propertyId = toNumber(body.property_id ?? body.propertyId);
    const userId = toNumber(body.user_id ?? body.userId);
    const startAt = body.start_at ?? body.startAt;
    const endAt = body.end_at ?? body.endAt;
    const modeFromClient = (body.mode || '').toLowerCase();
    const recurrenceUnit = (body.recurrence_unit ?? body.recurrenceUnit ?? 'weekly').toLowerCase();

    const recurrenceMonthsRaw = body.recurrence_months ?? body.recurrenceMonths;
    const recurrenceMonths = recurrenceMonthsRaw !== undefined && recurrenceMonthsRaw !== null && recurrenceMonthsRaw !== ''
      ? toNumber(recurrenceMonthsRaw)
      : null;

    const customerEmail = body.customer_email ?? body.customerEmail ?? null;
    const customerName = body.customer_name ?? body.customerName ?? null;

    if (!propertyId || !startAt || !endAt) {
      return json(res, 400, {
        error: 'property_id, start_at and end_at are required',
      });
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return json(res, 400, {
        error: 'Invalid start_at or end_at',
      });
    }

    if (endDate <= startDate) {
      return json(res, 400, {
        error: 'end_at must be greater than start_at',
      });
    }

    const propertySelect = await supabase
      .from('properties')
      .select('id, title, name, address, currency, price_per_hour, hourly_rate, hourly_price, price')
      .eq('id', propertyId)
      .single();

    if (propertySelect.error || !propertySelect.data) {
      return json(res, 404, {
        error: 'Property not found',
      });
    }

    const property = propertySelect.data;

    const pricePerHour = firstPositiveNumber([
      property.price_per_hour,
      property.hourly_rate,
      property.hourly_price,
      property.price,
      body.price_per_hour,
      body.hourly_rate,
      body.hourly_price,
    ]);

    if (!pricePerHour) {
      return json(res, 400, {
        error: 'Unable to determine price_per_hour for this property',
      });
    }

    const durationHours = (endDate.getTime() - startDate.getTime()) / 36e5;
    const weeklyAmountCents = Math.max(1, Math.round(durationHours * pricePerHour * 100));

    const hasRecurringRequest =
      recurrenceMonths !== null ||
      modeFromClient === 'subscription';

    const checkoutMode = hasRecurringRequest ? 'subscription' : 'payment';

    const normalizedRecurrenceMonths = hasRecurringRequest
      ? Math.min(12, Math.max(1, toNumber(recurrenceMonths) || 1))
      : 0;

    if (hasRecurringRequest && recurrenceUnit !== 'weekly') {
      return json(res, 400, {
        error: 'Only weekly recurrence is supported',
      });
    }

    const recurrenceCount = hasRecurringRequest ? normalizedRecurrenceMonths * 4 : 1;
    const monthlyAmountCents = weeklyAmountCents * 4;
    const totalAmountCents = checkoutMode === 'subscription'
      ? monthlyAmountCents
      : weeklyAmountCents;

    const requestedIntervals = buildWeeklyIntervals(startAt, endAt, recurrenceCount);
    const requestWindowStart = requestedIntervals[0].start_at;
    const requestWindowEnd = requestedIntervals[requestedIntervals.length - 1].end_at;

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
        .lt('start_at', requestWindowEnd.toISOString())
        .gt('end_at', requestWindowStart.toISOString()),

      supabase
        .from('recurring_contracts')
        .select('id, start_at, end_at, status, recurrence_unit, recurrence_count, recurrence_months')
        .eq('property_id', propertyId)
        .in('status', activeContractStatuses),
    ]);

    if (bookingsRes.error) {
      return json(res, 500, {
        error: 'Error checking bookings conflicts',
        details: bookingsRes.error.message,
      });
    }

    if (contractsRes.error) {
      return json(res, 500, {
        error: 'Error checking recurring contracts conflicts',
        details: contractsRes.error.message,
      });
    }

    const conflicts = [];

    for (const existing of bookingsRes.data || []) {
      const existingStart = new Date(existing.start_at);
      const existingEnd = new Date(existing.end_at);

      for (const requested of requestedIntervals) {
        if (intervalOverlaps(requested.start_at, requested.end_at, existingStart, existingEnd)) {
          conflicts.push({
            source: 'bookings',
            id: existing.id,
            start_at: existing.start_at,
            end_at: existing.end_at,
          });
          break;
        }
      }

      if (conflicts.length) break;
    }

    if (!conflicts.length) {
      for (const contract of contractsRes.data || []) {
        const expanded = expandExistingRecurringContract(contract);

        for (const existing of expanded) {
          for (const requested of requestedIntervals) {
            if (intervalOverlaps(requested.start_at, requested.end_at, existing.start_at, existing.end_at)) {
              conflicts.push({
                source: 'recurring_contracts',
                id: contract.id,
                start_at: contract.start_at,
                end_at: contract.end_at,
              });
              break;
            }
          }

          if (conflicts.length) break;
        }

        if (conflicts.length) break;
      }
    }

    if (conflicts.length) {
      return json(res, 409, {
        error: 'Schedule conflict detected',
        conflict: conflicts[0],
      });
    }

    const bookingStatus = checkoutMode === 'subscription' ? 'pending_subscription' : 'pending_payment';

    const bookingInsertVariants = [
      {
        property_id: propertyId,
        user_id: userId,
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        status: bookingStatus,
        recurrence_unit: hasRecurringRequest ? 'weekly' : null,
        recurrence_months: hasRecurringRequest ? normalizedRecurrenceMonths : null,
        recurrence_count: hasRecurringRequest ? recurrenceCount : null,
        weekly_amount_cents: weeklyAmountCents,
        monthly_amount_cents: hasRecurringRequest ? monthlyAmountCents : null,
        total_amount_cents: totalAmountCents,
      },
      {
        property_id: propertyId,
        user_id: userId,
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        status: bookingStatus,
      },
    ];

    const booking = await tryInsert('bookings', bookingInsertVariants);

    const frontendUrl = (process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:3000').replace(/\/$/, '');
    const successUrl = `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/checkout/cancel?booking_id=${booking.id}`;

    const propertyLabel = property.title || property.name || property.address || `Espaço ${propertyId}`;
    const currency = String(property.currency || body.currency || 'brl').toLowerCase();

    const sessionPayload = {
      mode: checkoutMode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail || undefined,
      client_reference_id: String(booking.id),
      locale: 'pt-BR',
      metadata: {
        booking_id: String(booking.id),
        property_id: String(propertyId),
        user_id: userId ? String(userId) : '',
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        recurrence_unit: hasRecurringRequest ? 'weekly' : '',
        recurrence_months: hasRecurringRequest ? String(normalizedRecurrenceMonths) : '',
        recurrence_count: hasRecurringRequest ? String(recurrenceCount) : '',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: totalAmountCents,
            product_data: {
              name: propertyLabel,
              description: hasRecurringRequest
                ? `Locação semanal recorrente (${normalizedRecurrenceMonths} mês(es))`
                : 'Reserva de espaço',
            },
            ...(checkoutMode === 'subscription'
              ? {
                  recurring: {
                    interval: 'month',
                  },
                }
              : {}),
          },
        },
      ],
      ...(checkoutMode === 'subscription'
        ? {
            subscription_data: {
              metadata: {
                booking_id: String(booking.id),
                property_id: String(propertyId),
                recurrence_unit: 'weekly',
                recurrence_months: String(normalizedRecurrenceMonths),
                recurrence_count: String(recurrenceCount),
              },
            },
          }
        : {
            payment_intent_data: {
              metadata: {
                booking_id: String(booking.id),
                property_id: String(propertyId),
              },
            },
          }),
    };

    const checkoutSession = await stripe.checkout.sessions.create(sessionPayload);

    await tryUpdate('bookings', booking.id, [
      {
        stripe_checkout_session_id: checkoutSession.id,
        stripe_checkout_session_url: checkoutSession.url,
        status: bookingStatus,
      },
      {
        status: bookingStatus,
      },
    ]);

    return json(res, 200, {
      url: checkoutSession.url,
      checkout_session_id: checkoutSession.id,
      booking_id: booking.id,
      mode: checkoutMode,
      weekly_amount_cents: weeklyAmountCents,
      monthly_amount_cents: monthlyAmountCents,
      recurrence_months: normalizedRecurrenceMonths,
      recurrence_count: recurrenceCount,
    });
  } catch (error) {
    return json(res, 500, {
      error: 'Internal server error',
      details: error?.message || String(error),
    });
  }
}
