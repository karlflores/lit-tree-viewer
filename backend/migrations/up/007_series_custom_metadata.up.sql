-- Arbitrary key-value metadata tags for a series (LTG: `metadata <key>: "<value>"`).
-- Stored as JSONB so the schema stays flexible as new tag types are added.
ALTER TABLE series ADD COLUMN custom_metadata JSONB DEFAULT NULL;
