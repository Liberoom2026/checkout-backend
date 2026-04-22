import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  try {
    const { property_id, start_date, end_date } = req.query

    if (!property_id || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing params" })
    }

    const { data, error } = await supabase
      .from("booking_blocks")
      .select("*")
      .eq("property_id", property_id)
      .in("status", ["pending", "paid"])
      .gte("start_at", start_date)
      .lte("end_at", end_date)

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({ blocks: data || [] })
  } catch (err) {
    return res.status(500).json({ error: "Internal error" })
  }
}