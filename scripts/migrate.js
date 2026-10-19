require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

async function runMigration() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL is not set in environment.");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "../db/migrations/001_create_device_relay_commands.sql");
  const sqlContent = fs.readFileSync(sqlPath, "utf8");

  console.log("Connecting to Neon Database...");
  const sql = neon(process.env.DATABASE_URL);

  try {
    console.log("Applying migration: 001_create_device_relay_commands.sql");
    await sql.transaction([
      sql`
        CREATE TABLE IF NOT EXISTS device_relay_commands (
          device_id VARCHAR(50) PRIMARY KEY,
          relay_state BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
        INSERT INTO device_relay_commands (device_id, relay_state, updated_at)
        VALUES ('esp32-001', FALSE, NOW())
        ON CONFLICT (device_id) DO NOTHING
      `
    ]);

    const rows = await sql`SELECT * FROM device_relay_commands WHERE device_id = 'esp32-001'`;
    console.log("Migration successful! Current device_relay_commands status:", rows);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
