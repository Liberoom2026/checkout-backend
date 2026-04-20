const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bookingId = url.searchParams.get("booking_id");

    if (!bookingId) {
      return res.status(400).json({ error: "Missing booking_id" });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "paid" })
      .eq("id", bookingId)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};