const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-08-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGINS = new Set([
  "https://liberoom.com.br",
  "https://www.liberoom.com.br",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function brDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-03:00`);
}

function brStartOfDay(dateStr) {
  return new Date(`${dateStr}T00:00:00-03:00`);
}

function brEndOfDay(dateStr) {
  return new Date(`${dateStr}T23:59:59-03:00`);
}

function periodToRange(dateStr, period) {
  if (period === "morning") {
    return {
      startAt: brDateTime(dateStr, "08:00"),
      endAt: brDateTime(dateStr, "12:00"),
    };
  }

  if (period === "afternoon") {
    return {
      startAt: brDateTime(dateStr, "13:00"),
      endAt: brDateTime(dateStr, "18:00"),
    };
  }

  if (period === "evening") {
    return {
      startAt: brDateTime(dateStr, "18:00"),
      endAt: brDateTime(dateStr, "22:00"),
    };
  }

  if (period === "day") {
    return {
      startAt: brStartOfDay(dateStr),
      endAt: brEndOfDay(dateStr),
    };
  }

  return null;
}

function buildBaseRange(body) {
  const reservationType = pick(
    body.reservation_type,
    body.reservationType,
    body.booking_type,
    body.bookingType,
    body.mode
  );

  const bookingMode = pick(body.billing_mode, body.billingMode) || "one_time";
  const date = pick(body.date, body.booking_date, body.bookingDate);
  const startTime = pick(body.start_time, body.startTime);
  const endTime = pick(body.end_time, body.endTime);
  const period = pick(body.period);

  if (!date) return null;

  // Diária ou exclusiva: bloqueia o dia todo
  if (
    reservationType === "exclusive" ||
    bookingMode === "exclusive" ||
    period === "day"
  ) {
    return {
      startAt: brStartOfDay(date),
      endAt: brEndOfDay(date),
    };
  }

  // Período fixo
  if (period && period !== "day") {
    const range = periodToRange(date, period);
    if (range) return range;
  }

  // Horário pontual
  if (startTime && endTime) {
    return {
      startAt: brDateTime(date, startTime),
      endAt: brDateTime(date, endTime),
    };
  }

  return null;
}

function buildOccurrences(baseRange, body) {
  const recurrenceType = pick(
    body.recurrence_type,
    body.recurrenceType
  );
  const recurrenceInterval = toNumber(
    pick(body.recurrence_interval, body.recurrenceInterval)
  ) || 1;

  const recurrenceCountRaw = toNumber(
    pick(body.recurrence_count, body.recurrenceCount)
  );

  const monthsCount = toNumber(
    pick(
      body.months_count,
      body.monthsCount,
      body.recurrence_months,
      body.recurrenceMonths,
      body.monthly_commitment_months,
      body.monthlyCommitmentMonths
    )
  );

  let recurrenceCount = recurrenceCountRaw;

  if (!recurrenceCount && monthsCount) {
    recurrenceCount = monthsCount * 4;
  }

  if (!recurrenceCount || recurrenceCount < 1) {
    recurrenceCount = 1;
  }

  const occurrences = [];

  for (let i = 0; i < recurrenceCount; i++) {
    const offsetWeeks = recurrenceInterval * i;
    occurrences.push({
      startAt: recurrenceType === "weekly"
        ? addWeeks(baseRange.startAt, offsetWeeks)
        : baseRange.startAt,
      endAt: recurrenceType === "weekly"
        ? addWeeks(baseRange.endAt, offsetWeeks)
        : baseRange.endAt,
    });
  }

  return occurrences;
}

async function insertBlocksOrFail({ bookingId, propertyId, occurrences }) {
  const rows = occurrences.map((occ) => ({
    booking_id: bookingId,
    property_id: propertyId,
    start_at: occ.startAt.toISOString(),
    end_at: occ.endAt.toISOString(),
    status: "pending",
  }));

  const { error } = await supabase.from("booking_blocks").insert(rows);

  if (error) {
    throw new Error(error.message);
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const propertyId = toNumber(
      pick(body.property_id, body.propertyId, body.space_id, body.spaceId)
    );
    const guestName = pick(body.guest_name, body.guestName, body.name);
    const guestEmail = pick(body.guest_email, body.guestEmail, body.email);
    const date = pick(body.date, body.booking_date, body.bookingDate);
    const durationHours = toNumber(
      pick(body.duration_hours, body.durationHours)
    );

    const billingMode = pick(body.billing_mode, body.billingMode) || "one_time";
    const startTime = pick(body.start_time, body.startTime) || null;
    const endTime = pick(body.end_time, body.endTime) || null;
    const period = pick(body.period) || null;

    const currency = (pick(body.currency) || "brl").toLowerCase();

    const amountFromBody = toNumber(
      pick(
        body.amount,
        body.price_cents,
        body.priceCents,
        body.unit_amount,
        body.unitAmount
      )
    );

    const pricePerHour = toNumber(
      pick(body.price_per_hour, body.pricePerHour)
    );

    const totalAmount = toNumber(
      pick(body.total_amount, body.totalAmount)
    );

    let amount = amountFromBody;

    if (amount === null && totalAmount !== null) {
      amount = Math.round(totalAmount * 100);
    }

    if (amount === null && pricePerHour !== null && durationHours !== null) {
      amount = Math.round(pricePerHour * durationHours * 100);
    }

    if (amount === null && propertyId !== null && durationHours !== null) {
      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .select("price_per_hour")
        .eq("id", propertyId)
        .single();

      if (!propertyError && property?.price_per_hour != null) {
        amount = Math.round(Number(property.price_per_hour) * durationHours * 100);
      }
    }

    const origin = req.headers.origin || "https://liberoom.com.br";
    const successUrl =
      pick(body.success_url, body.successUrl) || `${origin}/success`;
    const cancelUrl =
      pick(body.cancel_url, body.cancelUrl) || `${origin}/cancel`;

    const missing = [];
    if (!propertyId) missing.push("property_id");
    if (!guestName) missing.push("guest_name");
    if (!guestEmail) missing.push("guest_email");
    if (!date) missing.push("date");
    if (durationHours === null) missing.push("duration_hours");
    if (amount === null) missing.push("amount");
    if (!successUrl) missing.push("success_url");
    if (!cancelUrl) missing.push("cancel_url");

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
        received_keys: Object.keys(body),
        received_body: body,
      });
    }

    const baseRange = buildBaseRange(body);

    if (!baseRange) {
      return res.status(400).json({
        error: "Unable to determine reservation time range",
        received_keys: Object.keys(body),
        received_body: body,
      });
    }

    const occurrences = buildOccurrences(baseRange, body);

    const bookingInsert = {
      property_id: Number(propertyId),
      guest_name: String(guestName),
      guest_email: String(guestEmail),
      date: String(date),
      duration_hours: Number(durationHours),
      billing_mode: billingMode,
      start_time: startTime,
      end_time: endTime,
      period,
      total_amount: amount / 100,
      price_cents: amount,
      currency,
      status: "pending",
      stripe_checkout_session_id: null,
      stripe_payment_status: null,
    };

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert(bookingInsert)
      .select("id")
      .single();

    if (bookingError) {
      return res.status(500).json({ error: bookingError.message });
    }

    try {
      await insertBlocksOrFail({
        bookingId: booking.id,
        propertyId: Number(propertyId),
        occurrences,
      });
    } catch (blockError) {
      await supabase.from("bookings").delete().eq("id", booking.id);
      return res.status(400).json({
        error: blockError.message || "Este horário já está reservado",
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-08-16",
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: guestEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Reserva #${booking.id}`,
              description: `Reserva Liberoom - propriedade ${propertyId}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: String(booking.id),
        property_id: String(propertyId),
      },
      payment_intent_data: {
        metadata: {
          booking_id: String(booking.id),
          property_id: String(propertyId),
        },
      },
    });

    await supabase
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_status: session.payment_status || null,
      })
      .eq("id", booking.id);

    return res.status(200).json({
      url: session.url,
      id: session.id,
      booking_id: booking.id,
      received_keys: Object.keys(body),
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: err.message });
  }
};