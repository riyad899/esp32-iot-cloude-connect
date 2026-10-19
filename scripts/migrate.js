require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

async function runMigration() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL is not set in environment.");
    process.exit(1);
  }

  console.log("Connecting to Neon Database...");
  const sql = neon(process.env.DATABASE_URL);

  const migrationsDir = path.join(__dirname, "../db/migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

  for (const file of files) {
    console.log(`Applying migration: ${file}`);
    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, "utf8");
    
    // Split into individual queries separated by semicolon
    const statements = sqlContent
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await sql.query(stmt);
    }
    console.log(`  ✓ Completed: ${file}`);
  }

  const rows = await sql`SELECT * FROM device_relay_states WHERE device_id = 'esp32-001'`;
  console.log("\nMigration successful! Current device_relay_states row:", rows);
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
