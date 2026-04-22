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
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const {
      property_id,
      guest_name,
      guest_email,
      date,
      duration_hours,
      billing_mode,
      start_time,
      end_time,
      period,
      recurrence_type,
      recurrence_interval,
      recurrence_count,
      weekday,
      monthly_commitment_months,
      amount,
      currency = "brl",
      success_url,
      cancel_url,
    } = body;

    if (
      !property_id ||
      !guest_name ||
      !guest_email ||
      !date ||
      !duration_hours ||
      !amount ||
      !success_url ||
      !cancel_url
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: property_id, guest_name, guest_email, date, duration_hours, amount, success_url, cancel_url",
      });
    }

    const bookingInsert = {
      property_id,
      guest_name,
      guest_email,
      date,
      duration_hours,
      billing_mode: billing_mode || "one_time",
      start_time: start_time || null,
      end_time: end_time || null,
      period: period || null,
      recurrence_type: recurrence_type || null,
      recurrence_interval: recurrence_interval || null,
      recurrence_count: recurrence_count || null,
      weekday: weekday || null,
      monthly_commitment_months: monthly_commitment_months || null,
      total_amount: Number(amount) / 100,
      currency,
      status: "pending",
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
      customer_email: guest_email || undefined,
      success_url,
      cancel_url,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Reserva #${booking.id}`,
              description: `Reserva Liberoom - ${property_id}`,
            },
            unit_amount: Math.round(Number(amount)),
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: String(booking.id),
        property_id: String(property_id),
      },
    });

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
