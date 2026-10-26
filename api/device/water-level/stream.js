// Server-Sent Events (SSE) endpoint for live water-level updates
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (res.flushHeaders) res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected", timestamp: new Date().toISOString() })}\n\n`);

  // If running within server process with global emitter
  const emitter = global.__waterLevelEmitter;
  let onUpdate = null;
  if (emitter) {
    onUpdate = (data) => {
      res.write(`event: water-level:update\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emitter.on("water-level:update", onUpdate);
  }

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    if (emitter && onUpdate) {
      emitter.off("water-level:update", onUpdate);
    }
  });
};
