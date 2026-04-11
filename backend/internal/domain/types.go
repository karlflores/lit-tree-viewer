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
type Series struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	MediaType  MediaType `json:"mediaType"`
	UnitLabel  string    `json:"unitLabel"`
	TotalUnits int       `json:"totalUnits"`
}

// Character is a node in the graph.
// DiedAt is nil if the character is still alive or their fate is unknown.
// LtgIdentifier is the identifier used in the source .ltg file; nil for
// records not created via LTG import. Required for round-trip export fidelity.
type Character struct {
	ID            uuid.UUID `json:"id"`
	SeriesID      uuid.UUID `json:"seriesId"`
	Name          string    `json:"name"`
	Aliases       []string  `json:"aliases"`
	Description   *string   `json:"description"`
	ImageURL      *string   `json:"imageUrl"`
	IntroducedAt  int       `json:"introducedAt"`
	DiedAt        *int      `json:"diedAt"`
	LtgIdentifier *string   `json:"ltgIdentifier,omitempty"`
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
