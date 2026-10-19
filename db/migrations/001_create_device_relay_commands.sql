-- Migration: 001_create_device_relay_commands.sql
-- Description: Create table for storing remote relay commands and initialize esp32-001

CREATE TABLE IF NOT EXISTS device_relay_commands (
    device_id VARCHAR(50) PRIMARY KEY,
    relay_state BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize esp32-001 row with relay state OFF (FALSE)
INSERT INTO device_relay_commands (device_id, relay_state, updated_at)
VALUES ('esp32-001', FALSE, NOW())
ON CONFLICT (device_id) DO NOTHING;
