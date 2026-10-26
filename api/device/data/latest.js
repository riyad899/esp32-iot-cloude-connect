const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

  const deviceId = req.query?.deviceId || "esp32-001";

  try {
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
        distance_cm,
        water_level_cm,
        water_level_percent,
        sensor_valid,
        created_at
      FROM device_readings
      WHERE device_id = ${deviceId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    const row = rows[0];

    // Water level device response
    if (deviceId === "esp12f-water-001" || row.distance_cm !== null || row.water_level_cm !== null) {
      return res.status(200).json({
        success: true,
        data: {
          device_id: row.device_id,
          deviceId: row.device_id,
          sensor_valid: row.sensor_valid,
          sensorValid: row.sensor_valid,
          distance_cm: row.distance_cm,
          distanceCm: row.distance_cm,
          water_level_cm: row.water_level_cm,
          waterLevelCm: row.water_level_cm,
          water_level_percent: row.water_level_percent,
          waterLevelPercent: row.water_level_percent,
          created_at: row.created_at,
        },
      });
    }

    // Default ESP32 Agro device response
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
    console.error("Database query failed:", error.message);

    return res.status(500).json({
      error: "Failed to fetch device data",
    });
  }
};
