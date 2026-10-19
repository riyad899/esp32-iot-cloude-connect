const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
require("dotenv").config();

function verifyDeviceAuth(req) {
  const expectedKey = process.env.DEVICE_KEY;
  if (!expectedKey) {
    return { authorized: false, status: 500, error: "Device authentication is not configured on server" };
  }

  const receivedKey = req.headers["x-device-key"] || "";
  if (!receivedKey) {
    return { authorized: false, status: 401, error: "Unauthorized" };
  }

  const expectedBuffer = Buffer.from(expectedKey);
  const receivedBuffer = Buffer.from(receivedKey);

  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { authorized: false, status: 401, error: "Unauthorized" };
  }

  return { authorized: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = verifyDeviceAuth(req);
  if (!auth.authorized) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const deviceId = req.query?.deviceId;
  if (!deviceId || deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid or missing deviceId. Expected 'esp32-001'" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT device_id, relay_state, updated_at
      FROM device_relay_commands
      WHERE device_id = ${deviceId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        relay: "OFF",
        updatedAt: new Date().toISOString()
      });
    }

    const command = rows[0];
    return res.status(200).json({
      success: true,
      deviceId: command.device_id,
      relay: command.relay_state ? "ON" : "OFF",
      updatedAt: new Date(command.updated_at).toISOString()
    });
  } catch (error) {
    console.error("GET relay command error:", error.message);
    return res.status(500).json({ error: "Failed to retrieve relay command" });
  }
};
