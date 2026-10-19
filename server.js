require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

// --- Health Check ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --- Device Telemetry Ingestion ---
app.post("/api/device/data", async (req, res) => {
  const { deviceId = "esp32-001", temperature, humidity, latitude, longitude } = req.body || {};

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
  const deviceId = req.query?.deviceId || "esp32-001";
  try {
    const result = await pool.query(
      `SELECT * FROM device_readings
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [deviceId]
    );
    res.json({ success: true, data: result.rows[0] ?? null });
  } catch (error) {
    console.error("GET latest data failed:", error.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// --- Device Heartbeat ---
app.post("/api/device/heartbeat", async (req, res) => {
  const { deviceId = "esp32-001" } = req.body || {};

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
  const deviceId = req.query?.deviceId || "esp32-001";
  try {
    const result = await pool.query(
      `SELECT
         device_id,
         created_at AS last_seen,
         EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_since_seen
       FROM device_readings
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
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

// --- Open Relay Command Polling (No auth required) ---
app.get("/api/device/relay/command", async (req, res) => {
  const deviceId = req.query?.deviceId || "esp32-001";

  try {
    const result = await pool.query(
      `SELECT device_id, relay1_state, relay2_state, updated_at
       FROM device_relay_states
       WHERE device_id = $1
       LIMIT 1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        relay1: "OFF",
        relay2: "OFF",
        updatedAt: new Date().toISOString(),
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      deviceId: row.device_id,
      relay1: row.relay1_state ? "ON" : "OFF",
      relay2: row.relay2_state ? "ON" : "OFF",
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  } catch (error) {
    console.error("GET relay command error:", error.message);
    res.status(500).json({ error: "Failed to retrieve relay command" });
  }
});

// --- Open Relay Control (No auth required, supports partial updates) ---
app.post("/api/device/relay", async (req, res) => {
  const { deviceId: inputDeviceId, relay1, relay2, relay } = req.body || {};
  const deviceId = inputDeviceId || "esp32-001";

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
    const result = await pool.query(
      `INSERT INTO device_relay_states (device_id, relay1_state, relay2_state, updated_at)
       VALUES (
         $1,
         COALESCE($2, FALSE),
         COALESCE($3, FALSE),
         NOW()
       )
       ON CONFLICT (device_id)
       DO UPDATE SET
         relay1_state = COALESCE($2, device_relay_states.relay1_state),
         relay2_state = COALESCE($3, device_relay_states.relay2_state),
         updated_at = NOW()
       RETURNING device_id, relay1_state, relay2_state, updated_at`,
      [deviceId, r1Bool, r2Bool]
    );

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      deviceId: row.device_id,
      relay1: row.relay1_state ? "ON" : "OFF",
      relay2: row.relay2_state ? "ON" : "OFF",
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  } catch (error) {
    console.error("POST relay command error:", error.message);
    res.status(500).json({ error: "Database operation failed" });
  }
});

// --- Open Relay Query ---
app.get("/api/device/relay", async (req, res) => {
  const deviceId = req.query?.deviceId || "esp32-001";

  try {
    const result = await pool.query(
      `SELECT device_id, relay1_state, relay2_state, updated_at
       FROM device_relay_states
       WHERE device_id = $1
       LIMIT 1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        deviceId: deviceId,
        relay1: "OFF",
        relay2: "OFF",
        updatedAt: new Date().toISOString(),
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      deviceId: row.device_id,
      relay1: row.relay1_state ? "ON" : "OFF",
      relay2: row.relay2_state ? "ON" : "OFF",
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