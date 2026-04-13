import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

export default async function handler(req, res) {
  // 🔥 CORS CORRETO
  const origin = req.headers.origin || "";

  if (
    origin === "https://liberoom.com.br" ||
    origin === "https://www.liberoom.com.br" ||
    origin.endsWith(".lovableproject.com") ||
    origin === "http://localhost:3000" ||
    origin === "http://localhost:5173" ||
    origin === "http://localhost:4173"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, x-client-info"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const body = req.body;

    const amount = Number(body.amount || 10);
    const guest_email = body.guest_email || undefined;
    const guest_name = body.guest_name || "Cliente";
    const space_title = body.space_title || "Reserva";

    const session = await stripe.checkout.sessions.create({
      mode: body.billing_mode === "recurring" ? "subscription" : "payment",
      payment_method_types: ["card"],
      customer_email: guest_email,

      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: space_title,
            },
            unit_amount: Math.round(amount * 100),

            // 🔥 RECORRÊNCIA MENSAL
            ...(body.billing_mode === "recurring" && {
              recurring: {
                interval: "month",
              },
            }),
          },
          quantity: 1,
        },
      ],

      success_url: "https://liberoom.com.br/pagamento-sucesso",
      cancel_url: "https://liberoom.com.br/pagamento-cancelado",
    });

    return res.status(200).json({
      url: session.url,
    });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
}
