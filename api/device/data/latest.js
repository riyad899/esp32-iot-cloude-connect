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
        id,
        device_id,
        temperature,
        humidity,
        latitude,
        longitude,
        created_at
      FROM device_readings
      WHERE device_id = 'esp32-001'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return res.status(200).json({
      success: true,
      data: rows[0] ?? null,
    });
  } catch (error) {
    console.error("Database query failed:", error.message);

    return res.status(500).json({
      error: "Failed to fetch device data",
    });
  }
};
