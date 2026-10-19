const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  // Enable CORS headers so it can be called from anywhere/browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Open: default to esp32-001 if deviceId is omitted
  const deviceId = req.query?.deviceId || "esp32-001";

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT device_id, relay1_state, relay2_state, updated_at
      FROM device_relay_states
      WHERE device_id = ${deviceId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        relay1: "OFF",
        relay2: "OFF",
        updatedAt: new Date().toISOString()
      });
    }

    const command = rows[0];
    return res.status(200).json({
      success: true,
      deviceId: command.device_id,
      relay1: command.relay1_state ? "ON" : "OFF",
      relay2: command.relay2_state ? "ON" : "OFF",
      updatedAt: new Date(command.updated_at).toISOString()
    });
  } catch (error) {
    console.error("GET relay command error:", error.message);
    return res.status(500).json({ error: "Failed to retrieve relay command" });
  }
};
