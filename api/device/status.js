const { neon } = require("@neondatabase/serverless");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

  const deviceId = req.query?.deviceId || "esp32-001";

  try {
    const sql = neon(process.env.DATABASE_URL);

    const rows = await sql`
      SELECT
        device_id,
        created_at AS last_seen,
        EXTRACT(
          EPOCH FROM (NOW() - created_at)
        ) AS seconds_since_seen
      FROM device_readings
      WHERE device_id = ${deviceId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        status: "offline",
        active: false,
        message: "No data received from device yet",
        lastSeen: null,
      });
    }

    const device = rows[0];
    const seconds = Number(device.seconds_since_seen);
    const isActive = seconds <= 60;

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
