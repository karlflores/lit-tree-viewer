-- Temporal name changes for characters (from `rename` directive in LTG source).
-- characters.name remains the initial name / identity anchor.
-- The effective display name at block N is the most recent rename with
-- introduced_at <= N, falling back to characters.name when none exists.
CREATE TABLE character_renames (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    series_id     UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    introduced_at INT  NOT NULL CHECK (introduced_at >= 2)  -- block 1 = use actor declaration name
);

CREATE INDEX idx_character_renames_lookup
    ON character_renames (character_id, introduced_at);
