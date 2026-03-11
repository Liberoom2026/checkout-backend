import Stripe from "stripe";
import fetch from "node-fetch";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

async function getBooking(booking_id) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/bookings?id=eq.${booking_id}`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
    },
  });
  const rows = await res.json();
  return rows[0];
}

export default async function handler(req, res) {

  // ===== CORS =====
  res.setHeader("Access-Control-Allow-Origin", "https://liberoom.com.br");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Responde preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Bloqueia métodos diferentes de POST
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
  const booking_id = req.body.booking_ids?.[0];

    if (!booking_id) {
      return res.status(400).json({ error: "booking_id required" });
    }

    const booking = await getBooking(booking_id);

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const amount = Math.round(Number(booking.total_amount) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: `Reserva ${booking_id}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id,
      },
      success_url: `${process.env.FRONTEND_URL}/pagamento-sucesso`,
      cancel_url: `${process.env.FRONTEND_URL}/pagamento-cancelado`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
