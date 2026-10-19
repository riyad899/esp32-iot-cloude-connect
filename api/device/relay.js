const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  // Enable CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET to view relay status (Open)
  if (req.method === "GET") {
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
      console.error("GET relay state error:", error.message);
      return res.status(500).json({ error: "Failed to fetch relay state" });
    }
  }

  // POST to update relay states (Open)
  if (req.method === "POST") {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ error: "Database is not configured" });
    }

    const { deviceId: inputDeviceId, relay1, relay2, relay } = req.body || {};
    const deviceId = inputDeviceId || "esp32-001";

    // Support relay1, relay2, or legacy relay (mapped to relay1)
    const targetRelay1 = relay1 !== undefined ? relay1 : relay;
    const targetRelay2 = relay2;

    if (targetRelay1 === undefined && targetRelay2 === undefined) {
      return res.status(400).json({ error: "Missing relay state. Provide relay1, relay2, or both." });
    }

    if (targetRelay1 !== undefined && targetRelay1 !== "ON" && targetRelay1 !== "OFF") {
      return res.status(400).json({ error: "Invalid relay1 value. Must be 'ON' or 'OFF'" });
    }

    if (targetRelay2 !== undefined && targetRelay2 !== "ON" && targetRelay2 !== "OFF") {
      return res.status(400).json({ error: "Invalid relay2 value. Must be 'ON' or 'OFF'" });
    }

    const r1Bool = targetRelay1 !== undefined ? (targetRelay1 === "ON") : null;
    const r2Bool = targetRelay2 !== undefined ? (targetRelay2 === "ON") : null;

    try {
      const sql = neon(process.env.DATABASE_URL);
      const rows = await sql`
        INSERT INTO device_relay_states (device_id, relay1_state, relay2_state, updated_at)
        VALUES (
          ${deviceId},
          COALESCE(${r1Bool}, FALSE),
          COALESCE(${r2Bool}, FALSE),
          NOW()
        )
        ON CONFLICT (device_id)
        DO UPDATE SET
          relay1_state = COALESCE(${r1Bool}, device_relay_states.relay1_state),
          relay2_state = COALESCE(${r2Bool}, device_relay_states.relay2_state),
          updated_at = NOW()
        RETURNING device_id, relay1_state, relay2_state, updated_at
      `;

      const updated = rows[0];
      return res.status(200).json({
        success: true,
        deviceId: updated.device_id,
        relay1: updated.relay1_state ? "ON" : "OFF",
        relay2: updated.relay2_state ? "ON" : "OFF",
        updatedAt: new Date(updated.updated_at).toISOString()
      });
    } catch (error) {
      console.error("POST relay command error:", error.message);
      return res.status(500).json({ error: "Database operation failed" });
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method not allowed" });
};
