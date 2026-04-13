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

function pickPositiveNumber(...values) {
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

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY || !STRIPE_SECRET_KEY) {
      return sendJson(res, 500, {
        error: 'Missing required environment variables',
        details: {
          has_supabase_url: !!SUPABASE_URL,
          has_supabase_key: !!SUPABASE_KEY,
          has_stripe_secret_key: !!STRIPE_SECRET_KEY,
        },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const stripe = new Stripe(STRIPE_SECRET_KEY);

    const body = parseBody(req);

    const propertyId = Number(body.property_id);
    const startAt = new Date(body.start_at);
    const endAt = new Date(body.end_at);
    const recurrenceMonths = Number(body.recurrence_months || 0);

    if (!propertyId || !startAt || !endAt) {
      return sendJson(res, 400, { error: 'Missing required fields' });
    }

    // 🔥 BUSCA PROPERTY (CORRIGIDO AQUI)
    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('id, title, address, currency, price_per_hour, price')
      .eq('id', propertyId)
      .single();

    if (propError || !property) {
      return sendJson(res, 404, { error: 'Property not found' });
    }

    const pricePerHour = property.price_per_hour || property.price;

    if (!pricePerHour) {
      return sendJson(res, 400, { error: 'Property has no price' });
    }

    const durationHours = (endAt - startAt) / 36e5;
    const weeklyAmount = Math.round(durationHours * pricePerHour * 100);

    const isRecurring = recurrenceMonths > 0;
    const monthlyAmount = weeklyAmount * 4;

    const requestedIntervals = buildWeeklyIntervals(
      startAt,
      endAt,
      isRecurring ? recurrenceMonths * 4 : 1
    );

    // 🔥 CONFLICT CHECK
    const { data: bookings } = await supabase
      .from('bookings')
      .select('start_at, end_at')
      .eq('property_id', propertyId);

    for (const existing of bookings || []) {
      for (const reqInt of requestedIntervals) {
        if (
          overlap(
            reqInt.start_at,
            reqInt.end_at,
            new Date(existing.start_at),
            new Date(existing.end_at)
          )
        ) {
          return sendJson(res, 409, { error: 'Schedule conflict detected' });
        }
      }
    }

    // 🔥 CRIA BOOKING
    const { data: booking } = await supabase
      .from('bookings')
      .insert({
        property_id: propertyId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: 'pending',
      })
      .select()
      .single();

    // 🔥 STRIPE
    const session = await stripe.checkout.sessions.create({
      mode: isRecurring ? 'subscription' : 'payment',
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: property.currency || 'brl',
            unit_amount: isRecurring ? monthlyAmount : weeklyAmount,
            product_data: {
              name: property.title || property.address,
            },
            ...(isRecurring && {
              recurring: { interval: 'month' },
            }),
          },
        },
      ],
    });

    return sendJson(res, 200, {
      url: session.url,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, {
      error: 'Internal server error',
      details: err.message,
    });
  }
};
