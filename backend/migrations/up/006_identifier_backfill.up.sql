-- ── Migration 006: Backfill missing identifiers, blocks, and label normalization ─
--
-- Three data-quality problems arise for series imported before the LTG pipeline:
--
--  1. characters.ltg_identifier is NULL  → the emitter falls back to UUIDs,
--     which are invalid LTG identifiers.
--
--  2. The blocks table has no rows for pre-LTG series  → only the init block
--     appears when emitting LTG because there are no block anchors.
--
--  3. relationships.label may contain spaces or special characters (e.g.
--     "soul mates", "ward/instrument") → invalid LTG identifier syntax.
--
-- Steps below target only pre-LTG series (those with no block rows) so that
-- LTG-imported series are never touched.  Step 3 is safe to run on all rows
-- because valid identifiers are unchanged by the normalization.


-- ── 1. Backfill ltg_identifier ───────────────────────────────────────────────
--
-- Slug rules (match the Go/frontend slugify helpers):
--   • Lowercase the name
--   • Remove every character that is not a-z, 0-9, or space
--   • Collapse one or more spaces to a single underscore
--   • If the result starts with a digit, prepend 'c'
--   • If the result is empty, use 'char'
--
-- Duplicate slugs within the same series are disambiguated by appending _N
-- (starting at 2) ordered by (introduced_at, id).

WITH
  base_slugs AS (
    SELECT
      id,
      series_id,
      introduced_at,
      CASE
        WHEN regexp_replace(
               regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g'),
               ' +', '_', 'g'
             ) ~ '^[0-9_]'
          OR regexp_replace(
               regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g'),
               ' +', '_', 'g'
             ) = ''
        THEN 'c_' || regexp_replace(
               regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g'),
               ' +', '_', 'g'
             )
        ELSE regexp_replace(
               regexp_replace(lower(name), '[^a-z0-9 ]', '', 'g'),
               ' +', '_', 'g'
             )
      END AS base_slug
    FROM characters
    WHERE ltg_identifier IS NULL
  ),
  ranked AS (
    SELECT
      id,
      base_slug,
      ROW_NUMBER() OVER (
        PARTITION BY series_id, base_slug
        ORDER BY introduced_at, id
      ) AS rn
    FROM base_slugs
  )
UPDATE characters c
SET ltg_identifier = CASE r.rn WHEN 1 THEN r.base_slug ELSE r.base_slug || '_' || r.rn END
FROM ranked r
WHERE c.id = r.id;


-- ── 2. Normalize relationship labels ─────────────────────────────────────────
--
-- LTG identifiers must match [a-z][a-z0-9_]*.  Pre-LTG seed data can have
-- arbitrary label strings (e.g. "soul mates", "ward/instrument").
-- Normalise by lowercasing, stripping non-alphanumeric, and collapsing spaces
-- to underscores.  Already-valid labels (all LTG-imported series) are unchanged.

UPDATE relationships
SET label = trim('_' FROM regexp_replace(
                   regexp_replace(lower(label), '[^a-z0-9 ]', '', 'g'),
                   ' +', '_', 'g'
                 ))
WHERE label ~ '[^a-z0-9_]';


-- ── 3. Backfill blocks ───────────────────────────────────────────────────────
--
-- For any series that has zero rows in the blocks table, synthesise one block
-- per distinct unit where any trackable event occurs:
--
--   • characters.introduced_at  → actor declarations
--   • relationships.introduced_at → link declarations
--   • characters.died_at         → deceased directives
--   • relationships.ended_at + 1 → unlink directives
--     (unlink in block N means ended_at = N − 1, so the block needed is N = ended_at + 1)
--
-- Labels and group labels are left NULL (not available for pre-LTG data).
-- Series that already have block rows (LTG-imported) are untouched.

INSERT INTO blocks (series_id, block_index)
SELECT DISTINCT ae.series_id, ae.block_index
FROM (
    SELECT series_id, introduced_at  AS block_index FROM characters
    UNION
    SELECT series_id, introduced_at  AS block_index FROM relationships
    UNION
    SELECT series_id, died_at        AS block_index FROM characters      WHERE died_at   IS NOT NULL
    UNION
    SELECT series_id, ended_at + 1   AS block_index FROM relationships   WHERE ended_at  IS NOT NULL
) ae
WHERE NOT EXISTS (
    SELECT 1 FROM blocks b WHERE b.series_id = ae.series_id
)
ON CONFLICT (series_id, block_index) DO NOTHING;
