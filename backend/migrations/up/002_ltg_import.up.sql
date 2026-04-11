-- ── Gap 2: LTG identifier for character round-trip export fidelity ──────
-- Nullable so pre-LTG records (manually inserted) are unaffected.
-- Unique within a series when present; partial index skips NULLs.
ALTER TABLE characters ADD COLUMN ltg_identifier TEXT;

CREATE UNIQUE INDEX idx_characters_series_ltg_id
    ON characters (series_id, ltg_identifier)
    WHERE ltg_identifier IS NOT NULL;


-- ── Gap 3a: Block labels and group structure ──────────────────────────────
-- Persists the timeline structure produced by the LTG compiler so the
-- scrubber can display block display labels and group labels without
-- recompiling the source.
CREATE TABLE blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id   UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    block_index INT  NOT NULL CHECK (block_index >= 1),
    label       TEXT,   -- optional display label  (e.g. "The Storm")
    group_label TEXT,   -- enclosing group, if any  (e.g. "Season 1")
    UNIQUE (series_id, block_index)
);

CREATE INDEX idx_blocks_series ON blocks (series_id, block_index);


-- ── Gap 3b: Colour map for relationship label styling ─────────────────────
-- Stores both hash-derived defaults and set colour: overrides from the LTG
-- source. Keyed on (series_id, label) — each label has exactly one colour
-- per series.
CREATE TABLE series_colours (
    series_id   UUID    NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    label       TEXT    NOT NULL,
    hex         TEXT    NOT NULL,
    is_override BOOLEAN NOT NULL DEFAULT false,  -- true = from `set colour:` directive
    PRIMARY KEY (series_id, label)
);


-- ── Relationship label model migration ───────────────────────────────────
-- The LTG model uses free-form labels as the canonical relationship
-- identifier. `kind` (old enum) becomes optional — existing seed data
-- retains it; LTG-imported series set kind = NULL and label NOT NULL.
--
-- Step 1: relax the NOT NULL + enum constraint on kind.
ALTER TABLE relationships
    ALTER COLUMN kind DROP NOT NULL,
    DROP CONSTRAINT relationships_kind_check;

ALTER TABLE relationships
    ADD CONSTRAINT relationships_kind_check
        CHECK (kind IS NULL OR kind IN (
            'family', 'parent_child', 'romantic',
            'ally', 'rival', 'enemy', 'mentor', 'other'
        ));

-- Step 2: backfill label from kind for any rows where label is NULL
--         (defensive: all seed rows already have labels).
UPDATE relationships SET label = kind WHERE label IS NULL;

-- Step 3: label is now the canonical non-nullable field.
ALTER TABLE relationships ALTER COLUMN label SET NOT NULL;
