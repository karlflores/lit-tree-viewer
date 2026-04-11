//go:build integration

package db

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"lit-tree-viewer/internal/domain"
)

// ── shared pool ───────────────────────────────────────────────────────────────

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://littree:littree@localhost:5432/littree"
	}

	ctx := context.Background()
	pool, err := Connect(ctx, dbURL)
	if err != nil {
		// Print instead of Fatal — os.Exit is needed in TestMain.
		println("SKIP: cannot connect to test database:", err.Error())
		os.Exit(0)
	}
	testPool = pool
	defer pool.Close()

	insertFixtures(ctx, pool)
	code := m.Run()
	deleteFixtures(ctx, pool)

	os.Exit(code)
}

// ── fixtures ──────────────────────────────────────────────────────────────────
//
// All IDs use the ff…ff prefix to avoid colliding with seed data.
//
// Characters:
//   charA  introduced_at=1  (present from the start; renamed at unit 3)
//   charB  introduced_at=1  (present from the start)
//   charC  introduced_at=5  (appears mid-way)
//
// Relationships (label is canonical; kind retained for legacy column):
//   relPerm   charA ↔ charB  ally    introduced=1  ended=nil  (always present)
//   relEnds   charA → charB  rival   introduced=1  ended=4    (gone by unit 5)
//   relLate   charB ↔ charC  family  introduced=5  ended=nil  (appears at unit 5)
//
// Renames:
//   charA renamed to "Char A Renamed" at unit 3
//
// Expected counts:
//   unit 1  →  chars: 2 (A,B)    rels: 2 (perm, ends; ended_at=4 >= 1)
//   unit 4  →  chars: 2          rels: 2 (perm, ends; ended_at=4 >= 4)
//   unit 5  →  chars: 3 (A,B,C)  rels: 2 (perm, late; ends excluded because ended_at=4 < 5)
//   unit 10 →  chars: 3          rels: 2 (perm, late)

var (
	testSeriesID = uuid.MustParse("ffffffff-ffff-ffff-ffff-000000000001")
	charAID      = uuid.MustParse("ffffffff-ffff-ffff-0001-000000000001")
	charBID      = uuid.MustParse("ffffffff-ffff-ffff-0001-000000000002")
	charCID      = uuid.MustParse("ffffffff-ffff-ffff-0001-000000000003")
)

func insertFixtures(ctx context.Context, pool *pgxpool.Pool) {
	mustExec(ctx, pool, `
		INSERT INTO series (id, title, media_type, unit_label, total_units)
		VALUES ($1, 'Integration Test Series', 'book', 'Chapter', 10)
		ON CONFLICT (id) DO NOTHING
	`, testSeriesID)

	mustExec(ctx, pool, `
		INSERT INTO characters (id, series_id, name, aliases, introduced_at)
		VALUES
		  ($1, $4, 'Char A', '{}', 1),
		  ($2, $4, 'Char B', '{}', 1),
		  ($3, $4, 'Char C', '{}', 5)
		ON CONFLICT (id) DO NOTHING
	`, charAID, charBID, charCID, testSeriesID)

	mustExec(ctx, pool, `
		INSERT INTO relationships (series_id, from_id, to_id, kind, label, directed, introduced_at, ended_at)
		VALUES
		  ($1, $2, $3, 'ally',   'ally',   false, 1, NULL),
		  ($1, $2, $3, 'rival',  'rival',  true,  1, 4),
		  ($1, $3, $4, 'family', 'family', false, 5, NULL)
	`, testSeriesID, charAID, charBID, charCID)

	mustExec(ctx, pool, `
		INSERT INTO character_renames (character_id, series_id, name, introduced_at)
		VALUES ($1, $2, 'Char A Renamed', 3)
	`, charAID, testSeriesID)
}

func deleteFixtures(ctx context.Context, pool *pgxpool.Pool) {
	// Cascade handles characters, relationships, and character_renames automatically.
	mustExec(ctx, pool, `DELETE FROM series WHERE id = $1`, testSeriesID)
}

func mustExec(ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		panic("fixture setup failed: " + err.Error())
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

func countByName(chars []domain.Character, name string) int {
	n := 0
	for _, c := range chars {
		if c.Name == name {
			n++
		}
	}
	return n
}

// ── GetAllSeries ──────────────────────────────────────────────────────────────

func TestGetAllSeries_ContainsTestSeries(t *testing.T) {
	ctx := context.Background()
	all, err := GetAllSeries(ctx, testPool)
	if err != nil {
		t.Fatalf("GetAllSeries: %v", err)
	}

	found := false
	for _, s := range all {
		if s.ID == testSeriesID {
			found = true
			if s.Title != "Integration Test Series" {
				t.Errorf("title: want %q, got %q", "Integration Test Series", s.Title)
			}
			if s.TotalUnits != 10 {
				t.Errorf("total_units: want 10, got %d", s.TotalUnits)
			}
		}
	}
	if !found {
		t.Error("test series not found in GetAllSeries results")
	}
}

func TestGetAllSeries_OrderedByTitle(t *testing.T) {
	ctx := context.Background()
	all, err := GetAllSeries(ctx, testPool)
	if err != nil {
		t.Fatalf("GetAllSeries: %v", err)
	}
	for i := 1; i < len(all); i++ {
		if all[i].Title < all[i-1].Title {
			t.Errorf("results not ordered by title: %q before %q", all[i-1].Title, all[i].Title)
		}
	}
}

// ── GetSeriesByID ─────────────────────────────────────────────────────────────

func TestGetSeriesByID_Found(t *testing.T) {
	ctx := context.Background()
	s, err := GetSeriesByID(ctx, testPool, testSeriesID)
	if err != nil {
		t.Fatalf("GetSeriesByID: %v", err)
	}
	if s.ID != testSeriesID {
		t.Errorf("id: want %s, got %s", testSeriesID, s.ID)
	}
	if s.MediaType != domain.MediaBook {
		t.Errorf("mediaType: want book, got %s", s.MediaType)
	}
	if s.UnitLabel != "Chapter" {
		t.Errorf("unitLabel: want Chapter, got %s", s.UnitLabel)
	}
	// author and group_type are NULL for manually-inserted test series
	if s.Author != nil {
		t.Errorf("author: want nil for test series, got %v", s.Author)
	}
}

func TestGetSeriesByID_NotFound(t *testing.T) {
	ctx := context.Background()
	unknown := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	_, err := GetSeriesByID(ctx, testPool, unknown)
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

// ── GetCharactersAt ───────────────────────────────────────────────────────────

func TestGetCharactersAt_Unit1(t *testing.T) {
	ctx := context.Background()
	chars, err := GetCharactersAt(ctx, testPool, testSeriesID, 1)
	if err != nil {
		t.Fatalf("GetCharactersAt: %v", err)
	}
	if len(chars) != 2 {
		t.Fatalf("want 2 characters at unit 1, got %d: %v", len(chars), chars)
	}
	if countByName(chars, "Char A") != 1 {
		t.Error("expected Char A in results")
	}
	if countByName(chars, "Char B") != 1 {
		t.Error("expected Char B in results")
	}
}

func TestGetCharactersAt_Unit5_IncludesLateEntry(t *testing.T) {
	ctx := context.Background()
	chars, err := GetCharactersAt(ctx, testPool, testSeriesID, 5)
	if err != nil {
		t.Fatalf("GetCharactersAt: %v", err)
	}
	if len(chars) != 3 {
		t.Fatalf("want 3 characters at unit 5, got %d", len(chars))
	}
	if countByName(chars, "Char C") != 1 {
		t.Error("expected Char C (introduced_at=5) in results at unit 5")
	}
}

func TestGetCharactersAt_Unit4_ExcludesLateEntry(t *testing.T) {
	ctx := context.Background()
	chars, err := GetCharactersAt(ctx, testPool, testSeriesID, 4)
	if err != nil {
		t.Fatalf("GetCharactersAt: %v", err)
	}
	if len(chars) != 2 {
		t.Fatalf("want 2 characters at unit 4, got %d", len(chars))
	}
	if countByName(chars, "Char C") != 0 {
		t.Error("Char C (introduced_at=5) should not appear at unit 4")
	}
}

func TestGetCharactersAt_WrongSeries_ReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	other := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	chars, err := GetCharactersAt(ctx, testPool, other, 100)
	if err != nil {
		t.Fatalf("GetCharactersAt: %v", err)
	}
	if len(chars) != 0 {
		t.Errorf("want 0 characters for unknown series, got %d", len(chars))
	}
}

func TestGetCharactersAt_ReturnsInitialNameBeforeRename(t *testing.T) {
	ctx := context.Background()
	// Char A is renamed at unit 3; at unit 2 the original name should be returned.
	chars, err := GetCharactersAt(ctx, testPool, testSeriesID, 2)
	if err != nil {
		t.Fatalf("GetCharactersAt: %v", err)
	}
	if countByName(chars, "Char A") != 1 {
		t.Errorf("expected original name 'Char A' before rename at unit 2; got %v", chars)
	}
	if countByName(chars, "Char A Renamed") != 0 {
		t.Error("renamed name should not appear before rename block")
	}
}

func TestGetCharactersAt_ReturnsRenamedNameAfterRename(t *testing.T) {
	ctx := context.Background()
	// Char A is renamed to "Char A Renamed" at unit 3.
	chars, err := GetCharactersAt(ctx, testPool, testSeriesID, 3)
	if err != nil {
		t.Fatalf("GetCharactersAt: %v", err)
	}
	if countByName(chars, "Char A Renamed") != 1 {
		t.Errorf("expected renamed name at unit 3; got %v", chars)
	}
	if countByName(chars, "Char A") != 0 {
		t.Error("original name should not appear after rename")
	}
}

// ── GetRelationshipsAt ────────────────────────────────────────────────────────

func TestGetRelationshipsAt_Unit1(t *testing.T) {
	ctx := context.Background()
	rels, err := GetRelationshipsAt(ctx, testPool, testSeriesID, 1)
	if err != nil {
		t.Fatalf("GetRelationshipsAt: %v", err)
	}
	// relPerm (1, nil) and relEnds (1, 4) — ended_at=4 >= 1, so included
	if len(rels) != 2 {
		t.Fatalf("want 2 relationships at unit 1, got %d", len(rels))
	}
}

func TestGetRelationshipsAt_Unit4_EndingRelationshipStillPresent(t *testing.T) {
	ctx := context.Background()
	rels, err := GetRelationshipsAt(ctx, testPool, testSeriesID, 4)
	if err != nil {
		t.Fatalf("GetRelationshipsAt: %v", err)
	}
	// relEnds ended_at=4, and 4 >= 4, so still included
	if len(rels) != 2 {
		t.Fatalf("want 2 relationships at unit 4, got %d", len(rels))
	}
}

func TestGetRelationshipsAt_Unit5_EndedRelationshipExcluded(t *testing.T) {
	ctx := context.Background()
	rels, err := GetRelationshipsAt(ctx, testPool, testSeriesID, 5)
	if err != nil {
		t.Fatalf("GetRelationshipsAt: %v", err)
	}
	// relEnds ended_at=4 < 5 → excluded; relLate introduced_at=5 → included
	if len(rels) != 2 {
		t.Fatalf("want 2 relationships at unit 5, got %d", len(rels))
	}
	for _, r := range rels {
		if r.Label == "rival" {
			t.Error("rival relationship (ended_at=4) should not appear at unit 5")
		}
	}
}

func TestGetRelationshipsAt_LabelIsCanonical(t *testing.T) {
	ctx := context.Background()
	rels, err := GetRelationshipsAt(ctx, testPool, testSeriesID, 1)
	if err != nil {
		t.Fatalf("GetRelationshipsAt: %v", err)
	}
	for _, r := range rels {
		if r.Label == "" {
			t.Errorf("relationship %s has empty label; label is required", r.ID)
		}
	}
}

func TestGetRelationshipsAt_Unit10(t *testing.T) {
	ctx := context.Background()
	rels, err := GetRelationshipsAt(ctx, testPool, testSeriesID, 10)
	if err != nil {
		t.Fatalf("GetRelationshipsAt: %v", err)
	}
	// relPerm (1, nil) and relLate (5, nil)
	if len(rels) != 2 {
		t.Fatalf("want 2 relationships at unit 10, got %d", len(rels))
	}
}

func TestGetRelationshipsAt_WrongSeries_ReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	other := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	rels, err := GetRelationshipsAt(ctx, testPool, other, 100)
	if err != nil {
		t.Fatalf("GetRelationshipsAt: %v", err)
	}
	if len(rels) != 0 {
		t.Errorf("want 0 relationships for unknown series, got %d", len(rels))
	}
}

// ── GetGraphSnapshot ──────────────────────────────────────────────────────────

func TestGetGraphSnapshot_ComposesCorrectly(t *testing.T) {
	ctx := context.Background()
	snap, err := GetGraphSnapshot(ctx, testPool, testSeriesID, 5)
	if err != nil {
		t.Fatalf("GetGraphSnapshot: %v", err)
	}

	if snap.Series.ID != testSeriesID {
		t.Errorf("snapshot series ID mismatch")
	}
	if snap.AtUnit != 5 {
		t.Errorf("AtUnit: want 5, got %d", snap.AtUnit)
	}
	if len(snap.Characters) != 3 {
		t.Errorf("want 3 characters at unit 5, got %d", len(snap.Characters))
	}
	if len(snap.Relationships) != 2 {
		t.Errorf("want 2 relationships at unit 5, got %d", len(snap.Relationships))
	}
}

func TestGetGraphSnapshot_PopulatesRenames(t *testing.T) {
	ctx := context.Background()
	// At unit 5, charA has been renamed (rename at unit 3).
	snap, err := GetGraphSnapshot(ctx, testPool, testSeriesID, 5)
	if err != nil {
		t.Fatalf("GetGraphSnapshot: %v", err)
	}

	var charA *domain.Character
	for i := range snap.Characters {
		if snap.Characters[i].ID == charAID {
			charA = &snap.Characters[i]
			break
		}
	}
	if charA == nil {
		t.Fatal("charA not found in snapshot")
	}
	if len(charA.Renames) != 1 {
		t.Fatalf("want 1 rename on charA, got %d", len(charA.Renames))
	}
	if charA.Renames[0].Name != "Char A Renamed" {
		t.Errorf("rename name: want 'Char A Renamed', got %q", charA.Renames[0].Name)
	}
	if charA.Renames[0].IntroducedAt != 3 {
		t.Errorf("rename introducedAt: want 3, got %d", charA.Renames[0].IntroducedAt)
	}
}

func TestGetGraphSnapshot_RenamesAbsentBeforeRenameBlock(t *testing.T) {
	ctx := context.Background()
	// At unit 2, charA's rename (unit 3) has not happened yet.
	snap, err := GetGraphSnapshot(ctx, testPool, testSeriesID, 2)
	if err != nil {
		t.Fatalf("GetGraphSnapshot: %v", err)
	}

	for _, c := range snap.Characters {
		if c.ID == charAID && len(c.Renames) != 0 {
			t.Errorf("want no renames on charA at unit 2, got %d", len(c.Renames))
		}
	}
}

func TestGetGraphSnapshot_NotFound(t *testing.T) {
	ctx := context.Background()
	unknown := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	_, err := GetGraphSnapshot(ctx, testPool, unknown, 1)
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

// ── Connect ───────────────────────────────────────────────────────────────────

func TestConnect_BadURL(t *testing.T) {
	ctx := context.Background()
	_, err := Connect(ctx, "postgres://bad:bad@localhost:9999/nope")
	if err == nil {
		t.Fatal("expected error connecting to unreachable host, got nil")
	}
}
