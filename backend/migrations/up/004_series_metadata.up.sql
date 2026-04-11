-- Store author and group_type from LTG metadata/set directives so they
-- survive the import→export round-trip without recompiling the source.
ALTER TABLE series ADD COLUMN author     TEXT;   -- from `metadata author: "..."`
ALTER TABLE series ADD COLUMN group_type TEXT;   -- from `set group: season`
