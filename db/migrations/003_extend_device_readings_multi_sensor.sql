-- Migration: 003_extend_device_readings_multi_sensor.sql
-- Description: Add multi-sensor (dual DHT11, dual Soil moisture, Rain ADC) and TinyGPSPlus fields to device_readings

ALTER TABLE device_readings
  ADD COLUMN IF NOT EXISTS temperature1 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS humidity1 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temperature2 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS humidity2 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS soil1 INTEGER,
  ADD COLUMN IF NOT EXISTS soil2 INTEGER,
  ADD COLUMN IF NOT EXISTS rain INTEGER,
  ADD COLUMN IF NOT EXISTS altitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS satellites INTEGER,
  ADD COLUMN IF NOT EXISTS gps_valid BOOLEAN DEFAULT FALSE;

-- Optimize index for latest telemetry queries
CREATE INDEX IF NOT EXISTS idx_device_readings_device_created 
  ON device_readings (device_id, created_at DESC);

-- Optimize index for latest valid GPS coordinates lookup
CREATE INDEX IF NOT EXISTS idx_device_readings_gps 
  ON device_readings (device_id, gps_valid, created_at DESC)
  WHERE gps_valid = TRUE;
