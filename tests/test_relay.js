require("dotenv").config();
const http = require("http");
const app = require("../server");
const relayHandler = require("../api/device/relay");
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
      body
    };
    const res = {
      statusCode: 200,
      headersSent: {},
      setHeader(k, v) { this.headersSent[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, body: data, headers: this.headersSent }); }
    };
    handler(req, res).catch((err) => {
      resolve({ status: 500, error: err.message });
    });
  });
}

async function runTests() {
  console.log("=== Testing Open API (No Auth Headers Needed) ===");
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
    // 1. GET command without any headers
    const openCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET"
    });
    assert(openCmd.status === 200 && openCmd.body?.success === true, "GET /api/device/relay/command works with NO headers");

    // 2. POST relay without any headers
    const openPost = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, { deviceId: "esp32-001", relay1: "ON", relay2: "OFF" });
    assert(openPost.status === 200 && openPost.body?.relay1 === "ON", "POST /api/device/relay works with NO headers");

    // 3. Verify polling returns updated state
    const verifyCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command",
      method: "GET"
    });
    assert(verifyCmd.status === 200 && verifyCmd.body?.relay1 === "ON" && verifyCmd.body?.relay2 === "OFF", "GET command defaults to esp32-001 and reflects state");

    // 4. Serverless handlers direct test
    const srvless = await invokeHandler(relayHandler, {
      method: "POST",
      body: { relay1: "OFF", relay2: "OFF" }
    });
    assert(srvless.status === 200 && srvless.body?.relay1 === "OFF", "Serverless handler works with zero headers");

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
