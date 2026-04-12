-- Revert relationship label/kind changes
ALTER TABLE relationships ALTER COLUMN label DROP NOT NULL;

ALTER TABLE relationships DROP CONSTRAINT relationships_kind_check;

ALTER TABLE relationships ALTER COLUMN kind SET NOT NULL;

ALTER TABLE relationships
    ADD CONSTRAINT relationships_kind_check
        CHECK (kind IN (
            'family', 'parent_child', 'romantic',
            'ally', 'rival', 'enemy', 'mentor', 'other'
        ));

DROP TABLE IF EXISTS series_colours;

DROP TABLE IF EXISTS blocks;

DROP INDEX IF EXISTS idx_characters_series_ltg_id;
ALTER TABLE characters DROP COLUMN IF EXISTS ltg_identifier;
