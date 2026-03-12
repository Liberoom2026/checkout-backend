import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

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
    const body = req.body;

    const amount = body.amount || 10; // fallback seguro
    const guest_email = body.guest_email || undefined;
    const space_title = body.space_title || "Reserva";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: guest_email,
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: space_title,
            },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: "https://liberoom.com.br/pagamento-sucesso",
      cancel_url: "https://liberoom.com.br/pagamento-cancelado",
    });
await fetch(`${process.env.SUPABASE_URL}/rest/v1/bookings`, {
  method: "POST",
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    property_id: null,
    guest_name: guest_name,
    guest_email: guest_email,
    total_amount: amount,
    price_cents: Math.round(Number(amount) * 100),
    currency: "brl",
    stripe_session_id: session.id,
    status: "pending",
  }),
});
    return res.status(200).json({ sessionUrl: session.url });

  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: err.message });
  }
}
