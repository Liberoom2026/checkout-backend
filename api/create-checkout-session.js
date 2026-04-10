import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getPeriodPrice(property, period) {
  if (period === "morning") return toNumber(property.price_morning);
  if (period === "afternoon") return toNumber(property.price_afternoon);
  if (period === "evening") return toNumber(property.price_evening);
  return 0;
}

function calcAmountCents(property, body) {
  const type = body.reservation_type || "time";

  const pricePerHour = toNumber(property.price_per_hour);
  const pricePerDay = toNumber(property.price_per_day);
  const pricePerMonth = toNumber(property.price_per_month);

  let amount = 0;

  switch (type) {
    case "time":
      amount = pricePerHour * toNumber(body.duration_hours, 1);
      break;

    case "period": {
      const fixed = getPeriodPrice(property, body.period);
      if (fixed > 0) {
        amount = fixed;
      } else {
        amount = pricePerHour * toNumber(body.duration_hours, 4);
      }
      break;
    }

    case "day":
      amount = pricePerDay * toNumber(body.days_count, 1);
      break;

    case "full_property":
      amount = pricePerMonth * toNumber(body.months_count, 3);
      break;

    default:
      throw new Error("Tipo de reserva inválido");
  }

  const cents = Math.round(amount * 100);

  if (!cents || cents <= 0) {
    throw new Error("Valor inválido");
  }

  return cents;
}

// 🔥 BUSCA NO SPACES (CORRIGIDO)
async function fetchProperty(propertyId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/spaces?id=eq.${propertyId}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Erro ao buscar imóvel: ${raw}`);
  }

  const data = raw ? JSON.parse(raw) : [];

  if (!data[0]) {
    throw new Error("Imóvel não encontrado");
  }

  return data[0];
}

// 🔥 CRIA BOOKING
async function createBooking(body, amount) {
  const payload = {
    property_id: body.property_id,
    guest_name: body.guest_name,
    guest_email: body.guest_email,
    phone: body.phone || null,
    date: body.date || null,
    reservation_type: body.reservation_type,
    period: body.period || null,
    duration_hours: body.duration_hours || null,
    days_count: body.days_count || null,
    months_count: body.months_count || null,
    billing_mode: body.billing_mode || "one_time",
    total_amount: amount,
    price_cents: Math.round(amount * 100),
    currency: "brl",
    status: "pending",
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Erro ao criar booking");
  }

  return data[0];
}

// 🔥 SALVA SESSION
async function updateBooking(id, sessionId) {
  await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stripe_session_id: sessionId,
    }),
  });
}

// 🔥 HANDLER
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const body = req.body;

    const property = await fetchProperty(body.property_id);

    const amountCents = calcAmountCents(property, body);
    const amount = amountCents / 100;

    const booking = await createBooking(body, amount);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: body.guest_email,
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: property.title || "Reserva",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: booking.id.toString(),
      },
      success_url: "https://liberoom.com.br/pagamento-sucesso",
      cancel_url: "https://liberoom.com.br/pagamento-cancelado",
    });

    await updateBooking(booking.id, session.id);

    return res.status(200).json({
      url: session.url,
      session_id: session.id,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message || "Erro interno",
    });
  }
}
