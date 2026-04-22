const Stripe = require("stripe");
const { buffer } = require("micro");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-08-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ error: "Missing Stripe signature" });
    }

    const rawBody = await buffer(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody.toString(),
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Stripe signature verification failed:", err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;

      if (!bookingId) {
        return res.status(400).json({ error: "Missing booking_id in metadata" });
      }

      const { error: bookingError } = await supabase
        .from("bookings")
        .update({
          status: "paid",
          stripe_checkout_session_id: session.id,
          stripe_payment_intent: session.payment_intent || null,
          stripe_payment_status: session.payment_status || null,
        })
        .eq("id", bookingId);

      if (bookingError) {
        console.error("Supabase booking update error:", bookingError);
        return res.status(500).json({ error: bookingError.message });
      }

      const { error: blockError } = await supabase
        .from("booking_blocks")
        .update({ status: "paid" })
        .eq("booking_id", bookingId);

      if (blockError) {
        console.error("Supabase block update error:", blockError);
        return res.status(500).json({ error: blockError.message });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook crash:", err);
    return res.status(500).json({ error: err.message });
  }
};