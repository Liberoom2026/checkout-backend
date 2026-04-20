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
      customer_email,
      success_url,
      cancel_url,
    } = req.body;

    if (!booking_id || !amount || !success_url || !cancel_url) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email,
      success_url,
      cancel_url,

      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: `Reserva #${booking_id}`,
            },
            unit_amount: Number(amount), // em centavos
          },
          quantity: 1,
        },
      ],

      // 🔑 ESSENCIAL
      metadata: {
        booking_id: String(booking_id),
      },
    });

    return res.status(200).json({
      url: session.url,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
