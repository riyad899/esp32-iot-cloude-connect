const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      error: "Database is not configured",
    });
  }

  try {
    const { deviceId = "esp32-001" } = req.body || {};

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
