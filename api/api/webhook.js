// api/webhook.js
import Stripe from "stripe";
import fetch from "node-fetch";
import getRawBody from "raw-body";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

async function createPaymentRecord({ booking_id, amount, provider_payment_id }) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/payments`;
  const body = {
    booking_id,
    provider: "stripe",
    provider_payment_id,
    amount,
    status: "succeeded",
    created_at: new Date().toISOString()
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": process.env.SUPABASE_SERVICE_ROLE,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function markBookingPaid(booking_id) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": process.env.SUPABASE_SERVICE_ROLE,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({ status: "paid", updated_at: new Date().toISOString() })
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const raw = await getRawBody(req);
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;
      const piId = session.payment_intent;
      const pi = await stripe.paymentIntents.retrieve(piId);
      const amount = (pi.amount_received || session.amount_total) / 100;
      const provider_payment_id = pi.id;

      await createPaymentRecord({ booking_id: bookingId, amount, provider_payment_id });
      await markBookingPaid(bookingId);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.status(500).send();
  }
}
