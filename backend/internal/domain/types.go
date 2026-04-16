package domain

import "github.com/google/uuid"

// MediaType represents the kind of serialised fiction.
type MediaType string

const (
	MediaBook MediaType = "book"
	MediaShow MediaType = "show"
	MediaFilm MediaType = "film"
)

// RelationshipKind is the legacy enum for seed-data relationships.
// LTG-imported relationships use a free-form Label instead.
type RelationshipKind string

const (
	KindFamily      RelationshipKind = "family"
	KindParentChild RelationshipKind = "parent_child"
	KindRomantic    RelationshipKind = "romantic"
	KindAlly        RelationshipKind = "ally"
	KindRival       RelationshipKind = "rival"
	KindEnemy       RelationshipKind = "enemy"
	KindMentor      RelationshipKind = "mentor"
	KindOther       RelationshipKind = "other"
)

// Series is the top-level container for a graph.
// Author and GroupType are populated only for LTG-imported series; nil for seed data.
type Series struct {
	ID             uuid.UUID         `json:"id"`
	Title          string            `json:"title"`
	MediaType      MediaType         `json:"mediaType"`
	UnitLabel      string            `json:"unitLabel"`
	TotalUnits     int               `json:"totalUnits"`
	Author         *string           `json:"author,omitempty"`         // from `metadata author:`
	GroupType      *string           `json:"groupType,omitempty"`      // from `set group:`
	CustomMetadata map[string]string `json:"customMetadata,omitempty"` // from arbitrary `metadata <key>:` tags
	Published      bool              `json:"published"`
}

// SeriesSummary is a lightweight projection used by the browse/search endpoint.
// CharacterCount is a derived aggregate — not stored on the row.
type SeriesSummary struct {
	ID             uuid.UUID `json:"id"`
	Title          string    `json:"title"`
	MediaType      MediaType `json:"mediaType"`
	UnitLabel      string    `json:"unitLabel"`
	TotalUnits     int       `json:"totalUnits"`
	Author         *string   `json:"author,omitempty"`
	Published      bool      `json:"published"`
	CharacterCount int       `json:"characterCount"`
}

// SearchParams holds the validated query parameters for the series search endpoint.
type SearchParams struct {
	Q          string   // keyword filter against title and author
	MediaTypes []string // empty = all; otherwise one or more of "book", "show", "film"
	SortBy     string   // "title" | "author" | "media_type" | "total_units" | "character_count"
	SortDir    string   // "asc" | "desc"
	Limit      int
	Offset     int
}

// SearchResult wraps a paginated list of SeriesSummary rows.
type SearchResult struct {
	Results []SeriesSummary `json:"results"`
	Total   int             `json:"total"`
}

// ---------------------------------------------------------------------------
// Import payload types — used by POST /api/series and PATCH /api/series/:id
// ---------------------------------------------------------------------------

// ImportSeries carries the series-level fields from an edit-mode graph.
// The ID is omitted — POST creates a new one, PATCH uses the URL parameter.
type ImportSeries struct {
	Title          string            `json:"title"`
	MediaType      MediaType         `json:"mediaType"`
	UnitLabel      string            `json:"unitLabel"`
	TotalUnits     int               `json:"totalUnits"`
	Author         *string           `json:"author,omitempty"`
	GroupType      *string           `json:"groupType,omitempty"`
	CustomMetadata map[string]string `json:"customMetadata,omitempty"`
}

// ImportCharacter carries one character from an edit-mode graph.
// The ID is client-generated (crypto.randomUUID) and used as the DB primary key.
type ImportCharacter struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Aliases      []string  `json:"aliases"`
	Description  *string   `json:"description,omitempty"`
	ImageURL     *string   `json:"imageUrl,omitempty"`
	IntroducedAt int       `json:"introducedAt"`
	DiedAt       *int      `json:"diedAt,omitempty"`
}

// ImportRelationship carries one relationship from an edit-mode graph.
type ImportRelationship struct {
	ID           uuid.UUID         `json:"id"`
	FromID       uuid.UUID         `json:"fromId"`
	ToID         uuid.UUID         `json:"toId"`
	Kind         *RelationshipKind `json:"kind,omitempty"`
	Label        string            `json:"label"`
	Directed     bool              `json:"directed"`
	IntroducedAt int               `json:"introducedAt"`
	EndedAt      *int              `json:"endedAt,omitempty"`
}

// ImportPayload is the full request body for POST /api/series and PATCH /api/series/:id.
type ImportPayload struct {
	Series        ImportSeries        `json:"series"`
	Characters    []ImportCharacter   `json:"characters"`
	Relationships []ImportRelationship `json:"relationships"`
}

// CharacterRename records one temporal name change for a character.
// The effective display name at block N is the most recent rename with
// IntroducedAt <= N, falling back to Character.Name when none exists.
type CharacterRename struct {
	Name         string `json:"name"`
	IntroducedAt int    `json:"introducedAt"`
}

// Character is a node in the graph.
// Name is the initial name from the actor declaration — the identity anchor.
// The graph API resolves the effective display name server-side and returns it
// in Name; Renames carries the full history up to the queried unit so the
// character panel can show previous names.
// DiedAt is nil if the character is still alive or their fate is unknown.
// LtgIdentifier is the identifier used in the source .ltg file; nil for
// records not created via LTG import. Required for round-trip export fidelity.
type Character struct {
	ID            uuid.UUID        `json:"id"`
	SeriesID      uuid.UUID        `json:"seriesId"`
	Name          string           `json:"name"`
	Aliases       []string         `json:"aliases"`
	Renames       []CharacterRename `json:"renames,omitempty"`
	Description   *string          `json:"description"`
	ImageURL      *string          `json:"imageUrl"`
	IntroducedAt  int              `json:"introducedAt"`
	DiedAt        *int             `json:"diedAt"`
	LtgIdentifier *string          `json:"ltgIdentifier,omitempty"`
}

// Relationship is an edge in the graph.
// Directed=false means the relationship is symmetric (e.g. siblings).
// Directed=true means FromID → ToID carries semantic meaning (e.g. parent → child).
//
// Label is the canonical relationship identifier — free-form for LTG-imported series,
// backfilled from Kind for legacy seed-data series.
// Kind is the legacy enum; nil for LTG-imported relationships.
type Relationship struct {
	ID           uuid.UUID         `json:"id"`
	SeriesID     uuid.UUID         `json:"seriesId"`
	FromID       uuid.UUID         `json:"fromId"`
	ToID         uuid.UUID         `json:"toId"`
	Kind         *RelationshipKind `json:"kind,omitempty"`
	Label        string            `json:"label"`
	Directed     bool              `json:"directed"`
	IntroducedAt int               `json:"introducedAt"`
	EndedAt      *int              `json:"endedAt"`
}

// Block records one unit of time in a series timeline.
// Persists the display label and group membership produced by the LTG compiler
// so the scrubber can render them without recompiling the source.
type Block struct {
	ID         uuid.UUID `json:"id"`
	SeriesID   uuid.UUID `json:"seriesId"`
	BlockIndex int       `json:"blockIndex"`
	Label      *string   `json:"label,omitempty"`      // optional display label, e.g. "The Storm"
	GroupLabel *string   `json:"groupLabel,omitempty"` // enclosing group label, e.g. "Season 1"
}

// SeriesColour maps a relationship label to a hex colour for one series.
// Populated by the LTG compiler from hash defaults + set colour: overrides.
type SeriesColour struct {
	SeriesID   uuid.UUID `json:"seriesId"`
	Label      string    `json:"label"`
	Hex        string    `json:"hex"`
	IsOverride bool      `json:"isOverride"` // true = from `set colour:` directive
}

// GraphSnapshot is the full graph state at a given chapter/episode.
// The server performs all temporal filtering — the client receives only
// what is visible at AtUnit.
type GraphSnapshot struct {
	Series        Series         `json:"series"`
	Characters    []Character    `json:"characters"`
	Relationships []Relationship `json:"relationships"`
	AtUnit        int            `json:"atUnit"`
}

// CompiledCharacter is the full history shape used by the LTG emitter.
// Identifier is the LTG source identifier (ltg_identifier column); falls back
// to the UUID string for legacy records without one.
type CompiledCharacter struct {
	Identifier   string            `json:"identifier"`
	Name         string            `json:"name"`
	Aliases      []string          `json:"aliases"`
	Renames      []CharacterRename `json:"renames"`
	IntroducedAt int               `json:"introducedAt"`
	DiedAt       *int              `json:"diedAt"`
}

// CompiledRelationship is the full history shape used by the LTG emitter.
// Identifiers reference the LTG source identifiers of the endpoint characters.
type CompiledRelationship struct {
	FromIdentifier string `json:"fromIdentifier"`
	ToIdentifier   string `json:"toIdentifier"`
	Label          string `json:"label"`
	Directed       bool   `json:"directed"`
	IntroducedAt   int    `json:"introducedAt"`
	EndedAt        *int   `json:"endedAt"`
}

// CompiledBlock is the timeline unit shape used by the LTG emitter.
type CompiledBlock struct {
	Index      int     `json:"index"`
	Label      *string `json:"label"`
	GroupLabel *string `json:"groupLabel"`
}

// CompiledGraph is the full graph history for a series, matching the
// CompileSuccess shape expected by the frontend ltgEmitter.
// Only explicit set colour: overrides are included in Colours so that the
// emitter can round-trip them without emitting hash-derived defaults.
type CompiledGraph struct {
	Series        Series                 `json:"series"`
	Characters    []CompiledCharacter    `json:"characters"`
	Relationships []CompiledRelationship `json:"relationships"`
	Colours       map[string]string      `json:"colours"`
	Blocks        []CompiledBlock        `json:"blocks"`
}
