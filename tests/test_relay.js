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
  console.log("=== Testing Dynamic Satellite Handling (Null when not received) ===");
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
    // 1. Send payload WITH satellites (e.g. 9)
    const withSatsPayload = {
      deviceId: "esp32-001",
      temperature: 28.5,
      humidity: 65,
      soilMoistureRaw: 1840,
      rainSensorRaw: 3200,
      gpsValid: true,
      latitude: 23.8103,
      longitude: 90.4125,
      altitude: 12.4,
      satellites: 9
    };

    const resWithSats = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, withSatsPayload);

    assert(
      resWithSats.status === 201 && resWithSats.body?.data?.satellites === 9,
      "Payload with satellite count returns 9"
    );

    // 2. Send payload WITHOUT satellites (omitted/no fix)
    const withoutSatsPayload = {
      deviceId: "esp32-001",
      temperature: 28.5,
      humidity: 65,
      soilMoistureRaw: 1840,
      rainSensorRaw: 3200,
      gpsValid: false,
      latitude: null,
      longitude: null
      // satellites omitted
    };

    const resNoSats = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, withoutSatsPayload);

    assert(
      resNoSats.status === 201 && resNoSats.body?.data?.satellites === null,
      "Payload without satellites returns NULL (no static value copied)"
    );

    // 3. GET latest returns satellites as null
    const latestRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data/latest",
      method: "GET"
    });

    assert(
      latestRes.status === 200 && latestRes.body?.data?.satellites === null,
      "GET /api/device/data/latest returns satellites: null when not received"
    );

    // 4. Serverless handler test
    const srvlessRes = await invokeHandler(dataHandler, {
      method: "POST",
      body: withoutSatsPayload
    });

    assert(
      srvlessRes.status === 201 && srvlessRes.body?.data?.satellites === null,
      "Serverless handler returns satellites: null when omitted"
    );

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
