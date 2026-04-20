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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
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

    const propertyId = pick(
      body.property_id,
      body.propertyId,
      body.space_id,
      body.spaceId
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

    const recurrenceType =
      pick(body.recurrence_type, body.recurrenceType) || null;
    const recurrenceInterval = toNumber(
      pick(body.recurrence_interval, body.recurrenceInterval)
    );
    const recurrenceCount = toNumber(
      pick(body.recurrence_count, body.recurrenceCount)
    );

    const weekday = pick(body.weekday) || null;
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

    const currency = (pick(body.currency) || "brl").toLowerCase();

    const amountFromBody = toNumber(
      pick(body.amount, body.price_cents, body.priceCents, body.unit_amount, body.unitAmount)
    );

    const pricePerHour = toNumber(
      pick(body.price_per_hour, body.pricePerHour)
    );

    const totalAmount = toNumber(
      pick(body.total_amount, body.totalAmount)
    );

    let amount =
      amountFromBody ??
      (totalAmount !== null ? Math.round(totalAmount * 100) : null) ??
      (pricePerHour !== null && durationHours !== null
        ? Math.round(pricePerHour * durationHours * 100)
        : null);

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
      recurrence_type: recurrenceType,
      recurrence_interval: recurrenceInterval,
      recurrence_count: recurrenceCount,
      weekday,
      months_count: monthsCount,
      recurrence_months: monthsCount,
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

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_status: session.payment_status || null,
      })
      .eq("id", booking.id);

    if (updateError) {
      console.error("Booking update error:", updateError);
    }

    return res.status(200).json({
      url: session.url,
      id: session.id,
      booking_id: booking.id,
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: err.message });
  }
};