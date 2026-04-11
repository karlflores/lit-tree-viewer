package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lit-tree-viewer/internal/domain"
)

var ErrNotFound = errors.New("not found")

// GetAllSeries returns every series, ordered by title.
func GetAllSeries(ctx context.Context, pool *pgxpool.Pool) ([]domain.Series, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, title, media_type, unit_label, total_units
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
		if err := rows.Scan(&s.ID, &s.Title, &s.MediaType, &s.UnitLabel, &s.TotalUnits); err != nil {
			return nil, fmt.Errorf("scanning series row: %w", err)
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// GetSeriesByID returns a single series or ErrNotFound.
func GetSeriesByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (domain.Series, error) {
	var s domain.Series
	err := pool.QueryRow(ctx, `
		SELECT id, title, media_type, unit_label, total_units
		FROM series
		WHERE id = $1
	`, id).Scan(&s.ID, &s.Title, &s.MediaType, &s.UnitLabel, &s.TotalUnits)

	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Series{}, ErrNotFound
	}
	if err != nil {
		return domain.Series{}, fmt.Errorf("querying series %s: %w", id, err)
	}
	return s, nil
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
