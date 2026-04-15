package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lit-tree-viewer/internal/domain"
)

// scanSeries reads a series row that includes the custom_metadata JSONB column.
// The caller must provide the raw JSON bytes; this function unmarshals them.
func scanSeriesWithMeta(rawMeta []byte, s *domain.Series) {
	if len(rawMeta) > 0 {
		_ = json.Unmarshal(rawMeta, &s.CustomMetadata)
	}
}

// slugify derives a valid LTG identifier from a character display name.
// Rules mirror the frontend deriveIdentifier helper:
//
//	lowercase → strip non-alphanumeric (keep spaces) → spaces→underscore
//	→ leading digit: prepend "c" → empty result: "char"
//
// Caller is responsible for deduplicating across a series.
func slugify(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if unicode.IsSpace(r) || r == '-' || r == '_' {
			b.WriteRune('_')
		}
	}
	// Collapse repeated underscores and strip leading/trailing ones.
	slug := strings.Trim(b.String(), "_")
	for strings.Contains(slug, "__") {
		slug = strings.ReplaceAll(slug, "__", "_")
	}
	if slug == "" {
		return "char"
	}
	if slug[0] >= '0' && slug[0] <= '9' {
		return "c" + slug
	}
	return slug
}

var ErrNotFound = errors.New("not found")

// GetAllSeries returns every series, ordered by title.
func GetAllSeries(ctx context.Context, pool *pgxpool.Pool) ([]domain.Series, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, title, media_type, unit_label, total_units, author, group_type, custom_metadata
		FROM series
		ORDER BY title
	`)
	if err != nil {
		return nil, fmt.Errorf("querying series: %w", err)
	}
	defer rows.Close()

	var results []domain.Series
	for rows.Next() {
		var s domain.Series
		var rawMeta []byte
		if err := rows.Scan(&s.ID, &s.Title, &s.MediaType, &s.UnitLabel, &s.TotalUnits, &s.Author, &s.GroupType, &rawMeta); err != nil {
			return nil, fmt.Errorf("scanning series row: %w", err)
		}
		scanSeriesWithMeta(rawMeta, &s)
		results = append(results, s)
	}
	return results, rows.Err()
}

// GetSeriesByID returns a single series or ErrNotFound.
func GetSeriesByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (domain.Series, error) {
	var s domain.Series
	var rawMeta []byte
	err := pool.QueryRow(ctx, `
		SELECT id, title, media_type, unit_label, total_units, author, group_type, custom_metadata
		FROM series
		WHERE id = $1
	`, id).Scan(&s.ID, &s.Title, &s.MediaType, &s.UnitLabel, &s.TotalUnits, &s.Author, &s.GroupType, &rawMeta)

	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Series{}, ErrNotFound
	}
	if err != nil {
		return domain.Series{}, fmt.Errorf("querying series %s: %w", id, err)
	}
	scanSeriesWithMeta(rawMeta, &s)
	return s, nil
}

// customMetaJSON marshals a map to a JSON string for insertion into a JSONB column.
// Returns nil when the map is empty (stored as NULL).
func customMetaJSON(m map[string]string) interface{} {
	if len(m) == 0 {
		return nil
	}
	b, _ := json.Marshal(m)
	return string(b) // passed as text, cast to jsonb in SQL via $N::jsonb
}

// kindStr converts a *RelationshipKind to *string for nullable DB insertion.
func kindStr(k *domain.RelationshipKind) *string {
	if k == nil {
		return nil
	}
	s := string(*k)
	return &s
}

// CreateGraph inserts a new series with all its characters and relationships in
// a single transaction. The series UUID is assigned server-side and returned.
func CreateGraph(ctx context.Context, pool *pgxpool.Pool, payload domain.ImportPayload) (uuid.UUID, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var seriesID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO series (title, media_type, unit_label, total_units, author, group_type, custom_metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		RETURNING id
	`,
		payload.Series.Title,
		payload.Series.MediaType,
		payload.Series.UnitLabel,
		payload.Series.TotalUnits,
		payload.Series.Author,
		payload.Series.GroupType,
		customMetaJSON(payload.Series.CustomMetadata),
	).Scan(&seriesID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("inserting series: %w", err)
	}

	for _, c := range payload.Characters {
		aliases := c.Aliases
		if aliases == nil {
			aliases = []string{}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO characters (id, series_id, name, aliases, description, image_url, introduced_at, died_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, c.ID, seriesID, c.Name, aliases, c.Description, c.ImageURL, c.IntroducedAt, c.DiedAt)
		if err != nil {
			return uuid.Nil, fmt.Errorf("inserting character %s: %w", c.ID, err)
		}
	}

	for _, r := range payload.Relationships {
		_, err = tx.Exec(ctx, `
			INSERT INTO relationships (id, series_id, from_id, to_id, kind, label, directed, introduced_at, ended_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, r.ID, seriesID, r.FromID, r.ToID, kindStr(r.Kind), r.Label, r.Directed, r.IntroducedAt, r.EndedAt)
		if err != nil {
			return uuid.Nil, fmt.Errorf("inserting relationship %s: %w", r.ID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, fmt.Errorf("commit: %w", err)
	}
	return seriesID, nil
}

// ReplaceGraph updates series metadata and replaces all characters and
// relationships in a single transaction. The DELETE cascades to character_renames
// and relationships via ON DELETE CASCADE foreign keys.
func ReplaceGraph(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID, payload domain.ImportPayload) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	_, err = tx.Exec(ctx, `
		UPDATE series
		SET title = $1, media_type = $2, unit_label = $3, total_units = $4,
		    author = $5, group_type = $6, custom_metadata = $7::jsonb
		WHERE id = $8
	`,
		payload.Series.Title,
		payload.Series.MediaType,
		payload.Series.UnitLabel,
		payload.Series.TotalUnits,
		payload.Series.Author,
		payload.Series.GroupType,
		customMetaJSON(payload.Series.CustomMetadata),
		seriesID,
	)
	if err != nil {
		return fmt.Errorf("updating series: %w", err)
	}

	// Delete cascades to relationships and character_renames via FK constraints.
	_, err = tx.Exec(ctx, `DELETE FROM characters WHERE series_id = $1`, seriesID)
	if err != nil {
		return fmt.Errorf("deleting characters: %w", err)
	}

	for _, c := range payload.Characters {
		aliases := c.Aliases
		if aliases == nil {
			aliases = []string{}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO characters (id, series_id, name, aliases, description, image_url, introduced_at, died_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, c.ID, seriesID, c.Name, aliases, c.Description, c.ImageURL, c.IntroducedAt, c.DiedAt)
		if err != nil {
			return fmt.Errorf("inserting character %s: %w", c.ID, err)
		}
	}

	for _, r := range payload.Relationships {
		_, err = tx.Exec(ctx, `
			INSERT INTO relationships (id, series_id, from_id, to_id, kind, label, directed, introduced_at, ended_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, r.ID, seriesID, r.FromID, r.ToID, kindStr(r.Kind), r.Label, r.Directed, r.IntroducedAt, r.EndedAt)
		if err != nil {
			return fmt.Errorf("inserting relationship %s: %w", r.ID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// GetCharactersAt returns all characters introduced at or before atUnit.
// The Name field contains the effective display name at atUnit — resolved
// server-side from character_renames, falling back to the initial name.
// Deceased characters are included; the client decides whether to grey them out.
func GetCharactersAt(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID, atUnit int) ([]domain.Character, error) {
	rows, err := pool.Query(ctx, `
		SELECT
		    c.id,
		    c.series_id,
		    COALESCE(
		        (SELECT r.name FROM character_renames r
		         WHERE r.character_id = c.id AND r.introduced_at <= $2
		         ORDER BY r.introduced_at DESC LIMIT 1),
		        c.name
		    ) AS name,
		    c.aliases,
		    c.description,
		    c.image_url,
		    c.introduced_at,
		    c.died_at,
		    c.ltg_identifier
		FROM characters c
		WHERE c.series_id = $1
		  AND c.introduced_at <= $2
		ORDER BY c.introduced_at, c.name
	`, seriesID, atUnit)
	if err != nil {
		return nil, fmt.Errorf("querying characters: %w", err)
	}
	defer rows.Close()

	var results []domain.Character
	for rows.Next() {
		var c domain.Character
		if err := rows.Scan(
			&c.ID, &c.SeriesID, &c.Name, &c.Aliases,
			&c.Description, &c.ImageURL, &c.IntroducedAt, &c.DiedAt,
			&c.LtgIdentifier,
		); err != nil {
			return nil, fmt.Errorf("scanning character row: %w", err)
		}
		results = append(results, c)
	}
	return results, rows.Err()
}

// getRenamesAt returns all rename events up to atUnit, keyed by character UUID.
// Used by GetGraphSnapshot to populate Character.Renames for the character panel.
func getRenamesAt(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID, atUnit int) (map[uuid.UUID][]domain.CharacterRename, error) {
	rows, err := pool.Query(ctx, `
		SELECT character_id, name, introduced_at
		FROM character_renames
		WHERE series_id = $1 AND introduced_at <= $2
		ORDER BY character_id, introduced_at
	`, seriesID, atUnit)
	if err != nil {
		return nil, fmt.Errorf("querying character renames: %w", err)
	}
	defer rows.Close()

	result := make(map[uuid.UUID][]domain.CharacterRename)
	for rows.Next() {
		var charID uuid.UUID
		var r domain.CharacterRename
		if err := rows.Scan(&charID, &r.Name, &r.IntroducedAt); err != nil {
			return nil, fmt.Errorf("scanning rename row: %w", err)
		}
		result[charID] = append(result[charID], r)
	}
	return result, rows.Err()
}

// GetRelationshipsAt returns all relationships active at atUnit.
// A relationship is active if introduced_at <= atUnit and (ended_at IS NULL OR ended_at >= atUnit).
func GetRelationshipsAt(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID, atUnit int) ([]domain.Relationship, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, series_id, from_id, to_id, kind, label, directed, introduced_at, ended_at
		FROM relationships
		WHERE series_id = $1
		  AND introduced_at <= $2
		  AND (ended_at IS NULL OR ended_at >= $2)
		ORDER BY introduced_at
	`, seriesID, atUnit)
	if err != nil {
		return nil, fmt.Errorf("querying relationships: %w", err)
	}
	defer rows.Close()

	var results []domain.Relationship
	for rows.Next() {
		var r domain.Relationship
		// kind is nullable (nil for LTG-imported relationships); label is NOT NULL.
		if err := rows.Scan(
			&r.ID, &r.SeriesID, &r.FromID, &r.ToID,
			&r.Kind, &r.Label, &r.Directed, &r.IntroducedAt, &r.EndedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning relationship row: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// GetCompiledGraph returns the full history of a series in the CompileSuccess
// shape consumed by the frontend ltgEmitter.  Unlike GetGraphSnapshot it does
// not filter by unit — every character, relationship, block and colour override
// is included so the emitter can reconstruct the complete LTG source.
func GetCompiledGraph(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID) (domain.CompiledGraph, error) {
	series, err := GetSeriesByID(ctx, pool, seriesID)
	if err != nil {
		return domain.CompiledGraph{}, err
	}

	// ── Characters ─────────────────────────────────────────────────────────
	// Fetch ltg_identifier as a nullable string so we can apply our own
	// fallback (name-derived slug) in Go rather than falling back to a UUID.
	charRows, err := pool.Query(ctx, `
		SELECT id, ltg_identifier, name, aliases, introduced_at, died_at
		FROM characters
		WHERE series_id = $1
		ORDER BY introduced_at, name
	`, seriesID)
	if err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("querying compiled characters: %w", err)
	}
	defer charRows.Close()

	type charRow struct {
		id            uuid.UUID
		ltgIdentifier *string // NULL for pre-LTG seed data
		name          string
		aliases       []string
		introducedAt  int
		diedAt        *int
	}
	var charList []charRow
	for charRows.Next() {
		var r charRow
		if err := charRows.Scan(&r.id, &r.ltgIdentifier, &r.name, &r.aliases, &r.introducedAt, &r.diedAt); err != nil {
			return domain.CompiledGraph{}, fmt.Errorf("scanning compiled character: %w", err)
		}
		charList = append(charList, r)
	}
	if err := charRows.Err(); err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("iterating compiled characters: %w", err)
	}

	// Assign identifiers: use ltg_identifier when present, otherwise derive a
	// slug from the name and deduplicate within the series.
	//
	// Two-pass approach:
	//   Pass 1 — count how many characters share the same base slug.
	//   Pass 2 — assign: unique slugs get no suffix; duplicates get _2, _3 …
	baseCount := make(map[string]int)
	for _, c := range charList {
		var base string
		if c.ltgIdentifier != nil {
			base = *c.ltgIdentifier
		} else {
			base = slugify(c.name)
		}
		baseCount[base]++
	}
	assignedCount := make(map[string]int)
	identifierByID := make(map[uuid.UUID]string, len(charList))
	for i, c := range charList {
		var ident string
		if c.ltgIdentifier != nil {
			ident = *c.ltgIdentifier
		} else {
			base := slugify(c.name)
			if baseCount[base] == 1 {
				ident = base
			} else {
				assignedCount[base]++
				ident = fmt.Sprintf("%s_%d", base, assignedCount[base])
			}
		}
		charList[i].name = c.name // no-op but keeps the struct in sync
		identifierByID[c.id] = ident
	}

	// ── Renames ────────────────────────────────────────────────────────────
	renameRows, err := pool.Query(ctx, `
		SELECT cr.character_id, cr.name, cr.introduced_at
		FROM character_renames cr
		JOIN characters c ON cr.character_id = c.id
		WHERE c.series_id = $1
		ORDER BY cr.character_id, cr.introduced_at
	`, seriesID)
	if err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("querying compiled renames: %w", err)
	}
	defer renameRows.Close()

	renamesByID := make(map[uuid.UUID][]domain.CharacterRename)
	for renameRows.Next() {
		var charID uuid.UUID
		var r domain.CharacterRename
		if err := renameRows.Scan(&charID, &r.Name, &r.IntroducedAt); err != nil {
			return domain.CompiledGraph{}, fmt.Errorf("scanning compiled rename: %w", err)
		}
		renamesByID[charID] = append(renamesByID[charID], r)
	}
	if err := renameRows.Err(); err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("iterating compiled renames: %w", err)
	}

	characters := make([]domain.CompiledCharacter, 0, len(charList))
	for _, c := range charList {
		renames := renamesByID[c.id]
		if renames == nil {
			renames = []domain.CharacterRename{}
		}
		characters = append(characters, domain.CompiledCharacter{
			Identifier:   identifierByID[c.id],
			Name:         c.name,
			Aliases:      c.aliases,
			Renames:      renames,
			IntroducedAt: c.introducedAt,
			DiedAt:       c.diedAt,
		})
	}

	// ── Relationships ──────────────────────────────────────────────────────
	// Fetch UUIDs and resolve identifiers via the map built above.
	// This avoids any SQL COALESCE falling back to UUID strings.
	relRows, err := pool.Query(ctx, `
		SELECT from_id, to_id, label, directed, introduced_at, ended_at
		FROM relationships
		WHERE series_id = $1
		ORDER BY introduced_at
	`, seriesID)
	if err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("querying compiled relationships: %w", err)
	}
	defer relRows.Close()

	var relationships []domain.CompiledRelationship
	for relRows.Next() {
		var fromID, toID uuid.UUID
		var rel domain.CompiledRelationship
		if err := relRows.Scan(
			&fromID, &toID,
			&rel.Label, &rel.Directed, &rel.IntroducedAt, &rel.EndedAt,
		); err != nil {
			return domain.CompiledGraph{}, fmt.Errorf("scanning compiled relationship: %w", err)
		}
		rel.FromIdentifier = identifierByID[fromID]
		rel.ToIdentifier = identifierByID[toID]
		// Normalise the label to a valid LTG identifier.
		// This is a no-op for LTG-imported series (already valid) and fixes
		// pre-LTG seed data that may contain spaces or special characters.
		rel.Label = slugify(rel.Label)
		relationships = append(relationships, rel)
	}
	if err := relRows.Err(); err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("iterating compiled relationships: %w", err)
	}
	if relationships == nil {
		relationships = []domain.CompiledRelationship{}
	}

	// ── Blocks ─────────────────────────────────────────────────────────────
	blockRows, err := pool.Query(ctx, `
		SELECT block_index, label, group_label
		FROM blocks
		WHERE series_id = $1
		ORDER BY block_index
	`, seriesID)
	if err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("querying compiled blocks: %w", err)
	}
	defer blockRows.Close()

	var blocks []domain.CompiledBlock
	for blockRows.Next() {
		var b domain.CompiledBlock
		if err := blockRows.Scan(&b.Index, &b.Label, &b.GroupLabel); err != nil {
			return domain.CompiledGraph{}, fmt.Errorf("scanning compiled block: %w", err)
		}
		blocks = append(blocks, b)
	}
	if err := blockRows.Err(); err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("iterating compiled blocks: %w", err)
	}
	// If no blocks are in the DB (pre-LTG series), synthesise one per distinct
	// event index so the emitter can assign each character/relationship change
	// to the correct block.  Events we must cover:
	//   • characters.introducedAt  → actor declarations
	//   • relationships.introducedAt → link declarations
	//   • characters.diedAt        → deceased directives
	//   • relationships.endedAt+1  → unlink directives (unlink in block N ↔ endedAt = N-1)
	if len(blocks) == 0 {
		idxSet := make(map[int]struct{})
		for _, c := range characters {
			idxSet[c.IntroducedAt] = struct{}{}
			if c.DiedAt != nil {
				idxSet[*c.DiedAt] = struct{}{}
			}
		}
		for _, r := range relationships {
			idxSet[r.IntroducedAt] = struct{}{}
			if r.EndedAt != nil {
				idxSet[*r.EndedAt+1] = struct{}{}
			}
		}
		for idx := range idxSet {
			blocks = append(blocks, domain.CompiledBlock{Index: idx})
		}
		sort.Slice(blocks, func(i, j int) bool {
			return blocks[i].Index < blocks[j].Index
		})
	}

	if len(blocks) == 0 {
		blocks = []domain.CompiledBlock{}
	}

	// ── Colour overrides ───────────────────────────────────────────────────
	colourRows, err := pool.Query(ctx, `
		SELECT label, hex
		FROM series_colours
		WHERE series_id = $1 AND is_override = true
		ORDER BY label
	`, seriesID)
	if err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("querying compiled colours: %w", err)
	}
	defer colourRows.Close()

	colours := make(map[string]string)
	for colourRows.Next() {
		var label, hex string
		if err := colourRows.Scan(&label, &hex); err != nil {
			return domain.CompiledGraph{}, fmt.Errorf("scanning compiled colour: %w", err)
		}
		colours[label] = hex
	}
	if err := colourRows.Err(); err != nil {
		return domain.CompiledGraph{}, fmt.Errorf("iterating compiled colours: %w", err)
	}

	return domain.CompiledGraph{
		Series:        series,
		Characters:    characters,
		Relationships: relationships,
		Colours:       colours,
		Blocks:        blocks,
	}, nil
}

// getAllRelationships returns every relationship for a series with no
// temporal filtering — introduced_at and ended_at are not considered.
func getAllRelationships(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID) ([]domain.Relationship, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, series_id, from_id, to_id, kind, label, directed, introduced_at, ended_at
		FROM relationships
		WHERE series_id = $1
		ORDER BY introduced_at
	`, seriesID)
	if err != nil {
		return nil, fmt.Errorf("querying all relationships: %w", err)
	}
	defer rows.Close()

	var results []domain.Relationship
	for rows.Next() {
		var r domain.Relationship
		if err := rows.Scan(
			&r.ID, &r.SeriesID, &r.FromID, &r.ToID,
			&r.Kind, &r.Label, &r.Directed, &r.IntroducedAt, &r.EndedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning relationship row: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// GetFullGraph returns all characters and all relationships for a series with
// no temporal filtering. Character display names are resolved at TotalUnits.
// Use this when the full history is needed (e.g. entering edit mode).
func GetFullGraph(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID) (domain.GraphSnapshot, error) {
	series, err := GetSeriesByID(ctx, pool, seriesID)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}

	// GetCharactersAt with TotalUnits returns all characters (none are introduced
	// after the final chapter) with names resolved at the final chapter.
	characters, err := GetCharactersAt(ctx, pool, seriesID, series.TotalUnits)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}

	renames, err := getRenamesAt(ctx, pool, seriesID, series.TotalUnits)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}
	for i := range characters {
		if r, ok := renames[characters[i].ID]; ok {
			characters[i].Renames = r
		}
	}

	relationships, err := getAllRelationships(ctx, pool, seriesID)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}

	return domain.GraphSnapshot{
		Series:        series,
		Characters:    characters,
		Relationships: relationships,
		AtUnit:        series.TotalUnits,
	}, nil
}

// GetGraphSnapshot composes a full graph at a given unit position.
// This is a pure read — four queries, no transaction needed.
func GetGraphSnapshot(ctx context.Context, pool *pgxpool.Pool, seriesID uuid.UUID, atUnit int) (domain.GraphSnapshot, error) {
	series, err := GetSeriesByID(ctx, pool, seriesID)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}

	characters, err := GetCharactersAt(ctx, pool, seriesID, atUnit)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}

	renames, err := getRenamesAt(ctx, pool, seriesID, atUnit)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}
	for i := range characters {
		if r, ok := renames[characters[i].ID]; ok {
			characters[i].Renames = r
		}
	}

	relationships, err := GetRelationshipsAt(ctx, pool, seriesID, atUnit)
	if err != nil {
		return domain.GraphSnapshot{}, err
	}

	return domain.GraphSnapshot{
		Series:        series,
		Characters:    characters,
		Relationships: relationships,
		AtUnit:        atUnit,
	}, nil
}
