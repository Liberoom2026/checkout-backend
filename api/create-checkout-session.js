const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-08-16",
});

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      booking_id,
      amount,
      currency = "brl",
      customer_email,
      success_url,
      cancel_url,
      property_id,
    } = req.body || {};

    if (!booking_id || !amount || !success_url || !cancel_url) {
      return res.status(400).json({
        error: "Missing required fields: booking_id, amount, success_url, cancel_url",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: customer_email || undefined,
      success_url,
      cancel_url,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Reserva #${booking_id}`,
              description: property_id ? `Propriedade ${property_id}` : "Reserva Liberoom",
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: String(booking_id),
        property_id: property_id ? String(property_id) : "",
      },
      payment_intent_data: {
        metadata: {
          booking_id: String(booking_id),
          property_id: property_id ? String(property_id) : "",
        },
      },
    });

    return res.status(200).json({
      url: session.url,
      id: session.id,
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: err.message });
  }
};
