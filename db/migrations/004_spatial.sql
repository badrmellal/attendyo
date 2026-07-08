-- ===========================================================================
-- ATTENDYO v3 "Spatial Intelligence" migration — idempotent, safe on any
-- prior version. Applied automatically by the API at startup.
-- ===========================================================================

SET search_path TO attendyo, public;  -- keep public reachable: pgcrypto lives there

-- --- zones: buildings / floors / areas --------------------------------------
CREATE TABLE IF NOT EXISTS zones (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'area'
                   CHECK (kind IN ('building','floor','area')),
    parent_id  UUID REFERENCES zones(id) ON DELETE SET NULL,
    capacity   INT,          -- optional soft capacity (congestion tinting)
    energy_kw  NUMERIC,      -- optional connected load (kW) for savings math
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Doors belong to a zone: camera → door → zone is the location chain.
ALTER TABLE doors ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_doors_zone ON doors(zone_id);

-- Presence/movement queries walk today's granted events per member.
CREATE INDEX IF NOT EXISTS idx_events_member_granted_ts
    ON access_events(member_id, ts DESC) WHERE decision = 'granted';

-- --- energy rules: occupancy-driven automation -------------------------------
CREATE TABLE IF NOT EXISTS energy_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id       UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    empty_minutes INT  NOT NULL DEFAULT 15,        -- zone empty this long → OFF
    driver        TEXT NOT NULL DEFAULT 'simulation'
                      CHECK (driver IN ('webhook','simulation')),
    driver_config JSONB NOT NULL DEFAULT '{}',     -- webhook: {url,method,on_off,on_on}
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    state         TEXT NOT NULL DEFAULT 'on'
                      CHECK (state IN ('on','off')),
    last_changed  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Off/on episodes, for the savings tally (kWh = zone.energy_kw × hours off).
CREATE TABLE IF NOT EXISTS energy_log (
    id          BIGSERIAL PRIMARY KEY,
    rule_id     UUID NOT NULL REFERENCES energy_rules(id) ON DELETE CASCADE,
    went_off_at TIMESTAMPTZ NOT NULL,
    back_on_at  TIMESTAMPTZ                       -- NULL while still off
);
CREATE INDEX IF NOT EXISTS idx_energy_log_rule ON energy_log(rule_id, went_off_at DESC);
