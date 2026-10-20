require("dotenv").config();
const http = require("http");
const app = require("../server");
const dataHandler = require("../api/device/data");
const latestHandler = require("../api/device/data/latest");

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
  console.log("=== Testing Open Multi-Sensor Ingestion (Zero Headers) ===");
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
    // 1. Post multi-sensor payload with NO device key in headers
    const testPayload = {
      deviceId: "esp32-001",
      temperature: 28.5,
      humidity: 65,
      soilMoistureRaw: 1840,
      rainSensorRaw: 3200,
      gpsValid: true,
      latitude: 23.8103,
      longitude: 90.4125,
      altitude: 12.4,
      satellites: 8
    };

    const postRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" } // NO device key header
    }, testPayload);

    assert(
      postRes.status === 201 &&
      postRes.body?.success === true &&
      postRes.body?.data?.soilMoistureRaw === 1840 &&
      postRes.body?.data?.rainSensorRaw === 3200,
      "POST /api/device/data succeeds with ZERO device key headers"
    );

    // 2. GET /api/device/data/latest with NO headers
    const latestRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data/latest",
      method: "GET"
    });

    const lData = latestRes.body?.data;
    assert(
      latestRes.status === 200 &&
      latestRes.body?.success === true &&
      lData?.soilMoistureRaw === 1840 &&
      lData?.rainSensorRaw === 3200 &&
      lData?.latitude === 23.8103 &&
      lData?.gpsValid === true,
      "GET /api/device/data/latest returns sensor fields without any headers"
    );

    // 3. DHT11 read failure handling
    const nullDhtRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, {
      deviceId: "esp32-001",
      temperature: null,
      humidity: null,
      soilMoistureRaw: 1850,
      rainSensorRaw: 3190
    });

    assert(
      nullDhtRes.status === 201 &&
      nullDhtRes.body?.data?.temperature === null &&
      nullDhtRes.body?.data?.soilMoistureRaw === 1850,
      "Omitted/null DHT11 readings accepted with no headers"
    );

    // 4. Serverless handlers direct test with no headers
    const srvlessPost = await invokeHandler(dataHandler, {
      method: "POST",
      headers: {},
      body: testPayload
    });
    assert(srvlessPost.status === 201 && srvlessPost.body?.success === true, "api/device/data.js serverless handler works with zero headers");

    // 5. Relay command polling with no headers
    const relayCmdRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET"
    });
    assert(relayCmdRes.status === 200 && relayCmdRes.body?.success === true, "GET /api/device/relay/command works with zero headers");

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
