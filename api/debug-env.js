// api/debug-env.js
export default function handler(req, res) {
  // apenas retorna o valor do FRONTEND_URL que o runtime está vendo
  return res.status(200).json({
    FRONTEND_URL: process.env.FRONTEND_URL || null,
    SUPABASE_URL: process.env.SUPABASE_URL || null
  });
}
