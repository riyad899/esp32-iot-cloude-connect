require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// Middleware: Device Authentication (x-device-key)
function authenticateDevice(req, res, next) {
  const expected = process.env.DEVICE_KEY || "";
  const received = req.get("x-device-key") || "";

  if (!expected || !received) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const bufExpected = Buffer.from(expected);
  const bufReceived = Buffer.from(received);

  if (bufExpected.length !== bufReceived.length || !crypto.timingSafeEqual(bufExpected, bufReceived)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// Middleware: Admin Authentication (x-admin-key or Bearer token)
function authenticateAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || "";
  if (!expected) {
    return res.status(500).json({ error: "Admin authentication is not configured on server" });
  }

  const authHeader = req.get("authorization");
  const bearerKey = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const received = req.get("x-admin-key") || bearerKey || "";

  if (!received) {
    return res.status(401).json({ error: "Unauthorized: Missing admin API key" });
  }

  const bufExpected = Buffer.from(expected);
  const bufReceived = Buffer.from(received);

  if (bufExpected.length !== bufReceived.length || !crypto.timingSafeEqual(bufExpected, bufReceived)) {
    return res.status(401).json({ error: "Unauthorized: Invalid admin API key" });
  }

  next();
}

// --- Health Check ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --- Device Telemetry Ingestion ---
app.post("/api/device/data", authenticateDevice, async (req, res) => {
  const { deviceId, temperature, humidity, latitude, longitude } = req.body || {};

  if (deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid deviceId" });
  }

  const validNumber = (value) => value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
  if (![temperature, humidity, latitude, longitude].every(validNumber)) {
    return res.status(400).json({ error: "Invalid numeric data" });
  }

  if ((latitude != null && (latitude < -90 || latitude > 90)) || (longitude != null && (longitude < -180 || longitude > 180))) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO device_readings
       (device_id, temperature, humidity, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [deviceId, temperature ?? null, humidity ?? null, latitude ?? null, longitude ?? null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Database insert failed:", error.message);
    res.status(500).json({ error: "Database operation failed" });
  }
});

// --- Latest Telemetry Query ---
app.get(["/api/device/data", "/api/device/data/latest"], async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM device_readings
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      ["esp32-001"]
    );
    res.json({ success: true, data: result.rows[0] ?? null });
  } catch (error) {
    console.error("GET latest data failed:", error.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// --- Device Heartbeat ---
app.post("/api/device/heartbeat", authenticateDevice, async (req, res) => {
  const { deviceId } = req.body || {};

  if (deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid deviceId" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO device_status (device_id, last_seen)
       VALUES ($1, NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET last_seen = NOW()
       RETURNING device_id, last_seen`,
      [deviceId]
    );
    res.json({ success: true, message: "Heartbeat received", data: result.rows[0] });
  } catch (error) {
    console.error("Heartbeat error:", error.message);
    res.status(500).json({ error: "Failed to update device status" });
  }
});

// --- Device Online/Offline Status ---
app.get("/api/device/status", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         device_id,
         created_at AS last_seen,
         EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_since_seen
       FROM device_readings
       WHERE device_id = 'esp32-001'
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: "esp32-001",
        status: "offline",
        active: false,
        message: "No data received from device yet",
        lastSeen: null,
      });
    }

    const device = result.rows[0];
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
    res.status(500).json({ error: "Failed to fetch device status" });
  }
});

// --- Device Relay Command Polling (x-device-key authenticated) ---
app.get("/api/device/relay/command", authenticateDevice, async (req, res) => {
  const deviceId = req.query?.deviceId;

  if (!deviceId || deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid or missing deviceId. Expected 'esp32-001'" });
  }

  try {
    const result = await pool.query(
      `SELECT device_id, relay_state, updated_at
       FROM device_relay_commands
       WHERE device_id = $1
       LIMIT 1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        relay: "OFF",
        updatedAt: new Date().toISOString(),
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      deviceId: row.device_id,
      relay: row.relay_state ? "ON" : "OFF",
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  } catch (error) {
    console.error("GET relay command error:", error.message);
    res.status(500).json({ error: "Failed to retrieve relay command" });
  }
});

// --- Admin Relay Control (x-admin-key authenticated) ---
app.post("/api/device/relay", authenticateAdmin, async (req, res) => {
  const { deviceId, relay } = req.body || {};

  if (deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid deviceId. Expected 'esp32-001'" });
  }

  if (relay !== "ON" && relay !== "OFF") {
    return res.status(400).json({ error: "Invalid relay value. Must be 'ON' or 'OFF'" });
  }

  const isRelayOn = relay === "ON";

  try {
    const result = await pool.query(
      `INSERT INTO device_relay_commands (device_id, relay_state, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET
         relay_state = EXCLUDED.relay_state,
         updated_at = NOW()
       RETURNING device_id, relay_state, updated_at`,
      [deviceId, isRelayOn]
    );

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      deviceId: row.device_id,
      relay: row.relay_state ? "ON" : "OFF",
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  } catch (error) {
    console.error("POST relay command error:", error.message);
    res.status(500).json({ error: "Database operation failed" });
  }
});

// --- Admin Relay Query (x-admin-key authenticated) ---
app.get("/api/device/relay", authenticateAdmin, async (req, res) => {
  const deviceId = req.query?.deviceId || "esp32-001";

  if (deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid deviceId. Expected 'esp32-001'" });
  }

  try {
    const result = await pool.query(
      `SELECT device_id, relay_state, updated_at
       FROM device_relay_commands
       WHERE device_id = $1
       LIMIT 1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        relay: "OFF",
        updatedAt: new Date().toISOString(),
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      deviceId: row.device_id,
      relay: row.relay_state ? "ON" : "OFF",
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  } catch (error) {
    console.error("GET relay state error:", error.message);
    res.status(500).json({ error: "Failed to fetch relay state" });
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on port ${port}`);
  });
}

module.exports = app;