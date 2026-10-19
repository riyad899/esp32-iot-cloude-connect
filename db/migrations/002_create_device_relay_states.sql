-- Migration: 002_create_device_relay_states.sql
-- Description: Create 2-channel relay states table and initialize esp32-001

CREATE TABLE IF NOT EXISTS device_relay_states (
    device_id VARCHAR(50) PRIMARY KEY,
    relay1_state BOOLEAN NOT NULL DEFAULT FALSE,
    relay2_state BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize esp32-001 with both channels OFF (FALSE)
INSERT INTO device_relay_states (device_id, relay1_state, relay2_state, updated_at)
VALUES ('esp32-001', FALSE, FALSE, NOW())
ON CONFLICT (device_id) DO NOTHING;
