// api/test-webhook.js
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    // aceita booking_id por query string ou por body json
    const bookingId = req.query.booking_id || (req.body && req.body.booking_id);
    if (!bookingId) {
      return res.status(400).json({ error: "missing booking_id (use ?booking_id=1 or JSON body)" });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    const { error } = await supabase
      .from("bookings")
      .update({
        status: "paid",
      })
      .eq("id", bookingId);

    if (error) {
      return res.status(500).json({ error: "supabase_update_error", details: error });
    }

    return res.status(200).json({ ok: true, booking_id: bookingId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
