-- ===========================================================================
-- ATTENDYO v2 migration — idempotent. Safe to run on a v1 database AND on a
-- fresh database already created from the v2 schema.sql (every statement is
-- IF NOT EXISTS / conditional). The API also applies this at startup.
-- ===========================================================================

SET search_path TO attendyo, public;  -- keep public reachable: pgcrypto/uuid-ossp functions live there

-- --- members: campus types + temporary-access window ----------------------
ALTER TABLE members ADD COLUMN IF NOT EXISTS valid_from  DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS valid_until DATE;

DO $$
BEGIN
    -- widen the member_type CHECK to include campus types
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_schema = 'attendyo' AND table_name = 'members'
          AND constraint_name = 'members_member_type_check'
    ) THEN
        ALTER TABLE members DROP CONSTRAINT members_member_type_check;
    END IF;
    ALTER TABLE members ADD CONSTRAINT members_member_type_check
        CHECK (member_type IN ('employee','resident','contractor','visitor',
                               'student','faculty','staff'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --- alerts ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind            TEXT NOT NULL
                        CHECK (kind IN ('unknown_face','not_authorized','off_schedule','system')),
    severity        TEXT NOT NULL DEFAULT 'warning'
                        CHECK (severity IN ('info','warning','critical')),
    message         TEXT NOT NULL,
    event_id        BIGINT REFERENCES access_events(id) ON DELETE SET NULL,
    door_id         UUID REFERENCES doors(id) ON DELETE SET NULL,
    member_id       UUID REFERENCES members(id) ON DELETE SET NULL,
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts    ON alerts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unack ON alerts(acknowledged) WHERE NOT acknowledged;

-- --- audit log ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id    UUID,
    user_email TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    details    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- --- branding: terminology preset (idempotent JSON patch) -------------------
UPDATE settings
SET value = value || '{"terminology":"workforce"}'::jsonb
WHERE key = 'branding' AND NOT (value ? 'terminology');
