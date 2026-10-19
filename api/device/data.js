const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

module.exports = async function handler(req, res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-key, x-admin-key, Authorization");

	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	// GET latest sensor reading
	if (req.method === "GET") {
		try {
			if (!process.env.DATABASE_URL) {
				return res.status(500).json({
					error: "Database is not configured",
				});
			}

			const sql = neon(process.env.DATABASE_URL);

			const rows = await sql`
				SELECT
					id,
					device_id,
					temperature,
					humidity,
					latitude,
					longitude,
					created_at
				FROM device_readings
				WHERE device_id = 'esp32-001'
				ORDER BY created_at DESC
				LIMIT 1
			`;

			return res.status(200).json({
				success: true,
				data: rows[0] ?? null,
			});
		} catch (error) {
			console.error("GET latest data failed:", error.message);

			return res.status(500).json({
				error: "Failed to fetch device data",
			});
		}
	}

	if (req.method !== "POST") {
		res.setHeader("Allow", "GET, POST, OPTIONS");
		return res.status(405).json({
			error: "Method not allowed",
		});
	}

	if (!process.env.DATABASE_URL) {
		return res.status(500).json({
			error: "Database is not configured",
		});
	}

	const { deviceId = "esp32-001", temperature, humidity, latitude, longitude } = req.body ?? {};

	const validNumber = (value) =>
		value === undefined ||
		value === null ||
		(typeof value === "number" && Number.isFinite(value));

	if (![temperature, humidity, latitude, longitude].every(validNumber)) {
		return res.status(400).json({ error: "Invalid numeric data" });
	}

	if (
		(latitude != null && (latitude < -90 || latitude > 90)) ||
		(longitude != null && (longitude < -180 || longitude > 180))
	) {
		return res.status(400).json({ error: "Invalid coordinates" });
	}

	try {
		const sql = neon(process.env.DATABASE_URL);
		const rows = await sql`
			INSERT INTO device_readings
				(device_id, temperature, humidity, latitude, longitude)
			VALUES
				(${deviceId}, ${temperature ?? null}, ${humidity ?? null}, ${latitude ?? null}, ${longitude ?? null})
			RETURNING *
		`;

		return res.status(201).json({
			success: true,
			data: rows[0],
		});
	} catch (error) {
		console.error("POST device data failed:", error.message);

		return res.status(500).json({
			error: "Database operation failed",
		});
	}
};
