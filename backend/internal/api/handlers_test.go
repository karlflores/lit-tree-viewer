package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"lit-tree-viewer/internal/db"
	"lit-tree-viewer/internal/domain"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ── mock store ────────────────────────────────────────────────────────────────

type mockStore struct {
	allSeries   []domain.Series
	allSeriesErr error

	series    domain.Series
	seriesErr error

	snapshot    domain.GraphSnapshot
	snapshotErr error

	fullGraph    domain.GraphSnapshot
	fullGraphErr error
}

func (m *mockStore) GetAllSeries(_ context.Context) ([]domain.Series, error) {
	return m.allSeries, m.allSeriesErr
}

func (m *mockStore) GetSeriesByID(_ context.Context, _ uuid.UUID) (domain.Series, error) {
	return m.series, m.seriesErr
}

func (m *mockStore) GetGraphSnapshot(_ context.Context, _ uuid.UUID, _ int) (domain.GraphSnapshot, error) {
	return m.snapshot, m.snapshotErr
}

func (m *mockStore) GetFullGraph(_ context.Context, _ uuid.UUID) (domain.GraphSnapshot, error) {
	return m.fullGraph, m.fullGraphErr
}

func (m *mockStore) GetCompiledGraph(_ context.Context, _ uuid.UUID) (domain.CompiledGraph, error) {
	return domain.CompiledGraph{}, nil
}

// ── fixtures ──────────────────────────────────────────────────────────────────

var (
	seriesID = uuid.MustParse("11111111-1111-1111-1111-111111111111")

	fixSeries = domain.Series{
		ID:         seriesID,
		Title:      "The Count of Monte Cristo",
		MediaType:  domain.MediaBook,
		UnitLabel:  "Chapter",
		TotalUnits: 117,
	}

	fixSnapshot = domain.GraphSnapshot{
		Series:        fixSeries,
		Characters:    []domain.Character{},
		Relationships: []domain.Relationship{},
		AtUnit:        5,
	}
)

// ── helpers ───────────────────────────────────────────────────────────────────

func newRouter(store Store) *gin.Engine {
	r := gin.New()
	v1 := r.Group("/api")
	v1.GET("/series", listSeries(store))
	v1.GET("/series/:id", getSeries(store))
	v1.GET("/series/:id/graph", getGraphSnapshot(store))
	v1.GET("/series/:id/graph/full", getFullGraph(store))
	return r
}

func do(t *testing.T, router *gin.Engine, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	req, err := http.NewRequest(method, path, nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	router.ServeHTTP(w, req)
	return w
}

func decodeJSON(t *testing.T, body []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(body, v); err != nil {
		t.Fatalf("decoding JSON: %v\nbody: %s", err, body)
	}
}

// ── listSeries ────────────────────────────────────────────────────────────────

func TestListSeries_OK(t *testing.T) {
	store := &mockStore{allSeries: []domain.Series{fixSeries}}
	w := do(t, newRouter(store), "GET", "/api/series")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}

	var got []domain.Series
	decodeJSON(t, w.Body.Bytes(), &got)

	if len(got) != 1 {
		t.Fatalf("want 1 series, got %d", len(got))
	}
	if got[0].Title != fixSeries.Title {
		t.Errorf("want title %q, got %q", fixSeries.Title, got[0].Title)
	}
}

func TestListSeries_EmptySlice(t *testing.T) {
	store := &mockStore{allSeries: []domain.Series{}}
	w := do(t, newRouter(store), "GET", "/api/series")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var got []domain.Series
	decodeJSON(t, w.Body.Bytes(), &got)
	if len(got) != 0 {
		t.Errorf("want empty slice, got %v", got)
	}
}

func TestListSeries_DBError(t *testing.T) {
	store := &mockStore{allSeriesErr: errors.New("connection refused")}
	w := do(t, newRouter(store), "GET", "/api/series")

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", w.Code)
	}
}

// ── getSeries ─────────────────────────────────────────────────────────────────

func TestGetSeries_OK(t *testing.T) {
	store := &mockStore{series: fixSeries}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String())

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}

	var got domain.Series
	decodeJSON(t, w.Body.Bytes(), &got)
	if got.ID != fixSeries.ID {
		t.Errorf("want id %s, got %s", fixSeries.ID, got.ID)
	}
}

func TestGetSeries_InvalidUUID(t *testing.T) {
	store := &mockStore{}
	w := do(t, newRouter(store), "GET", "/api/series/not-a-uuid")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestGetSeries_NotFound(t *testing.T) {
	store := &mockStore{seriesErr: db.ErrNotFound}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String())

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestGetSeries_DBError(t *testing.T) {
	store := &mockStore{seriesErr: errors.New("timeout")}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String())

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", w.Code)
	}
}

// ── getGraphSnapshot ──────────────────────────────────────────────────────────

func TestGetGraphSnapshot_OK(t *testing.T) {
	store := &mockStore{snapshot: fixSnapshot}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph?at=5")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}

	var got domain.GraphSnapshot
	decodeJSON(t, w.Body.Bytes(), &got)
	if got.AtUnit != 5 {
		t.Errorf("want atUnit 5, got %d", got.AtUnit)
	}
}

func TestGetGraphSnapshot_DefaultsToUnit1(t *testing.T) {
	store := &mockStore{snapshot: domain.GraphSnapshot{Series: fixSeries, AtUnit: 1}}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
}

func TestGetGraphSnapshot_InvalidUUID(t *testing.T) {
	store := &mockStore{}
	w := do(t, newRouter(store), "GET", "/api/series/bad-uuid/graph?at=1")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestGetGraphSnapshot_AtNotANumber(t *testing.T) {
	store := &mockStore{}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph?at=abc")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestGetGraphSnapshot_AtZero(t *testing.T) {
	store := &mockStore{}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph?at=0")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestGetGraphSnapshot_AtNegative(t *testing.T) {
	store := &mockStore{}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph?at=-1")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestGetGraphSnapshot_NotFound(t *testing.T) {
	store := &mockStore{snapshotErr: db.ErrNotFound}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph?at=1")

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestGetGraphSnapshot_DBError(t *testing.T) {
	store := &mockStore{snapshotErr: errors.New("timeout")}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph?at=1")

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", w.Code)
	}
}

// ── getFullGraph ──────────────────────────────────────────────────────────────

func TestGetFullGraph_OK(t *testing.T) {
	store := &mockStore{fullGraph: fixSnapshot}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph/full")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}

	var got domain.GraphSnapshot
	decodeJSON(t, w.Body.Bytes(), &got)
	if got.Series.ID != fixSeries.ID {
		t.Errorf("want series id %s, got %s", fixSeries.ID, got.Series.ID)
	}
}

func TestGetFullGraph_InvalidUUID(t *testing.T) {
	store := &mockStore{}
	w := do(t, newRouter(store), "GET", "/api/series/bad-uuid/graph/full")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestGetFullGraph_NotFound(t *testing.T) {
	store := &mockStore{fullGraphErr: db.ErrNotFound}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph/full")

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestGetFullGraph_DBError(t *testing.T) {
	store := &mockStore{fullGraphErr: errors.New("timeout")}
	w := do(t, newRouter(store), "GET", "/api/series/"+seriesID.String()+"/graph/full")

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", w.Code)
	}
}
