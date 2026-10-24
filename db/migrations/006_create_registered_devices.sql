-- Migration 006: Create registered_devices table for device authentication & connection
CREATE TABLE IF NOT EXISTS registered_devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_key TEXT NOT NULL,
    is_connected BOOLEAN DEFAULT TRUE,
    last_connected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default esp32-001 with configured DEVICE_KEY or fallback
INSERT INTO registered_devices (device_id, device_name, device_key, is_connected, last_connected_at)
VALUES ('esp32-001', 'ESP32 Master', '102030', true, NOW())
ON CONFLICT (device_id) DO UPDATE SET
    device_name = EXCLUDED.device_name,
    device_key = EXCLUDED.device_key,
    is_connected = true,
    last_connected_at = NOW();
