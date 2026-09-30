const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
    const sql = neon(process.env.DATABASE_URL);

    const rows = await sql`
      SELECT
        device_id,
        last_seen,
        EXTRACT(
          EPOCH FROM (NOW() - last_seen)
        ) AS seconds_since_seen
      FROM device_status
      WHERE device_id = 'esp32-001'
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: "esp32-001",
        status: "offline",
        message: "Device has never sent a heartbeat",
        lastSeen: null,
      });
    }

    const device = rows[0];
    const seconds = Number(device.seconds_since_seen);
    const isActive = seconds <= 90;

    return res.status(200).json({
      success: true,
      deviceId: device.device_id,
      status: isActive ? "active" : "offline",
      active: isActive,
      lastSeen: device.last_seen,
      secondsSinceLastSeen: Math.floor(seconds),
    });
  } catch (error) {
    console.error("Status API error:", error.message);

    return res.status(500).json({
      error: "Failed to fetch device status",
    });
  }
};
