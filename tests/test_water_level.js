require("dotenv").config();
const http = require("http");
const app = require("../server");
const dataHandler = require("../api/device/data");
const latestHandler = require("../api/device/data/latest");
const historyHandler = require("../api/device/water-level/history");
const authHandler = require("../api/device/auth");

const PORT = 3098;
let server;

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function invokeHandler(handler, { method = "GET", headers = {}, query = {}, body = null }) {
  return new Promise((resolve) => {
    const req = {
      method,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      query,
      body,
    };
    const res = {
      statusCode: 200,
      headersSent: {},
      setHeader(k, v) { this.headersSent[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, body: data, headers: this.headersSent }); },
      end() { resolve({ status: this.statusCode }); }
    };
    handler(req, res).catch((err) => {
      resolve({ status: 500, error: err.message });
    });
  });
}

async function runTests() {
  console.log("=== Testing ESP-12F Water Level Monitoring Integration ===");
  server = app.listen(PORT);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. ESP-12F submits a valid water-level payload
    const validWaterPayload = {
      deviceId: "esp12f-water-001",
      sensorValid: true,
      distanceCm: 25.4,
      waterLevelCm: 74.6,
      waterLevelPercent: 74.6,
    };

    const res1 = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, validWaterPayload);

    const initialId = res1.body?.data?.id;
    assert(
      res1.status === 201 &&
      res1.body?.success === true &&
      res1.body?.data?.deviceId === "esp12f-water-001" &&
      res1.body?.data?.waterLevelPercent === 74.6 &&
      res1.body?.data?.distanceCm === 25.4,
      "Scenario 1: ESP-12F submits valid water-level payload successfully"
    );

    // 2. Repeated water-level POST updates the SAME row in device_readings (UPSERT verified)
    const updateWaterPayload = {
      deviceId: "esp12f-water-001",
      sensorValid: true,
      distanceCm: 20.0,
      waterLevelCm: 80.0,
      waterLevelPercent: 80.0,
    };

    const res2 = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, updateWaterPayload);

    const updatedId = res2.body?.data?.id;
    assert(
      res2.status === 201 &&
      res2.body?.data?.waterLevelPercent === 80.0 &&
      String(initialId) === String(updatedId),
      "Scenario 2: Repeated water-level POST updates the SAME database row (UPSERT verified)"
    );

    // 3. Submits reading with sensorValid: false and null measurements
    const invalidSensorPayload = {
      deviceId: "esp12f-water-001",
      sensorValid: false,
      distanceCm: null,
      waterLevelCm: null,
      waterLevelPercent: null,
    };

    const res3 = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, invalidSensorPayload);

    assert(
      res3.status === 201 &&
      res3.body?.success === true &&
      res3.body?.data?.sensorValid === false &&
      res3.body?.data?.distanceCm === null,
      "Scenario 3: Sensor fault with sensorValid: false and null measurements accepted safely"
    );

    // 4. Missing device ID is rejected
    const noDevicePayload = {
      sensorValid: true,
      distanceCm: 25.4,
      waterLevelCm: 74.6,
      waterLevelPercent: 74.6,
    };
    const resNoDev = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, noDevicePayload);

    assert(
      resNoDev.status === 400 &&
      Boolean(resNoDev.body?.error),
      "Scenario 4: Missing device ID is rejected with 400"
    );

    // 5. Invalid percentage (> 100 or < 0) is rejected
    const badPercentPayload = {
      deviceId: "esp12f-water-001",
      sensorValid: true,
      distanceCm: 25.4,
      waterLevelCm: 74.6,
      waterLevelPercent: 125.0,
    };
    const resBadPercent = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, badPercentPayload);

    assert(
      resBadPercent.status === 400 &&
      resBadPercent.body?.error?.includes("waterLevelPercent"),
      "Scenario 5: Percentage above 100 is rejected with 400"
    );

    const negPercentPayload = {
      deviceId: "esp12f-water-001",
      sensorValid: true,
      distanceCm: 25.4,
      waterLevelCm: 74.6,
      waterLevelPercent: -10.0,
    };
    const resNegPercent = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, negPercentPayload);

    assert(
      resNegPercent.status === 400,
      "Scenario 6: Negative percentage is rejected with 400"
    );

    // 6. Negative distanceCm rejected
    const negDistPayload = {
      deviceId: "esp12f-water-001",
      sensorValid: true,
      distanceCm: -5.0,
      waterLevelCm: 74.6,
      waterLevelPercent: 74.6,
    };
    const resNegDist = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, negDistPayload);

    assert(
      resNegDist.status === 400 &&
      resNegDist.body?.error?.includes("distanceCm"),
      "Scenario 7: Negative sensor distance is rejected with 400"
    );

    // Restore a valid reading for subsequent query tests
    await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, validWaterPayload);

    // 7. GET latest water-level reading
    const latestRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data/latest?deviceId=esp12f-water-001",
      method: "GET",
    });

    assert(
      latestRes.status === 200 &&
      latestRes.body?.success === true &&
      latestRes.body?.data?.deviceId === "esp12f-water-001" &&
      latestRes.body?.data?.waterLevelPercent === 74.6 &&
      latestRes.body?.data?.waterLevelCm === 74.6 &&
      latestRes.body?.data?.distanceCm === 25.4 &&
      latestRes.body?.data?.sensorValid === true,
      "Scenario 8: GET /api/device/data/latest returns latest water-level readings"
    );

    // 8. Historical readings endpoint loads correctly
    const historyRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/water-level/history?deviceId=esp12f-water-001&limit=5",
      method: "GET",
    });

    assert(
      historyRes.status === 200 &&
      historyRes.body?.success === true &&
      Array.isArray(historyRes.body?.data) &&
      historyRes.body?.data.length > 0 &&
      historyRes.body?.data[0].deviceId === "esp12f-water-001" &&
      historyRes.body?.data[0].createdAt != null,
      "Scenario 9: GET /api/device/water-level/history returns historical logs with limit"
    );

    // 9. Device status reflects online
    const statusRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/status?deviceId=esp12f-water-001",
      method: "GET",
    });

    assert(
      statusRes.status === 200 &&
      statusRes.body?.deviceId === "esp12f-water-001" &&
      statusRes.body?.status === "online" &&
      statusRes.body?.active === true,
      "Scenario 10: GET /api/device/status tracks online presence after receiving reading"
    );

    // 10. Device registration & identification in auth API
    const authRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/auth?deviceId=esp12f-water-001",
      method: "GET",
    });

    assert(
      authRes.status === 200 &&
      authRes.body?.name === "ESP-12F Water Level Monitor" &&
      authRes.body?.deviceType === "water-level-monitor",
      "Scenario 11: GET /api/device/auth returns 'ESP-12F Water Level Monitor' & 'water-level-monitor'"
    );

    // 11. Serverless handlers verification
    const srvWaterData = await invokeHandler(dataHandler, {
      method: "POST",
      body: validWaterPayload,
    });
    assert(
      srvWaterData.status === 201 &&
      srvWaterData.body?.success === true &&
      srvWaterData.body?.data?.waterLevelPercent === 74.6,
      "Scenario 12: api/device/data.js serverless handler accepts water-level payload"
    );

    const srvWaterLatest = await invokeHandler(latestHandler, {
      method: "GET",
      query: { deviceId: "esp12f-water-001" },
    });
    assert(
      srvWaterLatest.status === 200 &&
      srvWaterLatest.body?.data?.waterLevelPercent != null,
      "Scenario 13: api/device/data/latest.js serverless handler returns water data"
    );

    const srvHistory = await invokeHandler(historyHandler, {
      method: "GET",
      query: { deviceId: "esp12f-water-001", limit: "5" },
    });
    assert(
      srvHistory.status === 200 &&
      Array.isArray(srvHistory.body?.data),
      "Scenario 14: api/device/water-level/history.js serverless handler functions properly"
    );

    const srvAuth = await invokeHandler(authHandler, {
      method: "GET",
      query: { deviceId: "esp12f-water-001" },
    });
    assert(
      srvAuth.status === 200 &&
      srvAuth.body?.deviceType === "water-level-monitor",
      "Scenario 15: api/device/auth.js serverless handler returns water-level-monitor deviceType"
    );

    // 12. Non-regression: ESP32 Agro payload still functions 100%
    const agroPayload = {
      deviceId: "esp32-001",
      temperature: 27.8,
      humidity: 68.0,
      soilMoistureRaw: 1820,
      rainSensorRaw: 3400,
      gpsValid: true,
      latitude: 23.8103,
      longitude: 90.4125,
      altitude: 12.4,
      satellites: 7,
    };

    const resAgro = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, agroPayload);

    assert(
      resAgro.status === 201 &&
      resAgro.body?.success === true &&
      resAgro.body?.data?.deviceId === "esp32-001" &&
      resAgro.body?.data?.soilMoistureRaw === 1820,
      "Scenario 16: Zero regression - ESP32 Agro telemetry functions 100%"
    );

  } catch (err) {
    console.error("Test execution failed with error:", err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    console.log(`\n=== Water Level Test Results: ${passed} Passed, ${failed} Failed ===`);
    if (failed > 0) {
      process.exit(1);
    }
  }
}

runTests();
