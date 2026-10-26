-- Migration 007: Add water level monitoring fields and history table
ALTER TABLE device_readings
  ADD COLUMN IF NOT EXISTS distance_cm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS water_level_cm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS water_level_percent DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS sensor_valid BOOLEAN DEFAULT TRUE;

ALTER TABLE registered_devices
  ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'agro-monitor';

-- Seed/Register esp12f-water-001
INSERT INTO registered_devices (device_id, device_name, device_key, device_type, is_connected, last_connected_at)
VALUES ('esp12f-water-001', 'ESP-12F Water Level Monitor', '102030', 'water-level-monitor', true, NOW())
ON CONFLICT (device_id) DO UPDATE SET
  device_name = EXCLUDED.device_name,
  device_type = EXCLUDED.device_type,
  is_connected = true;

-- Update esp32-001 device_type
UPDATE registered_devices
SET device_type = 'agro-monitor'
WHERE device_id = 'esp32-001' AND (device_type IS NULL OR device_type = '');

-- Create table for historical water level readings
CREATE TABLE IF NOT EXISTS water_level_history (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    distance_cm DOUBLE PRECISION,
    water_level_cm DOUBLE PRECISION,
    water_level_percent DOUBLE PRECISION,
    sensor_valid BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_level_history_dev_time 
  ON water_level_history (device_id, created_at DESC);
