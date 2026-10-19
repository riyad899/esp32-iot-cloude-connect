const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
require("dotenv").config();

function verifyAdminAuth(req) {
  const expectedKey = process.env.ADMIN_API_KEY;
  if (!expectedKey) {
    return { authorized: false, status: 500, error: "Admin authentication is not configured on server" };
  }

  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const bearerKey = authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const receivedKey = req.headers["x-admin-key"] || bearerKey || "";

  if (!receivedKey) {
    return { authorized: false, status: 401, error: "Unauthorized: Missing admin API key" };
  }

  const expectedBuffer = Buffer.from(expectedKey);
  const receivedBuffer = Buffer.from(receivedKey);

  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { authorized: false, status: 401, error: "Unauthorized: Invalid admin API key" };
  }

  return { authorized: true };
}

module.exports = async function handler(req, res) {
  // Support GET to view relay status for admin / dashboard
  if (req.method === "GET") {
    const auth = verifyAdminAuth(req);
    if (!auth.authorized) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const deviceId = req.query?.deviceId || "esp32-001";
    if (deviceId !== "esp32-001") {
      return res.status(400).json({ error: "Invalid deviceId" });
    }

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

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = verifyAdminAuth(req);
  if (!auth.authorized) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  const { deviceId, relay1, relay2, relay } = req.body || {};

  if (deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid deviceId. Expected 'esp32-001'" });
  }

  // Support relay1, relay2, or legacy relay (mapped to relay1 if relay1 not specified)
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
};
