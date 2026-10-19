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
  console.log("=== Starting 2-Channel Relay Control Test Suite ===");
  server = app.listen(PORT);

  const deviceKey = process.env.DEVICE_KEY;
  const adminKey = process.env.ADMIN_API_KEY;

  if (!deviceKey || !adminKey) {
    throw new Error("DEVICE_KEY and ADMIN_API_KEY must be set in .env");
  }

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
    console.log("\n--- Section 1: Authentication & Input Validation ---");

    // 1. Health check
    const healthRes = await request({ hostname: "localhost", port: PORT, path: "/api/health", method: "GET" });
    assert(healthRes.status === 200 && healthRes.body?.status === "ok", "GET /api/health returns 200 ok");

    // 2. Reject GET command without device key
    const unauthCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET"
    });
    assert(unauthCmd.status === 401, "GET /api/device/relay/command rejects missing x-device-key with 401");

    // 3. Reject GET command with invalid device key
    const badKeyCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": "invalid_key" }
    });
    assert(badKeyCmd.status === 401, "GET /api/device/relay/command rejects invalid x-device-key with 401");

    // 4. Reject GET command with invalid deviceId
    const badDevCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=unknown-esp",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(badDevCmd.status === 400, "GET /api/device/relay/command rejects invalid deviceId with 400");

    // 5. Reject POST relay without admin key
    const unauthPost = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, { deviceId: "esp32-001", relay1: "ON" });
    assert(unauthPost.status === 401, "POST /api/device/relay rejects missing admin key with 401");

    // 6. Reject POST relay with invalid admin key
    const badAdminPost = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": "fake_admin_key" }
    }, { deviceId: "esp32-001", relay1: "ON" });
    assert(badAdminPost.status === 401, "POST /api/device/relay rejects invalid admin key with 401");

    // 7. Reject POST relay with invalid relay state string
    const badValPost = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay1: "INVALID_STATE" });
    assert(badValPost.status === 400, "POST /api/device/relay rejects invalid relay value with 400");

    // 8. Reject POST relay with empty body
    const emptyPost = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001" });
    assert(emptyPost.status === 400, "POST /api/device/relay rejects missing relay1 and relay2 with 400");

    console.log("\n--- Section 2: 2-Channel Relay Independent & Partial Update Lifecycle ---");

    // Step A: Ensure both relays start OFF
    const resetBoth = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay1: "OFF", relay2: "OFF" });
    assert(
      resetBoth.status === 200 &&
      resetBoth.body?.relay1 === "OFF" &&
      resetBoth.body?.relay2 === "OFF",
      "Initialize both relays to OFF"
    );

    // Step B: Set relay 1 ON while relay 2 remains OFF (partial update sending only relay1)
    const stepB = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay1: "ON" });
    assert(
      stepB.status === 200 &&
      stepB.body?.relay1 === "ON" &&
      stepB.body?.relay2 === "OFF",
      "Set relay 1 ON while relay 2 remains OFF (partial update)"
    );

    // Verify polling returns relay1 ON, relay2 OFF
    const pollB = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(
      pollB.status === 200 &&
      pollB.body?.relay1 === "ON" &&
      pollB.body?.relay2 === "OFF" &&
      typeof pollB.body?.updatedAt === "string",
      "Device polling confirms relay1: ON, relay2: OFF"
    );

    // Step C: Set relay 2 ON while relay 1 remains unchanged (partial update sending only relay2)
    const stepC = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay2: "ON" });
    assert(
      stepC.status === 200 &&
      stepC.body?.relay1 === "ON" &&
      stepC.body?.relay2 === "ON",
      "Set relay 2 ON while relay 1 remains ON"
    );

    // Verify polling returns relay1 ON, relay2 ON
    const pollC = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(
      pollC.status === 200 &&
      pollC.body?.relay1 === "ON" &&
      pollC.body?.relay2 === "ON",
      "Device polling confirms both relays are ON"
    );

    // Step D: Turn relay 1 OFF while relay 2 remains ON
    const stepD = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminKey}`
      }
    }, { deviceId: "esp32-001", relay1: "OFF" });
    assert(
      stepD.status === 200 &&
      stepD.body?.relay1 === "OFF" &&
      stepD.body?.relay2 === "ON",
      "Turn relay 1 OFF while relay 2 remains ON (via Bearer token)"
    );

    // Verify polling returns relay1 OFF, relay2 ON
    const pollD = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(
      pollD.status === 200 &&
      pollD.body?.relay1 === "OFF" &&
      pollD.body?.relay2 === "ON",
      "Device polling confirms relay1: OFF, relay2: ON"
    );

    // Step E: Turn both relays OFF
    const stepE = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay1: "OFF", relay2: "OFF" });
    assert(
      stepE.status === 200 &&
      stepE.body?.relay1 === "OFF" &&
      stepE.body?.relay2 === "OFF",
      "Turn both relays OFF"
    );

    // Step F: Verify persistent state across separate request
    const pollE = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(
      pollE.status === 200 &&
      pollE.body?.relay1 === "OFF" &&
      pollE.body?.relay2 === "OFF",
      "State persists in Neon PostgreSQL (both relays OFF)"
    );

    console.log("\n--- Section 3: Vercel Serverless Function Handlers Direct Tests ---");

    // Direct invocation of api/device/relay.js
    const srvlessRelay = await invokeHandler(relayHandler, {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: { deviceId: "esp32-001", relay1: "ON", relay2: "OFF" }
    });
    assert(
      srvlessRelay.status === 200 &&
      srvlessRelay.body?.relay1 === "ON" &&
      srvlessRelay.body?.relay2 === "OFF",
      "api/device/relay.js serverless handler successfully sets relay1: ON, relay2: OFF"
    );

    // Direct invocation of api/device/relay/command.js
    const srvlessCmd = await invokeHandler(commandHandler, {
      method: "GET",
      headers: { "x-device-key": deviceKey },
      query: { deviceId: "esp32-001" }
    });
    assert(
      srvlessCmd.status === 200 &&
      srvlessCmd.body?.relay1 === "ON" &&
      srvlessCmd.body?.relay2 === "OFF",
      "api/device/relay/command.js serverless handler returns matching states"
    );

    // Clean up to OFF
    await invokeHandler(relayHandler, {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: { deviceId: "esp32-001", relay1: "OFF", relay2: "OFF" }
    });

    console.log("\n--- Section 4: Existing Endpoints Non-Regression Tests ---");

    // Heartbeat
    const hbRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/heartbeat",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-key": deviceKey }
    }, { deviceId: "esp32-001" });
    assert(hbRes.status === 200 && hbRes.body?.success === true, "POST /api/device/heartbeat functions without regression");

    // Device Status
    const statusRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/status",
      method: "GET"
    });
    assert(statusRes.status === 200 && statusRes.body?.success === true, "GET /api/device/status functions without regression");

    // Device Data GET
    const dataGetRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/data",
      method: "GET"
    });
    assert(dataGetRes.status === 200 && dataGetRes.body?.success === true, "GET /api/device/data functions without regression");

    console.log(`\n=== Results: ${passed} Passed, ${failed} Failed ===\n`);
  } finally {
    server.close();
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  if (server) server.close();
  process.exit(1);
});
