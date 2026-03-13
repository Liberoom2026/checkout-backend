export default async function handler(req, res) {

  const cookies = req.headers.cookie || "";

  if (!cookies.includes("admin_auth=true")) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/bookings?status=eq.paid`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
    },
  });

  const data = await response.json();
  res.status(200).json(data);
}
