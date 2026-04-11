package api

import (
	"context"

	"github.com/google/uuid"

	"lit-tree-viewer/internal/domain"
)

// Store is the subset of database operations the API handlers need.
// Keeping the interface here (at the point of use) makes the api package
// independent of any particular storage implementation.
type Store interface {
	GetAllSeries(ctx context.Context) ([]domain.Series, error)
	GetSeriesByID(ctx context.Context, id uuid.UUID) (domain.Series, error)
	GetGraphSnapshot(ctx context.Context, seriesID uuid.UUID, atUnit int) (domain.GraphSnapshot, error)
}
