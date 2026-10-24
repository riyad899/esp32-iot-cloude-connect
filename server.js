require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

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

// --- Multi-Sensor Device Telemetry Ingestion (Open - No headers required) ---
app.post("/api/device/data", async (req, res) => {
  const body = req.body || {};
  const {
    deviceId: inputDeviceId,
    temperature,
    humidity,
    temperature1,
    humidity1,
    temperature2,
    humidity2,
    soilMoistureRaw,
    soil1,
    soil2,
    rainSensorRaw,
    rain,
    gpsValid,
    latitude,
    longitude,
    altitude,
    satellites,
  } = body;

  const deviceId = inputDeviceId || "esp32-001";
  if (deviceId !== "esp32-001") {
    return res.status(400).json({ error: "Invalid deviceId. Expected 'esp32-001'" });
  }

  const isValidFloat = (val) => val === undefined || val === null || (typeof val === "number" && Number.isFinite(val));
  const isValidInteger = (val) => val === undefined || val === null || (typeof val === "number" && Number.isInteger(val));
  const isValidAdc = (val) => val === undefined || val === null || (typeof val === "number" && Number.isInteger(val) && val >= 0 && val <= 4095);

  if (![temperature, humidity, temperature1, humidity1, temperature2, humidity2, altitude].every(isValidFloat)) {
    return res.status(400).json({ error: "Invalid numeric temperature/humidity/altitude data" });
  }

  const finalSoilMoisture = soilMoistureRaw !== undefined ? soilMoistureRaw : soil1;
  const finalRain = rainSensorRaw !== undefined ? rainSensorRaw : rain;

  if (!isValidAdc(finalSoilMoisture) || !isValidAdc(soil2) || !isValidAdc(finalRain)) {
    return res.status(400).json({ error: "Invalid raw ADC reading for soil/rain. Expected integer between 0 and 4095" });
  }

  if (!isValidInteger(satellites) || (satellites != null && satellites < 0)) {
    return res.status(400).json({ error: "Invalid satellite count. Must be a non-negative integer" });
  }

  if (latitude != null && (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return res.status(400).json({ error: "Invalid latitude. Must be between -90 and 90" });
  }
  if (longitude != null && (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return res.status(400).json({ error: "Invalid longitude. Must be between -180 and 180" });
  }

  const finalTemp = isValidFloat(temperature) ? (temperature ?? null) : null;
  const finalHum = isValidFloat(humidity) ? (humidity ?? null) : null;
  const finalTemp1 = isValidFloat(temperature1) ? (temperature1 ?? finalTemp) : finalTemp;
  const finalHum1 = isValidFloat(humidity1) ? (humidity1 ?? finalHum) : finalHum;
  const finalTemp2 = isValidFloat(temperature2) ? (temperature2 ?? null) : null;
  const finalHum2 = isValidFloat(humidity2) ? (humidity2 ?? null) : null;

  try {
    const hasLiveValidGps = (gpsValid === true || gpsValid === "true") &&
      latitude != null && longitude != null &&
      Number.isFinite(latitude) && Number.isFinite(longitude) &&
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180;

    // Satellites must strictly reflect the current reading — show null if not provided, never a static fallback
    const finalSats = (typeof satellites === "number" && Number.isInteger(satellites) && satellites >= 0)
      ? satellites
      : null;

    const finalLat = hasLiveValidGps ? latitude : null;
    const finalLng = hasLiveValidGps ? longitude : null;
    const finalAlt = hasLiveValidGps ? (altitude ?? null) : null;
    const finalGpsValid = hasLiveValidGps;

    const result = await pool.query(
      `INSERT INTO device_readings (
        device_id,
        temperature,
        humidity,
        temperature1,
        humidity1,
        temperature2,
        humidity2,
        soil_moisture_raw,
        rain_sensor_raw,
        soil1,
        soil2,
        rain,
        latitude,
        longitude,
        altitude,
        satellites,
        gps_valid,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
      ON CONFLICT (device_id)
      DO UPDATE SET
        temperature = EXCLUDED.temperature,
        humidity = EXCLUDED.humidity,
        temperature1 = EXCLUDED.temperature1,
        humidity1 = EXCLUDED.humidity1,
        temperature2 = EXCLUDED.temperature2,
        humidity2 = EXCLUDED.humidity2,
        soil_moisture_raw = EXCLUDED.soil_moisture_raw,
        rain_sensor_raw = EXCLUDED.rain_sensor_raw,
        soil1 = EXCLUDED.soil1,
        soil2 = EXCLUDED.soil2,
        rain = EXCLUDED.rain,
        latitude = COALESCE(EXCLUDED.latitude, device_readings.latitude),
        longitude = COALESCE(EXCLUDED.longitude, device_readings.longitude),
        altitude = COALESCE(EXCLUDED.altitude, device_readings.altitude),
        satellites = EXCLUDED.satellites,
        gps_valid = EXCLUDED.gps_valid,
        created_at = NOW()
      RETURNING *`,
      [
        deviceId,
        finalTemp,
        finalHum,
        finalTemp1,
        finalHum1,
        finalTemp2,
        finalHum2,
        finalSoilMoisture ?? null,
        finalRain ?? null,
        finalSoilMoisture ?? null,
        soil2 ?? null,
        finalRain ?? null,
        finalLat,
        finalLng,
        finalAlt,
        finalSats,
        finalGpsValid,
      ]
    );

    const saved = result.rows[0];

    res.status(201).json({
      success: true,
      message: "Device telemetry received",
      data: {
        id: saved.id,
        device_id: saved.device_id,
        deviceId: saved.device_id,
        temperature: saved.temperature,
        humidity: saved.humidity,
        soil_moisture_raw: saved.soil_moisture_raw,
        soilMoistureRaw: saved.soil_moisture_raw,
        rain_sensor_raw: saved.rain_sensor_raw,
        rainSensorRaw: saved.rain_sensor_raw,
        gps_valid: saved.gps_valid,
        gpsValid: saved.gps_valid,
        latitude: saved.latitude,
        longitude: saved.longitude,
        altitude: saved.altitude,
        satellites: saved.satellites,
        created_at: saved.created_at,
      },
    });
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
      `SELECT
         device_id,
         temperature,
         humidity,
         temperature1,
         humidity1,
         temperature2,
         humidity2,
         soil_moisture_raw,
         rain_sensor_raw,
         soil1,
         soil2,
         rain,
         latitude,
         longitude,
         altitude,
         satellites,
         gps_valid,
         created_at
       FROM device_readings
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        device_id: row.device_id,
        deviceId: row.device_id,
        temperature: row.temperature,
        humidity: row.humidity,
        temperature1: row.temperature1,
        humidity1: row.humidity1,
        temperature2: row.temperature2,
        humidity2: row.humidity2,
        soil_moisture_raw: row.soil_moisture_raw ?? row.soil1,
        soilMoistureRaw: row.soil_moisture_raw ?? row.soil1,
        rain_sensor_raw: row.rain_sensor_raw ?? row.rain,
        rainSensorRaw: row.rain_sensor_raw ?? row.rain,
        soil1: row.soil1 ?? row.soil_moisture_raw,
        soil2: row.soil2,
        rain: row.rain ?? row.rain_sensor_raw,
        latitude: row.latitude,
        longitude: row.longitude,
        altitude: row.altitude,
        satellites: row.satellites,
        gps_valid: row.gps_valid,
        gpsValid: row.gps_valid,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    console.error("GET latest data failed:", error.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// --- Device Heartbeat (Open) ---
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

// --- Device Online/Offline Status (Open) ---
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
    const isOnline = seconds <= 420; // 7 minutes threshold (device posts every 5 minutes)

    return res.status(200).json({
      success: true,
      deviceId: device.device_id,
      status: isOnline ? "online" : "offline",
      active: isOnline,
      lastSeen: device.last_seen,
      secondsSinceLastSeen: Math.floor(seconds),
    });
  } catch (error) {
    console.error("Status API error:", error.message);
    res.status(500).json({ error: "Failed to fetch device status" });
  }
});

// --- Relay Command Polling (Open) ---
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

// --- Relay Control (Open) ---
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

// --- Relay Query (Open) ---
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

// --- Device Auth & Connection API ---
const handleDeviceAuth = async (req, res) => {
  const configuredDeviceKey = process.env.DEVICE_KEY || "102030";
  const configuredAdminKey = process.env.ADMIN_API_KEY || "admin_secret_relay_key_nasa_2026";

  if (req.method === "GET") {
    const deviceId = req.query?.deviceId || "esp32-001";
    try {
      const result = await pool.query(
        `SELECT 
          d.device_id,
          d.device_name,
          d.is_connected,
          d.last_connected_at,
          s.last_seen,
          EXTRACT(EPOCH FROM (NOW() - s.last_seen)) AS seconds_since_seen
        FROM registered_devices d
        LEFT JOIN device_status s ON s.device_id = d.device_id
        WHERE d.device_id = $1
        LIMIT 1`,
        [deviceId]
      );

      if (result.rows.length === 0) {
        return res.status(200).json({
          success: true,
          deviceId,
          connected: false,
          status: "offline",
          message: "Device is not yet registered or connected",
        });
      }

      const row = result.rows[0];
      const seconds = row.seconds_since_seen != null ? Number(row.seconds_since_seen) : null;
      const isOnline = seconds != null && seconds <= 420;

      return res.status(200).json({
        success: true,
        deviceId: row.device_id,
        name: row.device_name,
        connected: Boolean(row.is_connected),
        status: isOnline ? "online" : "offline",
        lastConnectedAt: row.last_connected_at,
        lastSeen: row.last_seen,
        secondsSinceLastSeen: seconds != null ? Math.floor(seconds) : null,
      });
    } catch (err) {
      console.error("Auth GET error:", err.message);
      return res.status(500).json({ success: false, error: "Failed to query device connection status" });
    }
  }

  // POST
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
    const existing = await pool.query(
      "SELECT device_id, device_key, device_name FROM registered_devices WHERE device_id = $1 LIMIT 1",
      [deviceId]
    );

    let keyMatches = false;
    if (cleanKey === configuredDeviceKey || cleanKey === configuredAdminKey) {
      keyMatches = true;
    } else if (existing.rows.length > 0 && existing.rows[0].device_key === cleanKey) {
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

    const upsertResult = await pool.query(
      `INSERT INTO registered_devices (device_id, device_name, device_key, is_connected, last_connected_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         device_name = EXCLUDED.device_name,
         device_key = EXCLUDED.device_key,
         is_connected = true,
         last_connected_at = NOW(),
         updated_at = NOW()
       RETURNING device_id, device_name, is_connected, last_connected_at`,
      [deviceId, cleanName, cleanKey]
    );

    await pool.query(
      `INSERT INTO device_status (device_id, last_seen)
       VALUES ($1, NOW())
       ON CONFLICT (device_id) DO UPDATE SET last_seen = NOW()`,
      [deviceId]
    );

    const reg = upsertResult.rows[0];
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
};

app.get("/api/device/auth", handleDeviceAuth);
app.post("/api/device/auth", handleDeviceAuth);
app.get("/api/device/connect", handleDeviceAuth);
app.post("/api/device/connect", handleDeviceAuth);

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on port ${port}`);
  });
}

module.exports = app;