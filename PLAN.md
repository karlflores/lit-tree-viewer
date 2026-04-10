# LitTree — Interactive Character Relationship Viewer

> Inspired by reading *The Count of Monte Cristo*. A web app for exploring character
> relationships across a timeline of chapters or episodes — built for long-form fiction
> like Lord of the Rings, Harry Potter, and sprawling fantasy worlds.

---

## Vision

An interactive graph viewer where users can scrub through a chapter/episode timeline and
watch relationships between characters evolve in real time. Relationships appear, change
type, and dissolve as the story progresses. A character detail panel surfaces rich info
about each character — sourced automatically or entered manually.

Eventually doubles as an editor: create series, add characters, draw relationships, and
annotate when each one begins or ends.

---

## Design Decisions (Locked)

| Concern | Decision |
|---|---|
| Edge directionality | Both directed and undirected edges supported. Type determines direction. |
| Edge identity | Each edge has a **type** (drives visual style) and a **label** (human-readable, e.g. "adoptive father") |
| Graph layout | Force-directed to start. Layout options (hierarchical, manual) are a future feature. |
| Node positions | Re-run force layout on every data change. No persisted positions for now. |
| Timeline granularity | Integer only — chapters for books, episodes for shows. No fractional positions. |
| Series scope | Single series to start (proves the concept). Multi-series added alongside the editor. |
| Character data | Hybrid: automated enrichment (Wikipedia / fan wikis / AI) + manual user input as override |
| Dead characters | Remain visible as greyed-out nodes by default. Toggle to hide them entirely. |
| Play mode | Deferred — add once scrubber is working. Straightforward extension. |
| Code style (frontend) | FP-forward TypeScript: discriminated unions, `readonly` data types, pure transform functions, no classes, `neverthrow` for Result/Option |
| Code style (backend) | FP-principled Go: pure functions, no shared mutable state, explicit data flow — idiomatic Go error handling (`T, error`), not monadic. No fp-ts-style abstractions. |

---

## Technology Stack

### Frontend
| Layer | Choice | Notes |
|---|---|---|
| Build | Vite + React + TypeScript | Standard, fast DX |
| Styling | Tailwind CSS | Utility-first, component-scoped |
| Graph | **React Flow** | Interactive node/edge canvas, zoom/pan/drag, custom node + edge components |
| State | Zustand | Lightweight global state, pairs well with React Flow |
| Data fetching | TanStack Query | Async state, caching, background refetch |

### Backend
| Layer | Choice | Notes |
|---|---|---|
| Language | Go | Fast, simple, low overhead |
| Framework | Gin | Minimal REST framework |
| DB driver | pgx + sqlx | Ergonomic PostgreSQL access |
| Database | **PostgreSQL** | Temporal queries via `introduced_at` / `ended_at` integer columns |

### Why PostgreSQL over a Graph DB

Graph databases (Neo4j, ArangoDB) don't solve the temporal dimension any better than
SQL — you'd still need to model time on top of them. The core query is simple:

```sql
SELECT * FROM relationships
WHERE series_id = $1
  AND introduced_at <= $2
  AND (ended_at IS NULL OR ended_at >= $2)
```

Character graphs in this domain are small (tens to low hundreds of nodes). No need for
a graph traversal engine. PostgreSQL with proper indexes is more than sufficient and
reduces operational complexity.

---

## Database Schema

```sql
-- A book series, TV show, or film
series (
  id          UUID PRIMARY KEY,
  title       TEXT NOT NULL,
  media_type  TEXT NOT NULL,       -- 'book' | 'show' | 'film'
  unit_label  TEXT NOT NULL,       -- 'Chapter' | 'Episode' | 'Part'
  total_units INT NOT NULL
)

-- Characters within a series
characters (
  id              UUID PRIMARY KEY,
  series_id       UUID REFERENCES series(id),
  name            TEXT NOT NULL,
  aliases         TEXT[],          -- e.g. {"Edmond Dantès", "Sinbad"}
  description     TEXT,            -- enriched or user-written
  image_url       TEXT,
  introduced_at   INT NOT NULL,    -- chapter/episode they first appear
  died_at         INT              -- NULL if alive/unknown
)

-- Directed or undirected relationships with a time window
relationships (
  id              UUID PRIMARY KEY,
  series_id       UUID REFERENCES series(id),
  from_id         UUID REFERENCES characters(id),
  to_id           UUID REFERENCES characters(id),
  type            TEXT NOT NULL,   -- see Relationship Types below
  label           TEXT,            -- e.g. "adoptive father", "sworn enemy"
  directed        BOOLEAN NOT NULL DEFAULT false,
  introduced_at   INT NOT NULL,
  ended_at        INT              -- NULL = still active
)
```

### Relationship Types (initial set)
Visual style (color + line pattern) is driven by type.

| Type | Direction | Example |
|---|---|---|
| `family` | undirected | siblings, cousins |
| `parent_child` | directed | parent → child |
| `romantic` | undirected | lovers, spouses |
| `ally` | undirected | friends, companions |
| `rival` | undirected | competitors |
| `enemy` | directed or undirected | active antagonism |
| `mentor` | directed | mentor → student |
| `other` | either | catch-all |

---

## API Endpoints (Phase 1)

```
GET  /series                          List all series
GET  /series/:id                      Series metadata
GET  /series/:id/graph?at=14          Full graph snapshot at chapter 14
GET  /series/:id/characters/:charId   Single character detail
```

The `/graph` endpoint returns characters + relationships filtered to the given chapter.
The frontend holds no filtering logic — the server owns the temporal query.

---

## Character Enrichment System

Character detail panel data can come from three sources, in priority order:

1. **User-authored** — manually written description, uploaded image. Always wins.
2. **Fan wiki (Fandom/Wikia API)** — query by series name + character name. Rich lore content.
3. **Wikipedia API** — fallback for well-known works.
4. **AI-generated (Claude API)** — synthesise a summary from series + character name when
   no wiki data is available. Clearly labelled as AI-generated.

Enrichment is triggered on first view of a character (lazy) and cached in the `description`
/ `image_url` columns. Users can always overwrite with their own content.

---

## UI Layout

### Main Viewer

```
┌─────────────────────────────────────────────────────────────────┐
│  ◈ LitTree          The Count of Monte Cristo       [Edit Mode] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ┌──────────┐                             │
│              ┌─────────│  Edmond  │──────────┐                  │
│              │         └──────────┘          │                  │
│         [romantic]                       [enemy ▶]              │
│              │                                │                 │
│        ┌──────────┐                    ┌──────────┐             │
│        │ Mercédès │                    │ Fernand  │             │
│        └──────────┘                    └──────────┘             │
│              │                                │                 │
│         [mother]                         [◀ rival]              │
│              │                                │                 │
│        ┌──────────┐                    ┌──────────┐             │
│        │  Albert  │                    │  Danglars│             │
│        └──────────┘                    └──────────┘             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Ch 1      Ch 20      Ch 40      Ch 60      Ch 80      Ch 117   │
│  ├──────────────────────────●────────────────────────────┤      │
│                           Chapter 62                            │
└─────────────────────────────────────────────────────────────────┘
```

### With Character Panel Open

```
┌────────────────────────────────────┬────────────────────────────┐
│  ◈ LitTree    Monte Cristo         │ ✕                          │
├────────────────────────────────────│  ┌──────┐                  │
│                                    │  │ img  │  Edmond Dantès   │
│           [graph]                  │  └──────┘  aka "Sinbad"    │
│                                    │                            │
│                                    │  A sailor falsely          │
│                                    │  imprisoned, who escapes   │
│                                    │  and returns as the        │
│                                    │  mysterious Count.         │
│                                    │                            │
│                                    │  First appears: Ch 1       │
│                                    │                            │
│                                    │  Relationships at Ch 62:   │
│                                    │  ↔ Mercédès  (romantic)    │
│                                    │  → Fernand   (enemy)       │
│                                    │  → Danglars  (rival)       │
│                                    │  ↔ Abbé Faria (mentor)     │
├────────────────────────────────────┴────────────────────────────┤
│  Ch 1  ├──────────────────────────●─────────────────────┤ Ch117 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phased Task Breakdown

### Phase 0 — Project Scaffolding
- [ ] Monorepo structure: `/frontend`, `/backend`, `/docs`
- [ ] Go module init + Gin + pgx wired up
- [ ] Vite + React + TS + Tailwind + React Flow installed
- [ ] Podman Compose: PostgreSQL local dev environment (`compose.yaml`)
- [ ] Database migrations (schema above)
- [ ] Seed data: one series (suggest: *The Count of Monte Cristo* or a simpler test case)

### Phase 1 — Backend API
- [ ] Series endpoints (`GET /series`, `GET /series/:id`)
- [ ] Graph snapshot endpoint (`GET /series/:id/graph?at=N`)
- [ ] Character detail endpoint
- [ ] CORS + basic middleware
- [ ] Unit tests for temporal filtering logic

### Phase 2 — Frontend Core (Viewer)
- [ ] Series landing page (single series for now, just navigate straight to it)
- [ ] Graph canvas page — React Flow integration
- [ ] Custom node component: avatar circle + name label, highlight on hover
- [ ] Custom edge component: styled by relationship type, label on hover
- [ ] Timeline scrubber component: slider + chapter markers + current label
- [ ] Scrubber → API → graph update loop with smooth transitions
- [ ] Character detail side panel (open on node click)
- [ ] Directed vs undirected edge rendering (arrowhead toggle)

### Phase 3 — Character Enrichment
- [ ] Enrichment service in Go (Wikipedia API → Fandom API → Claude API fallback)
- [ ] Cache enriched data back to DB
- [ ] Surface source label in character panel ("From Wikipedia", "AI generated")
- [ ] User override: manual edit of description + image upload

### Phase 4 — LTG Import Language (planned)

> Full specification: [`docs/ltg-spec.md`](docs/ltg-spec.md)

A declarative definition language (`.ltg` files) for authoring series, characters, and
relationship timelines — designed to be human-writable, statically type-checked, and
compilable directly to the LitTree domain model.

- [ ] **Phase A** — Specification *(done — see docs/ltg-spec.md)*
- [ ] **Phase B** — `ltg-langserver` (Rust): `logos` lexer, `chumsky` parser, type checker, compiler — stdio + WebSocket transports via `tower-lsp` + `axum`. All LTG intelligence lives here; the frontend has no parsing code.
- [ ] **Phase C** — Import UI (thin client): file-upload/paste modal, calls language server `POST /compile`, then `POST /api/import` to persist
- [ ] **Phase D** — Backend import API (`POST /api/import`, `GET /api/series/:id/export`) with upsert semantics
- [ ] **Phase E** — In-browser editor: Monaco + `monaco-languageclient` over WebSocket to the language server; diagnostics are pushed by the server via standard LSP `publishDiagnostics`
- [ ] **Phase F** — Tooling: VSCode extension (stdio LSP), CLI (`ltg check`, `ltg fmt`)

### Phase 5 — Editor + Multi-Series (later)
- [ ] Create / edit series via UI forms
- [ ] Add / edit / delete characters and relationships
- [ ] Series browser page
- [ ] Character enrichment (Wikipedia / Fandom / AI fallback)

---

## Open Questions (to revisit)

- For enrichment: do we call external APIs at read time (with a loading state) or
  pre-populate during series creation?

---

## Code Style Reference

### TypeScript — Frontend Patterns

```ts
// Discriminated union for relationship type
type RelationshipType =
  | { kind: 'family' }
  | { kind: 'parent_child'; direction: 'parent_to_child' | 'child_to_parent' }
  | { kind: 'romantic' }
  | { kind: 'ally' }
  | { kind: 'rival' }
  | { kind: 'enemy'; directed: boolean }
  | { kind: 'mentor'; direction: 'mentor_to_student' | 'student_to_mentor' }
  | { kind: 'other'; label: string }

// Discriminated union for character visibility state
type CharacterState =
  | { status: 'active' }
  | { status: 'deceased'; diedAt: number }
  | { status: 'not_yet_introduced' }

// Readonly data types — never mutate API responses
type Character = Readonly<{
  id: string
  name: string
  aliases: readonly string[]
  state: CharacterState
  introducedAt: number
  description: string | null
  imageUrl: string | null
}>

// Pure transform: derive graph snapshot from raw data
const toGraphSnapshot = (
  characters: readonly Character[],
  relationships: readonly Relationship[],
  atChapter: number
): GraphSnapshot => { ... }
```

### Go — Backend Patterns

```go
// Represent relationship type as a typed constant — no stringly-typed logic
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

// Pure function: takes data in, returns data out, no side effects
func filterRelationshipsAt(rels []Relationship, chapter int) []Relationship {
    result := make([]Relationship, 0, len(rels))
    for _, r := range rels {
        if r.IntroducedAt <= chapter && (r.EndedAt == nil || *r.EndedAt >= chapter) {
            result = append(result, r)
        }
    }
    return result
}

// Explicit error returns, no panics in business logic
func buildGraphSnapshot(db *DB, seriesID string, chapter int) (GraphSnapshot, error) { ... }
```
