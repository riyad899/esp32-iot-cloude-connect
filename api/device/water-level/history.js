const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  const deviceId = req.query?.deviceId || "esp12f-water-001";
  const rawLimit = parseInt(req.query?.limit, 10);
  const limit = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 100) : 20;

  try {
    const sql = neon(process.env.DATABASE_URL);

    const rows = await sql`
      SELECT
        id,
        device_id,
        distance_cm,
        water_level_cm,
        water_level_percent,
        sensor_valid,
        created_at
      FROM water_level_history
      WHERE device_id = ${deviceId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return res.status(200).json({
      success: true,
      deviceId,
      count: rows.length,
      limit,
      data: rows.map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        device_id: r.device_id,
        distanceCm: r.distance_cm,
        distance_cm: r.distance_cm,
        waterLevelCm: r.water_level_cm,
        water_level_cm: r.water_level_cm,
        waterLevelPercent: r.water_level_percent,
        water_level_percent: r.water_level_percent,
        sensorValid: r.sensor_valid,
        sensor_valid: r.sensor_valid,
        createdAt: r.created_at,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error("GET water-level history failed:", error.message);
    return res.status(500).json({ error: "Failed to fetch water level history" });
  }
};
