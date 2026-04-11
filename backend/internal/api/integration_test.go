//go:build integration

package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"lit-tree-viewer/internal/db"
	"lit-tree-viewer/internal/domain"
)

// ── shared state ──────────────────────────────────────────────────────────────

var (
	integrationRouter *gin.Engine

	apiSeriesID = uuid.MustParse("ffffffff-ffff-ffff-ffff-000000000002")
	apiCharAID  = uuid.MustParse("ffffffff-ffff-ffff-0002-000000000001")
	apiCharBID  = uuid.MustParse("ffffffff-ffff-ffff-0002-000000000002")
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)

	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://littree:littree@localhost:5432/littree"
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, dbURL)
	if err != nil {
		println("SKIP: cannot connect to test database:", err.Error())
		os.Exit(0)
	}
	defer pool.Close()

	insertAPIFixtures(ctx, pool)
	integrationRouter = NewRouter(db.NewStore(pool))
	code := m.Run()
	deleteAPIFixtures(ctx, pool)

	os.Exit(code)
}

// ── fixtures ──────────────────────────────────────────────────────────────────
//
// Series: apiSeriesID — "API Test Series", 10 chapters
// charA: introduced_at=1
// charB: introduced_at=5
// relationship: charA ↔ charB, ally, introduced_at=5

func insertAPIFixtures(ctx context.Context, pool *pgxpool.Pool) {
	mustExec(ctx, pool, `
		INSERT INTO series (id, title, media_type, unit_label, total_units)
		VALUES ($1, 'API Test Series', 'book', 'Chapter', 10)
		ON CONFLICT (id) DO NOTHING
	`, apiSeriesID)

	mustExec(ctx, pool, `
		INSERT INTO characters (id, series_id, name, aliases, introduced_at)
		VALUES
		  ($1, $3, 'API Char A', '{}', 1),
		  ($2, $3, 'API Char B', '{}', 5)
		ON CONFLICT (id) DO NOTHING
	`, apiCharAID, apiCharBID, apiSeriesID)

	mustExec(ctx, pool, `
		INSERT INTO relationships (series_id, from_id, to_id, kind, directed, introduced_at)
		VALUES ($1, $2, $3, 'ally', false, 5)
	`, apiSeriesID, apiCharAID, apiCharBID)
}

func deleteAPIFixtures(ctx context.Context, pool *pgxpool.Pool) {
	mustExec(ctx, pool, `DELETE FROM series WHERE id = $1`, apiSeriesID)
}

func mustExec(ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		panic("fixture setup failed: " + err.Error())
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

func apiDo(t *testing.T, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	req, err := http.NewRequest(method, path, nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	integrationRouter.ServeHTTP(w, req)
	return w
}

// ── GET /api/series ───────────────────────────────────────────────────────────

func TestIntegration_ListSeries_OK(t *testing.T) {
	w := apiDo(t, "GET", "/api/series")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body)
	}

	var got []domain.Series
	decodeJSON(t, w.Body.Bytes(), &got)

	found := false
	for _, s := range got {
		if s.ID == apiSeriesID {
			found = true
			if s.Title != "API Test Series" {
				t.Errorf("title: want %q, got %q", "API Test Series", s.Title)
			}
		}
	}
	if !found {
		t.Error("test series not present in /api/series response")
	}
}

func TestIntegration_ListSeries_ContentType(t *testing.T) {
	w := apiDo(t, "GET", "/api/series")

	ct := w.Header().Get("Content-Type")
	if ct == "" {
		t.Error("Content-Type header missing")
	}
}

// ── GET /api/series/:id ───────────────────────────────────────────────────────

func TestIntegration_GetSeries_OK(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String())

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body)
	}

	var got domain.Series
	decodeJSON(t, w.Body.Bytes(), &got)

	if got.ID != apiSeriesID {
		t.Errorf("id mismatch: want %s, got %s", apiSeriesID, got.ID)
	}
	if got.TotalUnits != 10 {
		t.Errorf("total_units: want 10, got %d", got.TotalUnits)
	}
	if got.UnitLabel != "Chapter" {
		t.Errorf("unit_label: want Chapter, got %s", got.UnitLabel)
	}
}

func TestIntegration_GetSeries_InvalidUUID(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/not-a-uuid")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestIntegration_GetSeries_NotFound(t *testing.T) {
	unknown := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	w := apiDo(t, "GET", "/api/series/"+unknown.String())

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

// ── GET /api/series/:id/graph ─────────────────────────────────────────────────

func TestIntegration_GetGraphSnapshot_Unit1(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String()+"/graph?at=1")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body)
	}

	var got domain.GraphSnapshot
	decodeJSON(t, w.Body.Bytes(), &got)

	if got.AtUnit != 1 {
		t.Errorf("atUnit: want 1, got %d", got.AtUnit)
	}
	// Only charA introduced at unit 1; charB introduced at unit 5
	if len(got.Characters) != 1 {
		t.Errorf("want 1 character at unit 1, got %d", len(got.Characters))
	}
	// Relationship introduced at unit 5 — not yet visible
	if len(got.Relationships) != 0 {
		t.Errorf("want 0 relationships at unit 1, got %d", len(got.Relationships))
	}
}

func TestIntegration_GetGraphSnapshot_Unit5(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String()+"/graph?at=5")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body)
	}

	var got domain.GraphSnapshot
	decodeJSON(t, w.Body.Bytes(), &got)

	if len(got.Characters) != 2 {
		t.Errorf("want 2 characters at unit 5, got %d", len(got.Characters))
	}
	if len(got.Relationships) != 1 {
		t.Errorf("want 1 relationship at unit 5, got %d", len(got.Relationships))
	}
	if got.Relationships[0].Kind != domain.KindAlly {
		t.Errorf("relationship kind: want ally, got %s", got.Relationships[0].Kind)
	}
}

func TestIntegration_GetGraphSnapshot_DefaultUnit(t *testing.T) {
	// No ?at param — should default to unit 1
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String()+"/graph")

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body)
	}

	var got domain.GraphSnapshot
	decodeJSON(t, w.Body.Bytes(), &got)
	if got.AtUnit != 1 {
		t.Errorf("default atUnit: want 1, got %d", got.AtUnit)
	}
}

func TestIntegration_GetGraphSnapshot_InvalidUUID(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/bad-id/graph?at=1")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestIntegration_GetGraphSnapshot_AtZero(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String()+"/graph?at=0")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestIntegration_GetGraphSnapshot_AtNonNumeric(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String()+"/graph?at=abc")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestIntegration_GetGraphSnapshot_NotFound(t *testing.T) {
	unknown := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	w := apiDo(t, "GET", "/api/series/"+unknown.String()+"/graph?at=1")

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestIntegration_GetGraphSnapshot_SeriesEmbedded(t *testing.T) {
	w := apiDo(t, "GET", "/api/series/"+apiSeriesID.String()+"/graph?at=5")

	var got domain.GraphSnapshot
	decodeJSON(t, w.Body.Bytes(), &got)

	if got.Series.ID != apiSeriesID {
		t.Errorf("embedded series ID mismatch")
	}
	if got.Series.Title != "API Test Series" {
		t.Errorf("embedded series title: want %q, got %q", "API Test Series", got.Series.Title)
	}
}

// ── CORS ──────────────────────────────────────────────────────────────────────

func TestIntegration_CORS_HeadersOnRealResponse(t *testing.T) {
	w := apiDo(t, "GET", "/api/series")

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("CORS origin: want http://localhost:5173, got %q", got)
	}
}

func TestIntegration_CORS_OptionsReturns204(t *testing.T) {
	w := apiDo(t, "OPTIONS", "/api/series")

	if w.Code != http.StatusNoContent {
		t.Errorf("OPTIONS: want 204, got %d", w.Code)
	}
}
