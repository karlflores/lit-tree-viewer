package domain

import "github.com/google/uuid"

// MediaType represents the kind of serialised fiction.
type MediaType string

const (
	MediaBook MediaType = "book"
	MediaShow MediaType = "show"
	MediaFilm MediaType = "film"
)

// RelationshipKind drives visual styling of edges.
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
type Character struct {
	ID           uuid.UUID `json:"id"`
	SeriesID     uuid.UUID `json:"seriesId"`
	Name         string    `json:"name"`
	Aliases      []string  `json:"aliases"`
	Description  *string   `json:"description"`
	ImageURL     *string   `json:"imageUrl"`
	IntroducedAt int       `json:"introducedAt"`
	DiedAt       *int      `json:"diedAt"`
}

// Relationship is an edge in the graph.
// Directed=false means the relationship is symmetric (e.g. siblings).
// Directed=true means FromID → ToID carries semantic meaning (e.g. parent → child).
type Relationship struct {
	ID           uuid.UUID        `json:"id"`
	SeriesID     uuid.UUID        `json:"seriesId"`
	FromID       uuid.UUID        `json:"fromId"`
	ToID         uuid.UUID        `json:"toId"`
	Kind         RelationshipKind `json:"kind"`
	Label        *string          `json:"label"`
	Directed     bool             `json:"directed"`
	IntroducedAt int              `json:"introducedAt"`
	EndedAt      *int             `json:"endedAt"`
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
