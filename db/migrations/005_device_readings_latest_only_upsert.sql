-- Migration: 005_device_readings_latest_only_upsert.sql
-- Description: Enforce latest-only PostgreSQL UPSERT strategy per device_id

-- 1. Deduplicate device_readings to retain only the latest record per device_id
DELETE FROM device_readings a
USING device_readings b
WHERE a.device_id = b.device_id
  AND a.created_at < b.created_at;

DELETE FROM device_readings a
USING device_readings b
WHERE a.device_id = b.device_id
  AND a.id < b.id;

-- 2. Add UNIQUE constraint on device_id to support ON CONFLICT (device_id) DO UPDATE
ALTER TABLE device_readings 
  DROP CONSTRAINT IF EXISTS device_readings_device_id_key;

ALTER TABLE device_readings 
  ADD CONSTRAINT device_readings_device_id_key UNIQUE (device_id);
