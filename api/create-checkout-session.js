import Stripe from "stripe";
import fetch from "node-fetch";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

async function getProperty(property_id) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/properties?id=eq.${property_id}`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
    },
  });

  const rows = await res.json();
  return rows[0];
}

async function createBooking(data) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/bookings`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });

  const rows = await res.json();
  return rows[0];
}

export default async function handler(req, res) {

  // ===== CORS =====
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

    const { property_id, guest_name, guest_email } = req.body;

    if (!property_id || !guest_name || !guest_email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1️⃣ Buscar imóvel
    const property = await getProperty(property_id);

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const price_cents = Math.round(Number(property.price_per_hour) * 100);

    // 2️⃣ Criar booking com status pending
    const booking = await createBooking({
      property_id,
      guest_name,
      guest_email,
      total_amount: property.price_per_hour,
      price_cents,
      currency: "brl",
      status: "pending",
    });

    // 3️⃣ Criar sessão Stripe
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: property.title,
            },
            unit_amount: price_cents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: booking.id,
      },
      success_url: `${process.env.FRONTEND_URL}/pagamento-sucesso`,
      cancel_url: `${process.env.FRONTEND_URL}/pagamento-cancelado`,
    });

    // 4️⃣ Salvar stripe_session_id na booking
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: "PATCH",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stripe_session_id: session.id,
      }),
    });

    return res.json({ sessionUrl: session.url });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
