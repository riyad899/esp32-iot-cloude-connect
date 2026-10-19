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

// Mock mockReq and mockRes for direct serverless function testing
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
  console.log("=== Starting Automated Test Suite for Relay Control ===");
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
    console.log("\n--- Section 1: Express Server Integration Tests ---");

    // 1. Health check
    const healthRes = await request({ hostname: "localhost", port: PORT, path: "/api/health", method: "GET" });
    assert(healthRes.status === 200 && healthRes.body?.status === "ok", "GET /api/health returns 200 ok");

    // 2. Reject GET /api/device/relay/command without device key
    const unauthCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET"
    });
    assert(unauthCmd.status === 401, "GET /api/device/relay/command rejects missing x-device-key with 401");

    // 3. Reject GET /api/device/relay/command with wrong device key
    const wrongKeyCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": "wrong_key" }
    });
    assert(wrongKeyCmd.status === 401, "GET /api/device/relay/command rejects wrong x-device-key with 401");

    // 4. Reject GET /api/device/relay/command with invalid deviceId
    const badDeviceCmd = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=unknown-device",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(badDeviceCmd.status === 400, "GET /api/device/relay/command rejects unknown deviceId with 400");

    // 5. Reject POST /api/device/relay without admin key
    const unauthRelay = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, { deviceId: "esp32-001", relay: "ON" });
    assert(unauthRelay.status === 401, "POST /api/device/relay rejects missing admin key with 401");

    // 6. Reject POST /api/device/relay with wrong admin key
    const wrongAdminRelay = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": "bad_key" }
    }, { deviceId: "esp32-001", relay: "ON" });
    assert(wrongAdminRelay.status === 401, "POST /api/device/relay rejects invalid admin key with 401");

    // 7. Reject POST /api/device/relay with invalid relay value
    const badValRelay = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay: "MAYBE" });
    assert(badValRelay.status === 400, "POST /api/device/relay rejects invalid value with 400");

    // 8. Turn Relay ON via admin key
    const turnOnRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey }
    }, { deviceId: "esp32-001", relay: "ON" });
    assert(
      turnOnRes.status === 200 &&
      turnOnRes.body?.success === true &&
      turnOnRes.body?.relay === "ON" &&
      turnOnRes.body?.deviceId === "esp32-001" &&
      typeof turnOnRes.body?.updatedAt === "string",
      "POST /api/device/relay turns relay ON and returns expected schema"
    );

    // 9. Verify ESP32 command polling receives ON
    const pollOnRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(
      pollOnRes.status === 200 &&
      pollOnRes.body?.success === true &&
      pollOnRes.body?.relay === "ON" &&
      pollOnRes.body?.deviceId === "esp32-001",
      "GET /api/device/relay/command confirms relay is now ON for device"
    );

    // 10. Turn Relay OFF via Bearer Authorization header
    const turnOffRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminKey}`
      }
    }, { deviceId: "esp32-001", relay: "OFF" });
    assert(
      turnOffRes.status === 200 &&
      turnOffRes.body?.success === true &&
      turnOffRes.body?.relay === "OFF" &&
      turnOffRes.body?.deviceId === "esp32-001",
      "POST /api/device/relay turns relay OFF using Bearer admin token"
    );

    // 11. Verify ESP32 command polling receives OFF
    const pollOffRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/relay/command?deviceId=esp32-001",
      method: "GET",
      headers: { "x-device-key": deviceKey }
    });
    assert(
      pollOffRes.status === 200 &&
      pollOffRes.body?.success === true &&
      pollOffRes.body?.relay === "OFF" &&
      pollOffRes.body?.deviceId === "esp32-001",
      "GET /api/device/relay/command confirms relay is now OFF for device"
    );

    console.log("\n--- Section 2: Vercel Serverless Function Handler Direct Tests ---");

    // 12. Test Vercel serverless function api/device/relay.js directly
    const directRelayRes = await invokeHandler(relayHandler, {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: { deviceId: "esp32-001", relay: "ON" }
    });
    assert(
      directRelayRes.status === 200 &&
      directRelayRes.body?.success === true &&
      directRelayRes.body?.relay === "ON",
      "api/device/relay.js serverless handler successfully sets relay to ON"
    );

    // 13. Test Vercel serverless function api/device/relay/command.js directly
    const directCmdRes = await invokeHandler(commandHandler, {
      method: "GET",
      headers: { "x-device-key": deviceKey },
      query: { deviceId: "esp32-001" }
    });
    assert(
      directCmdRes.status === 200 &&
      directCmdRes.body?.success === true &&
      directCmdRes.body?.relay === "ON",
      "api/device/relay/command.js serverless handler successfully returns ON"
    );

    // Reset back to OFF
    await invokeHandler(relayHandler, {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: { deviceId: "esp32-001", relay: "OFF" }
    });

    console.log("\n--- Section 3: Existing Endpoints Non-Regression Tests ---");

    // 14. Heartbeat
    const hbRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/heartbeat",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-key": deviceKey }
    }, { deviceId: "esp32-001" });
    assert(hbRes.status === 200 && hbRes.body?.success === true, "POST /api/device/heartbeat still functions");

    // 15. Status
    const statusRes = await request({
      hostname: "localhost",
      port: PORT,
      path: "/api/device/status",
      method: "GET"
    });
    assert(statusRes.status === 200 && statusRes.body?.success === true, "GET /api/device/status still functions");

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
