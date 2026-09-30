require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

function authenticate(req, res, next) {
  const expected = process.env.DEVICE_KEY || "";
  const received = req.get("x-device-key") || "";

  // Debug without exposing either secret
  console.log("DEVICE_KEY loaded:", Boolean(expected));
  console.log("Expected key length:", expected.length);
  console.log("Received key length:", received.length);
  console.log("Keys match:", expected === received);

  if (!expected || expected !== received) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  next();
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/device/data", authenticate, async (req, res) => {
  const { deviceId, temperature, humidity, latitude, longitude } = req.body;

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

app.get("/api/device/data/latest", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM device_readings
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      ["esp32-001"]
    );
    res.json({ data: result.rows[0] ?? null });
  } catch {
    res.status(500).json({ error: "Database query failed" });
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on port ${port}`);
  });
}

module.exports = app;