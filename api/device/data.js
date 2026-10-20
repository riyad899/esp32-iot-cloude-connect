const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET latest sensor reading (Open - No auth headers required)
  if (req.method === "GET") {
    try {
      if (!process.env.DATABASE_URL) {
        return res.status(500).json({ error: "Database is not configured" });
      }

      const deviceId = req.query?.deviceId || "esp32-001";
      const sql = neon(process.env.DATABASE_URL);

      const rows = await sql`
        SELECT
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
        WHERE device_id = ${deviceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return res.status(200).json({
          success: true,
          data: null,
        });
      }

      const row = rows[0];
      return res.status(200).json({
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
      return res.status(500).json({ error: "Failed to fetch device data" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  const body = req.body ?? {};
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

  // Validate environmental numbers (temperature and humidity are nullable/omittable if read fails)
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
    const sql = neon(process.env.DATABASE_URL);

    const hasLiveValidGps = (gpsValid === true || gpsValid === "true") &&
      latitude != null && longitude != null &&
      Number.isFinite(latitude) && Number.isFinite(longitude) &&
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180;

    // Satellites strictly reflects current reading (null if omitted)
    const finalSats = (typeof satellites === "number" && Number.isInteger(satellites) && satellites >= 0)
      ? satellites
      : null;

    const finalLat = hasLiveValidGps ? latitude : null;
    const finalLng = hasLiveValidGps ? longitude : null;
    const finalAlt = hasLiveValidGps ? (altitude ?? null) : null;
    const finalGpsValid = hasLiveValidGps;

    // Latest-only PostgreSQL UPSERT strategy
    const rows = await sql`
      INSERT INTO device_readings (
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
      ) VALUES (
        ${deviceId},
        ${finalTemp},
        ${finalHum},
        ${finalTemp1},
        ${finalHum1},
        ${finalTemp2},
        ${finalHum2},
        ${finalSoilMoisture ?? null},
        ${finalRain ?? null},
        ${finalSoilMoisture ?? null},
        ${soil2 ?? null},
        ${finalRain ?? null},
        ${finalLat},
        ${finalLng},
        ${finalAlt},
        ${finalSats},
        ${finalGpsValid},
        NOW()
      )
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
      RETURNING *
    `;

    const saved = rows[0];

    return res.status(201).json({
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
    console.error("POST device data failed:", error.message);
    return res.status(500).json({ error: "Database operation failed" });
  }
};
