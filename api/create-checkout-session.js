import Stripe from "stripe";
import fetch from "node-fetch";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "https://liberoom.com.br");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const {
      booking_ids,
      amount,
      guest_email,
      guest_name,
      space_title
    } = req.body;

    if (!booking_ids || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const booking_id = booking_ids[0];
    const price_cents = Math.round(Number(amount) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: guest_email,
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: space_title || "Reserva",
            },
            unit_amount: price_cents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id,
        guest_name,
        guest_email
      },
      success_url: `${process.env.FRONTEND_URL}/pagamento-sucesso`,
      cancel_url: `${process.env.FRONTEND_URL}/pagamento-cancelado`,
    });

    return res.json({ sessionUrl: session.url });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
