package db

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"lit-tree-viewer/internal/domain"
)

// PGStore wraps a pgxpool.Pool and satisfies the api.Store interface.
type PGStore struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

func (s *PGStore) GetAllSeries(ctx context.Context) ([]domain.Series, error) {
	return GetAllSeries(ctx, s.pool)
}

func (s *PGStore) GetSeriesByID(ctx context.Context, id uuid.UUID) (domain.Series, error) {
	return GetSeriesByID(ctx, s.pool, id)
}

func (s *PGStore) GetGraphSnapshot(ctx context.Context, seriesID uuid.UUID, atUnit int) (domain.GraphSnapshot, error) {
	return GetGraphSnapshot(ctx, s.pool, seriesID, atUnit)
}

func (s *PGStore) GetCompiledGraph(ctx context.Context, seriesID uuid.UUID) (domain.CompiledGraph, error) {
	return GetCompiledGraph(ctx, s.pool, seriesID)
}
