const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const expectedKey = process.env.DEVICE_KEY;
  const receivedKey = req.headers["x-device-key"];

  if (!expectedKey || receivedKey !== expectedKey) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      error: "Database is not configured",
    });
  }

  try {
    const { deviceId } = req.body || {};

    if (deviceId !== "esp32-001") {
      return res.status(400).json({
        error: "Invalid deviceId",
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    const rows = await sql`
      INSERT INTO device_status (device_id, last_seen)
      VALUES (${deviceId}, NOW())
      ON CONFLICT (device_id)
      DO UPDATE SET last_seen = NOW()
      RETURNING device_id, last_seen
    `;

    return res.status(200).json({
      success: true,
      message: "Heartbeat received",
      data: rows[0],
    });
  } catch (error) {
    console.error("Heartbeat error:", error.message);

    return res.status(500).json({
      error: "Failed to update device status",
    });
  }
};
