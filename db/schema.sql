-- ===========================================================================
-- LIWAN — Face Attendance & Access Control
-- Application schema. Lives in its own `liwan` schema inside the same Postgres
-- instance used by the CompreFace engine, so the two never collide.
--
-- The CompreFace engine owns the `public` schema (subjects, embeddings, images).
-- Liwan owns everything below: people, doors, daily attendance, access events.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";          -- gen_random_uuid()
CREATE SCHEMA IF NOT EXISTS liwan;
SET search_path TO liwan;

-- ---------------------------------------------------------------------------
-- Sites — one physical location (HQ, branch, residence, plant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    timezone      TEXT NOT NULL DEFAULT 'Africa/Casablanca',
    workday_start TIME NOT NULL DEFAULT '09:00',   -- used for late detection
    workday_end   TIME NOT NULL DEFAULT '18:00',
    grace_minutes INT  NOT NULL DEFAULT 10,         -- minutes after start before "late"
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Doors — a controlled passage. driver_config is pluggable per door.
--   driver = 'webhook'    -> driver_config: {url, method, on_grant, on_deny, headers}
--   driver = 'pi_gpio'    -> driver_config: {pin, active_high, host}
--   driver = 'simulation' -> driver_config: {} (logs + pushes to Gate UI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doors (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id        UUID REFERENCES sites(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    location       TEXT,
    direction      TEXT NOT NULL DEFAULT 'both'
                       CHECK (direction IN ('in', 'out', 'both')),
    driver         TEXT NOT NULL DEFAULT 'simulation'
                       CHECK (driver IN ('webhook', 'pi_gpio', 'simulation')),
    driver_config  JSONB NOT NULL DEFAULT '{}',
    relock_seconds INT  NOT NULL DEFAULT 5,
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Cameras — a video source bound to a door.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cameras (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    door_id                UUID REFERENCES doors(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    source                 TEXT,                 -- rtsp://… or device index "0"
    recognition_threshold  NUMERIC NOT NULL DEFAULT 0.88,  -- min similarity to grant
    det_prob_threshold     NUMERIC NOT NULL DEFAULT 0.80,  -- min face detection prob
    enabled                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Access groups — which doors a member may open, and optional time windows.
-- door_ids empty array => all doors. schedule '{}' => any time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_groups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    door_ids   UUID[] NOT NULL DEFAULT '{}',
    schedule   JSONB  NOT NULL DEFAULT '{}',   -- {mon:["08:00","20:00"], ...}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Members — the enrolled people. Generic on purpose: works for employees,
-- residents, contractors, visitors. subject_name links to a CompreFace subject.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     TEXT,                         -- badge no / apt no / staff id
    full_name       TEXT NOT NULL,
    subject_name    TEXT UNIQUE,                  -- CompreFace subject id
    member_type     TEXT NOT NULL DEFAULT 'employee'
                        CHECK (member_type IN ('employee','resident','contractor','visitor')),
    department      TEXT,
    title           TEXT,
    email           TEXT,
    phone           TEXT,
    access_group_id UUID REFERENCES access_groups(id) ON DELETE SET NULL,
    photo_path      TEXT,                         -- stored enrollment image
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_status     ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_department ON members(department);

-- ---------------------------------------------------------------------------
-- Access events — every recognition decision the system makes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_events (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    member_id     UUID REFERENCES members(id) ON DELETE SET NULL,
    subject_name  TEXT,
    similarity    NUMERIC,
    door_id       UUID REFERENCES doors(id) ON DELETE SET NULL,
    camera_id     UUID REFERENCES cameras(id) ON DELETE SET NULL,
    direction     TEXT,                            -- in | out | unknown
    decision      TEXT NOT NULL
                      CHECK (decision IN ('granted','denied','unknown_face','not_authorized','off_schedule')),
    reason        TEXT,
    snapshot_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts        ON access_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_member    ON access_events(member_id);
CREATE INDEX IF NOT EXISTS idx_events_decision  ON access_events(decision);

-- ---------------------------------------------------------------------------
-- Attendance days — THE CORE TABLE.
-- One row per member per day: first entry in the morning, last exit in the
-- evening, hours worked, late/absent status.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_days (
    id             BIGSERIAL PRIMARY KEY,
    member_id      UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    work_date      DATE NOT NULL,
    site_id        UUID REFERENCES sites(id) ON DELETE SET NULL,
    first_in_ts    TIMESTAMPTZ,
    last_out_ts    TIMESTAMPTZ,
    first_in_door  UUID REFERENCES doors(id) ON DELETE SET NULL,
    last_out_door  UUID REFERENCES doors(id) ON DELETE SET NULL,
    worked_seconds INT,
    is_late        BOOLEAN NOT NULL DEFAULT FALSE,
    status         TEXT NOT NULL DEFAULT 'present'
                       CHECK (status IN ('present','late','absent','incomplete')),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_days(work_date DESC);

-- ---------------------------------------------------------------------------
-- Settings — white-label branding + global config (key/value JSON).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

-- ---------------------------------------------------------------------------
-- Users — console operators (separate from members / CompreFace users).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    role          TEXT NOT NULL DEFAULT 'admin'
                      CHECK (role IN ('admin','operator','viewer')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed defaults (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
    ('branding', '{
        "product_name": "Liwan",
        "tagline": "The threshold that knows your people.",
        "primary_color": "#5663F2",
        "accent_color": "#E0A340",
        "logo_url": null,
        "locale": "fr"
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES
    ('attendance', '{
        "in_out_strategy": "first_in_last_out",
        "min_revisit_seconds": 60,
        "auto_open_on_grant": true
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;
