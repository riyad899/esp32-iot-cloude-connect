const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
require("dotenv").config();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      success: false,
      error: "Database is not configured",
    });
  }

  const sql = neon(process.env.DATABASE_URL);
  const configuredDeviceKey = process.env.DEVICE_KEY || "102030";
  const configuredAdminKey = process.env.ADMIN_API_KEY || "admin_secret_relay_key_nasa_2026";

  // --- GET: Check device connection & auth status ---
  if (req.method === "GET") {
    const deviceId = req.query?.deviceId || "esp32-001";

    try {
      const rows = await sql`
        SELECT 
          d.device_id,
          d.device_name,
          d.device_type,
          d.is_connected,
          d.last_connected_at,
          s.last_seen,
          EXTRACT(EPOCH FROM (NOW() - s.last_seen)) AS seconds_since_seen
        FROM registered_devices d
        LEFT JOIN device_status s ON s.device_id = d.device_id
        WHERE d.device_id = ${deviceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return res.status(200).json({
          success: true,
          deviceId,
          connected: false,
          status: "offline",
          message: "Device is not yet registered or connected",
        });
      }

      const row = rows[0];
      const seconds = row.seconds_since_seen != null ? Number(row.seconds_since_seen) : null;
      const isOnline = seconds != null && seconds <= 420;

      return res.status(200).json({
        success: true,
        deviceId: row.device_id,
        name: row.device_name,
        deviceType: row.device_type || (row.device_id === "esp12f-water-001" ? "water-level-monitor" : "agro-monitor"),
        device_type: row.device_type || (row.device_id === "esp12f-water-001" ? "water-level-monitor" : "agro-monitor"),
        connected: Boolean(row.is_connected),
        status: isOnline ? "online" : "offline",
        lastConnectedAt: row.last_connected_at,
        lastSeen: row.last_seen,
        secondsSinceLastSeen: seconds != null ? Math.floor(seconds) : null,
      });
    } catch (err) {
      console.error("Auth GET error:", err.message);
      return res.status(500).json({
        success: false,
        error: "Failed to query device connection status",
      });
    }
  }

  // --- POST: Authenticate & Connect Device ---
  if (req.method === "POST") {
    const body = req.body || {};
    const key = body.key || body.deviceKey || body.device_key || req.headers["x-device-key"];
    const name = body.name || body.deviceName || body.device_name;
    const deviceId = (body.deviceId || body.device_id || "esp32-001").trim();

    if (!key || !String(key).trim()) {
      return res.status(400).json({
        success: false,
        connected: false,
        error: "Missing device key",
        message: "Device Key প্রদান করা বাধ্যতামূলক (Device Key is required)",
      });
    }

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        connected: false,
        error: "Missing device name",
        message: "Device Name প্রদান করা বাধ্যতামূলক (Device Name is required)",
      });
    }

    const cleanKey = String(key).trim();
    const cleanName = String(name).trim();

    try {
      // 1. Verify key against env or database
      const existing = await sql`
        SELECT device_id, device_key, device_name
        FROM registered_devices
        WHERE device_id = ${deviceId}
        LIMIT 1
      `;

      let keyMatches = false;
      if (cleanKey === configuredDeviceKey || cleanKey === configuredAdminKey) {
        keyMatches = true;
      } else if (existing.length > 0 && existing[0].device_key === cleanKey) {
        keyMatches = true;
      }

      if (!keyMatches) {
        return res.status(401).json({
          success: false,
          connected: false,
          error: "Invalid device key",
          message: "ভুল Device Key দেওয়া হয়েছে (Invalid Device Key provided)",
        });
      }

      // 2. Upsert registered_devices (mark as connected)
      const upsertResult = await sql`
        INSERT INTO registered_devices (device_id, device_name, device_key, is_connected, last_connected_at, updated_at)
        VALUES (${deviceId}, ${cleanName}, ${cleanKey}, true, NOW(), NOW())
        ON CONFLICT (device_id) DO UPDATE SET
          device_name = EXCLUDED.device_name,
          device_key = EXCLUDED.device_key,
          is_connected = true,
          last_connected_at = NOW(),
          updated_at = NOW()
        RETURNING device_id, device_name, is_connected, last_connected_at
      `;

      // 3. Upsert device_status to mark online immediately
      await sql`
        INSERT INTO device_status (device_id, last_seen)
        VALUES (${deviceId}, NOW())
        ON CONFLICT (device_id) DO UPDATE SET last_seen = NOW()
      `;

      const reg = upsertResult[0];

      // 4. Generate persistent connection token
      const tokenPayload = `${reg.device_id}:${cleanKey}:${Date.now()}`;
      const token = crypto.createHmac("sha256", configuredAdminKey).update(tokenPayload).digest("hex");

      return res.status(200).json({
        success: true,
        connected: true,
        status: "online",
        message: "Device authenticated and connected successfully! (ডিভাইস সফলভাবে কানেক্ট হয়েছে)",
        device: {
          deviceId: reg.device_id,
          name: reg.device_name,
          status: "online",
          connected: true,
          lastConnectedAt: reg.last_connected_at,
          token,
        },
        permissions: {
          telemetryUpload: true,
          telemetryRead: true,
          relayControl: true,
          relayCommandPoll: true,
        },
        apis: {
          sendTelemetry: {
            method: "POST",
            endpoint: "/api/device/data",
            description: "ESP32 sends sensor telemetry every 5 mins",
          },
          getLatestData: {
            method: "GET",
            endpoint: `/api/device/data/latest?deviceId=${reg.device_id}`,
            description: "Get latest sensor readings and GPS location",
          },
          getDeviceStatus: {
            method: "GET",
            endpoint: `/api/device/status?deviceId=${reg.device_id}`,
            description: "Check device online/offline heartbeat status",
          },
          pollRelayCommand: {
            method: "GET",
            endpoint: `/api/device/relay/command?deviceId=${reg.device_id}`,
            description: "Poll relay command for water pump and solenoid valve",
          },
          controlRelay: {
            method: "POST",
            endpoint: "/api/device/relay",
            description: "Turn relay1 (pump) or relay2 ON/OFF",
          },
        },
      });
    } catch (err) {
      console.error("Auth POST error:", err.message);
      return res.status(500).json({
        success: false,
        connected: false,
        error: "Failed to authenticate device",
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({
    success: false,
    error: "Method not allowed",
  });
};
