const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function setCors(res) {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY || !STRIPE_SECRET_KEY) {
      return sendJson(res, 500, { error: 'Missing env vars' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const stripe = new Stripe(STRIPE_SECRET_KEY);

    const body = parseBody(req);

    const propertyId = toNumber(body.property_id);
    const startAt = new Date(body.start_at);
    const endAt = new Date(body.end_at);
    const recurrenceMonths = toNumber(body.recurrence_months) || 0;

    if (!propertyId || !startAt || !endAt) {
      return sendJson(res, 400, { error: 'Missing required fields' });
    }

    // 🔥 Buscar imóvel
    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .single();

    if (propError || !property) {
      return sendJson(res, 404, { error: 'Property not found' });
    }

    const pricePerHour =
      property.price_per_hour ||
      property.hourly_rate ||
      property.price;

    if (!pricePerHour) {
      return sendJson(res, 400, { error: 'Property has no price' });
    }

    const durationHours = (endAt - startAt) / 36e5;
    const weeklyAmount = Math.round(durationHours * pricePerHour * 100);

    const isRecurring = recurrenceMonths > 0;
    const monthlyAmount = weeklyAmount * 4;

    // 🔥 Criar booking
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

    const frontendUrl =
      process.env.FRONTEND_URL || 'https://liberoom.com.br';

    // 🔥 STRIPE (CORRIGIDO AQUI)
    const session = await stripe.checkout.sessions.create({
      mode: isRecurring ? 'subscription' : 'payment',
      success_url: `${frontendUrl}/pagamento-sucesso`,
      cancel_url: `${frontendUrl}/pagamento-cancelado`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: property.currency || 'brl',
            unit_amount: isRecurring ? monthlyAmount : weeklyAmount,
            product_data: {
              name: property.title || 'Reserva de espaço',
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
      booking_id: booking.id,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, {
      error: 'Internal server error',
      details: err.message,
    });
  }
};
