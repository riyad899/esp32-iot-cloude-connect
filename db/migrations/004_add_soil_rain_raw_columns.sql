-- Migration: 004_add_soil_rain_raw_columns.sql
-- Description: Add soil_moisture_raw and rain_sensor_raw columns to device_readings

ALTER TABLE device_readings
  ADD COLUMN IF NOT EXISTS soil_moisture_raw INTEGER,
  ADD COLUMN IF NOT EXISTS rain_sensor_raw INTEGER;

-- Backfill any existing records
UPDATE device_readings
SET
  soil_moisture_raw = COALESCE(soil_moisture_raw, soil1),
  rain_sensor_raw = COALESCE(rain_sensor_raw, rain)
WHERE soil_moisture_raw IS NULL OR rain_sensor_raw IS NULL;
