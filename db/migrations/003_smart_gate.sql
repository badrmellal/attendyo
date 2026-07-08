-- ===========================================================================
-- ATTENDYO v2.1 "Smart Gate" migration — idempotent, safe on any prior version.
-- Applied automatically by the API at startup (like 002).
-- ===========================================================================

SET search_path TO attendyo, public;  -- keep public reachable: pgcrypto lives there

-- --- members: one-shot door-side message -------------------------------------
ALTER TABLE members ADD COLUMN IF NOT EXISTS kiosk_message TEXT;

-- --- alerts: allow the anti_passback kind ------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_schema = 'attendyo' AND constraint_name = 'alerts_kind_check'
    ) THEN
        ALTER TABLE alerts DROP CONSTRAINT alerts_kind_check;
    END IF;
    ALTER TABLE alerts ADD CONSTRAINT alerts_kind_check
        CHECK (kind IN ('unknown_face','not_authorized','off_schedule','anti_passback','system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --- settings: security defaults (idempotent) --------------------------------
INSERT INTO settings (key, value) VALUES
    ('security', '{
        "alert_cooldown_seconds": 45
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;
