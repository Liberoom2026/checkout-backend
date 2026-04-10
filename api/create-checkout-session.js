import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

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
  const reservationType = body.reservation_type || "time";
  const period = body.period;
  const durationHours = toPositiveInt(body.duration_hours);
  const daysCount = toPositiveInt(body.days_count);
  const monthsCount = toPositiveInt(body.months_count);

  const pricePerHour = toNumber(property?.price_per_hour);
  const pricePerDay = toNumber(property?.price_per_day);
  const pricePerMonth = toNumber(property?.price_per_month);
  const minMonthsFullRental = Math.max(
    3,
    toPositiveInt(property?.min_months_full_rental) || 3
  );

  let amountBRL = 0;

  switch (reservationType) {
    case "time": {
      if (!durationHours) {
        throw new Error("duration_hours é obrigatório para reservation_type=time");
      }

      if (pricePerHour > 0) {
        amountBRL = pricePerHour * durationHours;
      } else if (body.amount) {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço por hora não configurado");
      }
      break;
    }

    case "period": {
      if (!period) {
        throw new Error("period é obrigatório para reservation_type=period");
      }

      const fixedPeriodPrice = getPeriodPrice(property, period);

      if (fixedPeriodPrice > 0) {
        amountBRL = fixedPeriodPrice;
      } else if (pricePerHour > 0) {
        const fallbackHours =
          durationHours ||
          (period === "morning" ? 4 : period === "afternoon" ? 4 : 4);
        amountBRL = pricePerHour * fallbackHours;
      } else if (body.amount) {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço do período não configurado");
      }
      break;
    }

    case "day": {
      if (!daysCount) {
        throw new Error("days_count é obrigatório para reservation_type=day");
      }

      if (pricePerDay > 0) {
        amountBRL = pricePerDay * daysCount;
      } else if (pricePerHour > 0) {
        amountBRL = pricePerHour * 8 * daysCount;
      } else if (body.amount) {
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
      } else if (body.amount) {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("Preço mensal não configurado");
      }
      break;
    }

    default: {
      if (body.amount) {
        amountBRL = toNumber(body.amount);
      } else {
        throw new Error("reservation_type inválido");
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

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/properties?id=eq.${propertyId}&select=id,title,price_per_hour,price_per_day,price_per_month,price_morning,price_afternoon,price_evening,min_months_full_rental`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error("Erro ao buscar imóvel");
  }

  const data = await res.json();
  return data?.[0] || null;
}

async function createBooking({
  amount,
  body,
  reservationType,
}) {
  const guest_name = body.guest_name || "Cliente";
  const guest_email = body.guest_email || undefined;

  const bookingPayload = {
    property_id: body.property_id || null,
    guest_name,
    guest_email,
    phone: body.phone || "",
    date: body.date || "",
    start_at: body.start_at || "",
    end_at: body.end_at || "",
    reservation_type: reservationType || "time",
    period: body.period || "",
    duration_hours: body.duration_hours ? Number(body.duration_hours) : null,
    days_count: body.days_count ? Number(body.days_count) : null,
    months_count: body.months_count ? Number(body.months_count) : null,
    billing_mode: body.billing_mode || "one_time",
    total_amount: amount,
    price_cents: Math.round(Number(amount) * 100),
    currency: "brl",
    status: "pending",
  };

  const bookingResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(bookingPayload),
    }
  );

  const bookingData = await bookingResponse.json();

  if (!bookingResponse.ok) {
    throw new Error(
      bookingData?.message ||
        bookingData?.error ||
        "Erro ao criar booking"
    );
  }

  const booking = Array.isArray(bookingData) ? bookingData[0] : bookingData;
  if (!booking?.id) {
    throw new Error("Booking criado sem ID");
  }

  return booking;
}

async function updateBookingStripeSession(bookingId, sessionId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stripe_session_id: sessionId,
      }),
    }
  );

  if (!res.ok) {
    throw new Error("Erro ao salvar stripe_session_id no booking");
  }
}

// OPTIONS
export async function OPTIONS(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.status(200).end();
}

// POST
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

    const propertyId = body.property_id || null;
    const reservationType = body.reservation_type || "time";

    let property = null;
    let amountCents = null;

    // Mantém compatibilidade com o fluxo antigo:
    // se vier amount e não houver necessidade de calcular, usa amount direto.
    const hasExplicitAmount =
      body.amount !== undefined && body.amount !== null && body.amount !== "";

    if (propertyId) {
      property = await fetchProperty(propertyId);
    }

    if (property) {
      amountCents = calcAmountCents(property, body);
    } else if (hasExplicitAmount) {
      amountCents = Math.round(toNumber(body.amount) * 100);
    } else {
      throw new Error("property_id ou amount é obrigatório");
    }

    const amountBRL = amountCents / 100;

    // Cria booking antes do Stripe, como já era no fluxo atual
    const booking = await createBooking({
      amount: amountBRL,
      body,
      reservationType,
    });

    const spaceTitle =
      body.space_title ||
      body.property_title ||
      property?.title ||
      "Reserva";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: body.guest_email || undefined,
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: spaceTitle,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: String(booking.id),
        property_id: String(propertyId || ""),
        guest_name: String(body.guest_name || "Cliente"),
        guest_email: String(body.guest_email || ""),
        phone: String(body.phone || ""),
        date: String(body.date || ""),
        start_at: String(body.start_at || ""),
        end_at: String(body.end_at || ""),
        reservation_type: String(reservationType),
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
      error: err.message || "Erro ao criar checkout",
    });
  }
}
