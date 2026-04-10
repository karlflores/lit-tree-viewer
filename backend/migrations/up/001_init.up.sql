-- A book series, TV show, or film
CREATE TABLE series (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    media_type  TEXT NOT NULL CHECK (media_type IN ('book', 'show', 'film')),
    unit_label  TEXT NOT NULL,   -- "Chapter", "Episode", "Part"
    total_units INT  NOT NULL CHECK (total_units > 0)
);

-- Characters within a series
CREATE TABLE characters (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id     UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    aliases       TEXT[] NOT NULL DEFAULT '{}',
    description   TEXT,
    image_url     TEXT,
    introduced_at INT NOT NULL CHECK (introduced_at >= 1),
    died_at       INT CHECK (died_at >= 1)
);

-- Directed or undirected relationships with a temporal window
CREATE TABLE relationships (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id     UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    from_id       UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    to_id         UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN (
                    'family', 'parent_child', 'romantic',
                    'ally', 'rival', 'enemy', 'mentor', 'other'
                  )),
    label         TEXT,
    directed      BOOLEAN NOT NULL DEFAULT false,
    introduced_at INT NOT NULL CHECK (introduced_at >= 1),
    ended_at      INT CHECK (ended_at >= 1)
);

-- Indexes for the core temporal query
CREATE INDEX idx_characters_series_intro  ON characters    (series_id, introduced_at);
CREATE INDEX idx_relationships_series_temporal ON relationships (series_id, introduced_at, ended_at);
