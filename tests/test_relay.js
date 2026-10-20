require("dotenv").config();
const http = require("http");
const app = require("../server");
const dataHandler = require("../api/device/data");
const latestHandler = require("../api/device/data/latest");
const statusHandler = require("../api/device/status");
const commandHandler = require("../api/device/relay/command");

const PORT = 3099;
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
  console.log("=== Testing Public APIs & Latest-Only PostgreSQL UPSERT ===");
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
    // 1. Post initial reading (no auth headers)
    const payload1 = {
      deviceId: "esp32-001",
      temperature: 28.5,
      humidity: 72,
      soilMoistureRaw: 1850,
      rainSensorRaw: 3200,
      gpsValid: true,
      latitude: 24.7471,
      longitude: 90.4203,
      altitude: 18.5,
      satellites: 8
    };

    const res1 = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, payload1);

    const rowId1 = res1.body?.data?.id;
    assert(
      res1.status === 201 &&
      res1.body?.success === true &&
      res1.body?.data?.soilMoistureRaw === 1850 &&
      res1.body?.data?.latitude === 24.7471,
      "POST /api/device/data accepts payload with NO custom headers"
    );

    // 2. Post second reading to verify latest-only UPSERT (updates the same database row)
    const payload2 = {
      deviceId: "esp32-001",
      temperature: 29.0,
      humidity: 70,
      soilMoistureRaw: 1900,
      rainSensorRaw: 3100,
      gpsValid: true,
      latitude: 24.7475,
      longitude: 90.4210,
      altitude: 19.0,
      satellites: 9
    };

    const res2 = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, payload2);

    const rowId2 = res2.body?.data?.id;
    assert(
      res2.status === 201 &&
      res2.body?.data?.temperature === 29.0 &&
      res2.body?.data?.soilMoistureRaw === 1900 &&
      String(rowId1) === String(rowId2),
      "Repeated sensor POST updates the SAME database row (UPSERT verified)"
    );

    // 3. GET latest reading without custom headers
    const latestRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data/latest",
      method: "GET"
    });

    assert(
      latestRes.status === 200 &&
      latestRes.body?.success === true &&
      latestRes.body?.data?.temperature === 29.0 &&
      latestRes.body?.data?.soilMoistureRaw === 1900 &&
      latestRes.body?.data?.latitude === 24.7475,
      "GET /api/device/data/latest returns latest updated state with no headers"
    );

    // 4. GET device status without custom headers
    const statusRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/status",
      method: "GET"
    });

    assert(
      statusRes.status === 200 &&
      statusRes.body?.success === true &&
      statusRes.body?.deviceId === "esp32-001",
      "GET /api/device/status works with no headers"
    );

    // 5. GET relay command without custom headers
    const relayCmdRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET"
    });

    assert(
      relayCmdRes.status === 200 &&
      relayCmdRes.body?.success === true &&
      relayCmdRes.body?.deviceId === "esp32-001" &&
      typeof relayCmdRes.body?.relay1 === "string",
      "GET /api/device/relay/command works with no headers"
    );

    // 6. Direct invocation of Vercel serverless handlers
    const srvData = await invokeHandler(dataHandler, {
      method: "POST",
      body: payload1
    });
    assert(srvData.status === 201 && srvData.body?.success === true, "api/device/data.js serverless handler works");

    const srvLatest = await invokeHandler(latestHandler, {
      method: "GET",
      query: { deviceId: "esp32-001" }
    });
    assert(srvLatest.status === 200 && srvLatest.body?.success === true, "api/device/data/latest.js serverless handler works");

    const srvStatus = await invokeHandler(statusHandler, {
      method: "GET",
      query: { deviceId: "esp32-001" }
    });
    assert(srvStatus.status === 200 && srvStatus.body?.success === true, "api/device/status.js serverless handler works");

    const srvCmd = await invokeHandler(commandHandler, {
      method: "GET",
      query: { deviceId: "esp32-001" }
    });
    assert(srvCmd.status === 200 && srvCmd.body?.success === true, "api/device/relay/command.js serverless handler works");

    console.log(`\n=== Results: ${passed} Passed, ${failed} Failed ===\n`);
  } finally {
    server.close();
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  if (server) server.close();
  process.exit(1);
});
