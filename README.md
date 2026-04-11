# LitTree

An interactive character relationship graph viewer for long-form fiction. Scrub through a chapter/episode timeline and watch relationships between characters evolve in real time.

Inspired by reading *The Count of Monte Cristo*.

---

## What it does

- Renders a character graph for any series at a specific chapter or episode
- Timeline scrubber drives the view — relationships appear, change, and dissolve as you move through the story
- Click any character to open a detail panel showing their relationships and biographical info
- Deceased characters remain visible (greyed out) by default
- Temporal filtering is done on the server — the frontend receives only what is visible at the selected unit

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React + TypeScript + Tailwind CSS |
| Graph canvas | React Flow |
| Data fetching | TanStack Query |
| Backend | Go + Gin |
| Database | PostgreSQL |

**Why PostgreSQL instead of a graph database?** The core query is a simple temporal filter:

```sql
SELECT * FROM relationships
WHERE series_id = $1
  AND introduced_at <= $2
  AND (ended_at IS NULL OR ended_at >= $2)
```

Character graphs are small (tens to low hundreds of nodes). A graph traversal engine adds complexity without benefit here.

---

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (or Podman) with Compose
- [Go 1.23+](https://go.dev/dl/)
- [Node.js 20+](https://nodejs.org/)

### 1. Start the database

```bash
docker compose up -d
```

This starts PostgreSQL on port `5432`, runs the migrations, and seeds Wuthering Heights as sample data. The database is ready when the healthcheck passes.

### 2. Start the backend

```bash
cd backend
DATABASE_URL=postgres://littree:littree@localhost:5432/littree go run ./cmd/api
```

The API listens on `http://localhost:8080`.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The app is available at `http://localhost:5173`. API requests are proxied to the backend automatically.

---

## Project structure

```
lit-tree-viewer/
├── backend/
│   ├── cmd/api/          # Entry point
│   ├── internal/
│   │   ├── api/          # HTTP handlers, router, Store interface
│   │   ├── config/       # Config loaded from environment variables
│   │   ├── db/           # PostgreSQL queries + PGStore adapter
│   │   └── domain/       # Shared types (Series, Character, Relationship, …)
│   └── migrations/
│       └── up/           # SQL migrations (run automatically by Docker)
├── frontend/
│   └── src/
│       ├── api/          # Typed fetch client (neverthrow Result types)
│       ├── components/   # React components (graph canvas, scrubber, panels, …)
│       ├── hooks/        # useGraphData, useAnimatedLayout
│       ├── lib/          # Pure functions (layout, edge styles, node positions)
│       └── types/        # Domain types mirroring the backend
├── compose.yaml
└── PLAN.md               # Full design decisions and phased roadmap
```

---

## API

```
GET /api/series                        List all series
GET /api/series/:id                    Series metadata
GET /api/series/:id/graph?at=<unit>    Full graph snapshot at a given chapter/episode
```

The `at` parameter is a positive integer (chapter number, episode number, etc.). It defaults to `1` if omitted.

---

## Running tests

### Frontend

```bash
cd frontend
npm test          # unit tests (Vitest + Testing Library)
```

### Backend — unit tests

```bash
cd backend
go test ./...
```

### Backend — integration tests (requires database)

```bash
cd backend
go test -tags integration ./...
```

Integration tests connect to `TEST_DATABASE_URL` (falls back to `postgres://littree:littree@localhost:5432/littree`). They insert and clean up their own isolated fixtures — the seed data is never touched.

---

## Seed data

The database is seeded with *Wuthering Heights* (34 chapters, 10 characters, 17 relationships) so there is something to look at immediately after setup.

---

## Roadmap

See [`PLAN.md`](PLAN.md) for the full phased breakdown. High-level:

- **Phase 3** — Character enrichment service (Wikipedia / Fandom / Claude API fallback)
- **Phase 4** — LTG import language: a declarative `.ltg` file format for authoring series and relationship timelines, with a language server, in-browser editor (Monaco), and VSCode extension
- **Phase 5** — Full editor UI + multi-series support
