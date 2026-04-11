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

function safeDate(value) {
  if (!value || value === "") return null;
  return value;
}

function calcAmountCents(property, body) {
  const type = body.reservation_type || "time";

  const pricePerHour = toNumber(property.price_per_hour);
  const pricePerDay = toNumber(property.price_per_day);
  const pricePerMonth = toNumber(property.price_per_month);
  const minMonthsFullRental = Math.max(
    3,
    toPositiveInt(property.min_months_full_rental) || 3
  );

  const durationHours = toPositiveInt(body.duration_hours);
  const daysCount = toPositiveInt(body.days_count) || 1;
  const monthsCount = toPositiveInt(body.months_count);
  const fixedPeriodPrice = getPeriodPrice(property, body.period);

  let amountBRL = 0;

  switch (type) {
    case "time": {
      const hours = durationHours || 1;

      if (pricePerHour > 0) {
        amountBRL = pricePerHour * hours;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço por hora não configurado");
      }
      break;
    }

    case "period": {
      const hours = durationHours || 4;

      if (fixedPeriodPrice > 0) {
        amountBRL = fixedPeriodPrice * daysCount;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * hours * daysCount;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço do período não configurado");
      }
      break;
    }

    case "day": {
      const days = daysCount || 1;

      if (pricePerDay > 0) {
        amountBRL = pricePerDay * days;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * 8 * days;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço por diária não configurado");
      }
      break;
    }

    case "full_property": {
      if (!monthsCount) {
        throw new Error("months_count é obrigatório para reservation_type=full_property");
      }

      if (monthsCount < minMonthsFullRental) {
        throw new Error(
          `Imóvel completo exige no mínimo ${minMonthsFullRental} meses`
        );
      }

      if (pricePerMonth > 0) {
        amountBRL = pricePerMonth * monthsCount;
      } else if (pricePerDay > 0) {
        amountBRL = pricePerDay * 30 * monthsCount;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * 8 * 30 * monthsCount;
      } else if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço mensal não configurado");
      }
      break;
    }

    default: {
      if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Tipo de reserva inválido");
      }
    }
  }

  const amountCents = Math.round(amountBRL * 100);

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Valor calculado inválido");
  }

  return amountCents;
}

async function fetchProperty(propertyId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error("Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE ausentes");
  }

  const selectFields = "id,title,price_per_hour,price_per_day,price_per_month,price_morning,price_afternoon,price_evening,min_months_full_rental";

  // 1) tenta spaces
  let res = await fetch(
    `${SUPABASE_URL}/rest/v1/spaces?id=eq.${propertyId}&select=${encodeURIComponent(selectFields)}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );

  let raw = await res.text();

  if (!res.ok) {
    // 2) fallback para properties, se o projeto ainda usar esse nome em algum lugar
    res = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?id=eq.${propertyId}&select=${encodeURIComponent(selectFields)}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        },
      }
    );

    raw = await res.text();

    if (!res.ok) {
      throw new Error(`Erro ao buscar imóvel: ${raw}`);
    }
  }

  const data = raw ? JSON.parse(raw) : [];
  const property = data?.[0];

  if (!property) {
    throw new Error("Imóvel não encontrado");
  }

  return property;
}

async function createBooking(body, amount) {
  const payload = {
    property_id: body.property_id || null,
    guest_name: body.guest_name || "Cliente",
    guest_email: body.guest_email || null,
    phone: body.phone || null,
    date: safeDate(body.date),
    start_at: safeDate(body.start_at),
    end_at: safeDate(body.end_at),
    reservation_type: body.reservation_type || "time",
    period: body.period || null,
    duration_hours: body.duration_hours ? Number(body.duration_hours) : null,
    days_count: body.days_count ? Number(body.days_count) : null,
    months_count: body.months_count ? Number(body.months_count) : null,
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

  const raw = await res.text();
  let data;

  try {
    data = raw ? JSON.parse(raw) : [];
  } catch {
    throw new Error(`Erro ao criar booking: ${raw}`);
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || raw || "Erro ao criar booking");
  }

  const booking = Array.isArray(data) ? data[0] : data;

  if (!booking?.id) {
    throw new Error("Booking criado sem ID");
  }

  return booking;
}

async function updateBookingStripeSession(bookingId, sessionId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
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

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`Erro ao salvar stripe_session_id no booking: ${raw}`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: "Variáveis de ambiente ausentes",
      });
    }

    const body = req.body || {};

    if (!body.property_id) {
      return res.status(400).json({
        error: "property_id é obrigatório",
      });
    }

    const property = await fetchProperty(body.property_id);
    const amountCents = calcAmountCents(property, body);
    const amountBRL = amountCents / 100;

    const booking = await createBooking(body, amountBRL);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: body.guest_email || undefined,
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
        booking_id: String(booking.id),
        property_id: String(body.property_id || ""),
        guest_name: String(body.guest_name || "Cliente"),
        guest_email: String(body.guest_email || ""),
        phone: String(body.phone || ""),
        date: String(body.date || ""),
        start_at: String(body.start_at || ""),
        end_at: String(body.end_at || ""),
        reservation_type: String(body.reservation_type || "time"),
        period: String(body.period || ""),
        duration_hours: String(body.duration_hours || ""),
        days_count: String(body.days_count || ""),
        months_count: String(body.months_count || ""),
        billing_mode: String(body.billing_mode || "one_time"),
      },
      success_url: "https://liberoom.com.br/pagamento-sucesso",
      cancel_url: "https://liberoom.com.br/pagamento-cancelado",
    });

    await updateBookingStripeSession(booking.id, session.id);

    return res.status(200).json({
      url: session.url,
      session_id: session.id,
      amount_cents: amountCents,
      booking_id: booking.id,
    });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({
      error: err.message || "Erro interno",
    });
  }
}
