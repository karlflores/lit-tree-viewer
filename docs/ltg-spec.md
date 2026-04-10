# LTG — LitTree Graph Definition Language

> A declarative, human-readable language for defining character graphs and their
> evolution over time. Designed to be authored by hand, checked by a compiler, and
> eventually edited live inside the LitTree web editor.

---

## Overview

LTG files (`.ltg`) describe a complete series — its cast, their relationships, and how
both change block by block (chapter, episode, year, etc.).  The format is intentionally
minimal: no punctuation-heavy boilerplate, indentation-scoped blocks (Python-style), and
a small vocabulary of built-in statements.

A compiler validates the source, reports typed errors, and emits the domain model that
the LitTree backend persists.

---

## Concepts

| Term | Meaning |
|---|---|
| **actor** | A named character. Identified by an opaque identifier; displayed by their display name. |
| **block** | A logical unit of time — chapter, episode, date, year. Numbered 1…N sequentially. `init:` is always block 1. |
| **event** | A statement inside a block that adds/removes a relationship or changes an actor's state. |
| **relationship** | A directed (`->`) or undirected (`--`) edge between two actors with a label. |
| **kind** | The semantic category of a relationship (drives visual style). Inferred from the label. |

---

## File Structure

```
<top-level actor declarations>

init:
    <events>

set block: "<name>"
    <actor declarations>
    <events>

set block: "<name>"
    <actor declarations>
    <events>
...
```

Top-level actor declarations define characters that exist before the story begins (or
whose exact introduction block is unknown). Actors can also be declared inside any block,
in which case their `introducedAt` is the block's index.

---

## Syntax Reference

### Comments

```
# This is a comment. Ignored by the compiler.
```

### Actor Declaration

```
actor <identifier>: "<Display Name>"
```

- `identifier` — alphanumeric + underscores, case-sensitive, unique within the file.
- `Display Name` — the human-readable name shown in the viewer.
- May appear at the top level (before `init:`) or indented inside any block.

```
actor heathcliff: "Heathcliff"
actor catherine:  "Catherine Earnshaw"
actor hindley:    "Hindley Earnshaw"
actor earnshaw:   "Mr. Earnshaw"
```

### Init Block

Defines the graph state at **block 1** (the starting point). Scoped by indentation.

```
init:
    sibling(hindley -- catherine)
    father(earnshaw -> hindley)
    father(earnshaw -> catherine)
```

### Event Block

Defines incremental changes that take effect at a new block. Blocks are numbered
sequentially: the first `set block:` is block 2, the second is block 3, and so on.

```
set block: "Chapter 4"
    actor linton: "Edgar Linton"
    romantic(heathcliff -- catherine)
    ally(catherine -- linton)

set block: "Chapter 7"
    deceased(earnshaw)
    unlink(heathcliff, hindley)
    enemy(hindley -> heathcliff)
```

### Directed Relationship

```
<label>(<from> -> <to>)
```

Creates a directed edge from `from` to `to`, labelled `label`.
The direction is shown as an arrowhead in the viewer.

```
father(earnshaw -> heathcliff)
mentor(nelly -> cathy)
```

### Undirected Relationship

```
<label>(<a> -- <b>)
```

Creates an undirected (bidirectional) edge between `a` and `b`.

```
sibling(hindley -- catherine)
romantic(heathcliff -- catherine)
rival(heathcliff -- linton)
```

### Deceased Event

```
deceased(<identifier>)
```

Marks an actor as having died in this block. Sets `diedAt` on the character.
An actor can only be marked deceased once.

```
deceased(earnshaw)
```

### Unlink

```
unlink(<a>, <b>)
```

Removes the active relationship between `a` and `b` as of this block.
The relationship's `endedAt` is set to `blockIndex - 1` (active up to the
previous block, gone from this one onward). Order of `a` and `b` is irrelevant
for undirected edges; for directed edges either order matches.

```
unlink(heathcliff, hindley)
```

---

## Relationship Label → Kind Mapping

The compiler infers a `RelationshipKind` (which drives edge colour and style) from the
label.  Unknown labels fall back to `other`.

| Label(s) | Inferred Kind | Default Direction |
|---|---|---|
| `parent`, `father`, `mother`, `child`, `son`, `daughter`, `adopted` | `parent_child` | directed |
| `sibling`, `brother`, `sister`, `twin` | `family` | undirected |
| `family`, `cousin`, `uncle`, `aunt`, `nephew`, `niece` | `family` | undirected |
| `romantic`, `loves`, `married`, `wife`, `husband`, `spouse`, `lover` | `romantic` | undirected |
| `ally`, `friend`, `companion`, `confidant` | `ally` | undirected |
| `rival`, `competitor` | `rival` | undirected |
| `enemy`, `enemies`, `antagonist`, `nemesis` | `enemy` | undirected |
| `mentor`, `teacher`, `student`, `apprentice` | `mentor` | directed |
| *(anything else)* | `other` | follows `->` / `--` |

> The inferred kind is a convenience. The label itself is stored verbatim and displayed in
> the character panel. In a future version, explicit kind annotation will be supported:
> `parent_child:father(earnshaw -> heathcliff)`.

---

## Full Example — Wuthering Heights

```ltg
# ── Actors ──────────────────────────────────────────────────────────
actor earnshaw:   "Mr. Earnshaw"
actor hindley:    "Hindley Earnshaw"
actor catherine:  "Catherine Earnshaw"
actor heathcliff: "Heathcliff"
actor nelly:      "Nelly Dean"
actor frances:    "Frances Earnshaw"

# ── Initial state (Chapter 1) ────────────────────────────────────────
init:
    father(earnshaw -> hindley)
    father(earnshaw -> catherine)
    sibling(hindley -- catherine)
    ally(heathcliff -- catherine)
    ally(nelly -- catherine)

# ── Chapter 3 ────────────────────────────────────────────────────────
set block: "Chapter 3"
    married(hindley -- frances)
    rival(hindley -> heathcliff)

# ── Chapter 6 ────────────────────────────────────────────────────────
set block: "Chapter 6"
    actor linton: "Edgar Linton"
    actor isabella: "Isabella Linton"
    sibling(linton -- isabella)
    ally(catherine -- linton)

# ── Chapter 9 ────────────────────────────────────────────────────────
set block: "Chapter 9"
    deceased(earnshaw)
    deceased(frances)
    romantic(heathcliff -- catherine)

# ── Chapter 14 ───────────────────────────────────────────────────────
set block: "Chapter 14"
    married(catherine -- linton)
    unlink(heathcliff, catherine)
    enemy(heathcliff -> linton)

# ── Chapter 17 ───────────────────────────────────────────────────────
set block: "Chapter 17"
    married(heathcliff -- isabella)
    enemy(heathcliff -> isabella)

# ── Chapter 16 ───────────────────────────────────────────────────────
set block: "Chapter 16"
    deceased(catherine)
```

---

## Type System & Semantic Rules

The compiler performs three passes:

### Pass 1 — Lexing & Parsing
Converts raw text into an AST. Produces **syntax errors** (unexpected token, unterminated
string, bad indentation, etc.).

### Pass 2 — Semantic Analysis (Type Checker)
Validates the AST against these rules:

| Rule | Error |
|---|---|
| Every identifier used in a statement must be declared as an actor before that point in the file (forward references are not allowed). | `UndeclaredActor` |
| An actor identifier must be unique across the whole file. | `DuplicateActor` |
| A relationship between two actors (in either direction) may not be declared twice in the same block, or while one already exists from a previous block. | `DuplicateRelationship` |
| `deceased` may only be applied once per actor. | `AlreadyDeceased` |
| `unlink(a, b)` requires an active relationship between `a` and `b` at the point of the call. | `NoSuchRelationship` |
| A relationship that was unlinked cannot be referenced again without being re-declared. | `RelationshipAlreadyRemoved` |
| The `init:` block must appear exactly once, before any `set block:` declarations. | `MissingInit` / `DuplicateInit` |

Each error carries: **error code**, **message**, and **source location** (`line`, `column`).

### Pass 3 — Compilation
Converts the validated AST into the LitTree domain model:

- One `Series` record (title, mediaType, unitLabel, totalUnits)
- One `Character` per actor with `introducedAt` = block index of declaration
- One `Relationship` per edge with `introducedAt` = block index of declaration, `endedAt`
  set when `unlink` is used (= `unlinkBlockIndex - 1`)

The compiler does **not** persist anything — it returns a pure data structure that is then
POSTed to the backend import endpoint (Phase 3 below).

---

## Architecture

All LTG intelligence lives in a **language server** — a standalone Rust binary
(`ltg-langserver`) that owns the lexer, parser, type checker, and compiler.  The frontend
is a thin client: it sends raw text, receives structured responses, and renders them.  No
parsing logic runs in the browser.  The Go graph API is untouched.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (thin client)                                              │
│                                                                     │
│  Monaco Editor ──── WebSocket (LSP over WS) ────► ltg-langserver   │
│       │                                           (Rust / tower-lsp)│
│       │  diagnostics ◄────────────────────────────────┘             │
│       │                                                             │
│  "Save" button ── POST /api/import ────────────────► Graph API (Go) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  VSCode Extension                                                   │
│                                                                     │
│  vscode-languageclient ── stdio (standard LSP) ────► ltg-langserver│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  CLI                                                                │
│                                                                     │
│  ltg check <file>  ── embeds ltg-langserver core (no network) ─────┘
└─────────────────────────────────────────────────────────────────────┘
```

**Why Rust for this service:**

- **Parser/compiler is the canonical Rust domain.** `logos` (zero-copy lexer generation),
  `chumsky` (parser combinators with structured error recovery designed for user-facing
  compilers), and `tower-lsp` (async LSP server on Tokio) are all mature, purpose-built
  crates with no Go equivalent of the same quality.
- **No GC pauses.** Language servers are latency-sensitive — diagnostics must update in
  tens of milliseconds on every keystroke. Rust delivers this without GC tuning.
- **WASM compilation path.** The same Rust parser/checker can later compile to
  WebAssembly for offline validation, CI without a running server, or eventual client-side
  use — none of which is possible with Go.
- **Clean service boundary.** The language server speaks LSP + HTTP; Rust does not bleed
  into the Go API or the TypeScript frontend.

**Crate selection:**

| Role | Crate | Rationale |
|---|---|---|
| Lexer | `logos` | Macro-driven, zero-copy, extremely fast |
| Parser + error recovery | `chumsky` | Combinator style; produces structured errors with source spans — ideal for user-facing diagnostics |
| LSP server | `tower-lsp` | Async, trait-based LSP; used by production language servers |
| Async runtime | `tokio` | Standard; shared by tower-lsp and axum |
| HTTP companion | `axum` | Lightweight; shares the Tokio runtime — no second server process |
| Serialisation | `serde` + `serde_json` | Standard |

The language server exposes **two transports** from the same core:

| Transport | Used by | Protocol |
|---|---|---|
| stdio | VSCode extension, CLI | Standard LSP (JSON-RPC 2.0) |
| WebSocket | Browser editor | LSP over WebSocket (same JSON-RPC, different framing) |
| HTTP | File-upload import flow | Custom `POST /compile` — one-shot, no session |

---

## AST Types (Rust — language server internal)

The AST is internal to the language server.  External consumers receive only the wire
formats described in the next section.

```rust
use logos::Span; // byte range in the source string

#[derive(Debug, Clone)]
pub struct SourceLocation {
    pub line:   u32, // 0-indexed, matches LSP convention
    pub column: u32,
}

#[derive(Debug, Clone)]
pub struct Spanned<T> {
    pub node: T,
    pub span: Span,
}

// ── Statements ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ActorDecl {
    pub identifier:   String,
    pub display_name: String,
}

#[derive(Debug, Clone)]
pub struct RelationshipStmt {
    pub label:    String,
    pub from:     String, // actor identifier
    pub to:       String,
    pub directed: bool,   // true = ->, false = --
}

#[derive(Debug, Clone)]
pub struct DeceasedStmt {
    pub actor: String,
}

#[derive(Debug, Clone)]
pub struct UnlinkStmt {
    pub a: String,
    pub b: String,
}

#[derive(Debug, Clone)]
pub enum Statement {
    Actor(ActorDecl),
    Relationship(RelationshipStmt),
    Deceased(DeceasedStmt),
    Unlink(UnlinkStmt),
}

// ── Blocks ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct InitBlock {
    pub statements: Vec<Spanned<Statement>>,
}

#[derive(Debug, Clone)]
pub struct EventBlock {
    pub name:       String, // value of set block: "..."
    pub statements: Vec<Spanned<Statement>>,
}

// ── Program ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Program {
    pub top_level_actors: Vec<Spanned<ActorDecl>>,
    pub init_block:       InitBlock,
    pub event_blocks:     Vec<Spanned<EventBlock>>,
}
```

---

## Wire Formats (LSP + custom endpoints)

### Diagnostics (standard LSP `textDocument/publishDiagnostics`)

The language server pushes diagnostics to the client using the standard LSP notification.
The frontend uses `monaco-languageclient` and receives these natively — no custom parsing
of errors on the frontend side.

```jsonc
// Error codes sent in Diagnostic.code
// UndeclaredActor | DuplicateActor | DuplicateRelationship |
// AlreadyDeceased | NoSuchRelationship | RelationshipAlreadyRemoved |
// MissingInit | DuplicateInit | SyntaxError
{
  "range": { "start": { "line": 4, "character": 12 },
             "end":   { "line": 4, "character": 22 } },
  "severity": 1,        // 1=Error, 2=Warning, 3=Info
  "code": "UndeclaredActor",
  "source": "ltg",
  "message": "Actor 'linton' has not been declared"
}
```

### Compile Request (custom HTTP endpoint on the language server)

The browser calls this when the user clicks "Save to server".  The language server runs
a full compile and returns the domain model JSON.  The frontend then POSTs that directly
to the graph API — the language server never talks to the database.

```
POST /compile
Content-Type: text/plain

<raw .ltg source>
```

```jsonc
// 200 OK — success
{
  "ok": true,
  "graph": {
    "series": {
      "title": "Wuthering Heights",
      "mediaType": "book",
      "unitLabel": "Chapter",
      "totalUnits": 8
    },
    "characters": [
      { "identifier": "heathcliff", "name": "Heathcliff",
        "aliases": [], "introducedAt": 1, "diedAt": null }
    ],
    "relationships": [
      { "fromIdentifier": "earnshaw", "toIdentifier": "heathcliff",
        "kind": "parent_child", "label": "father",
        "directed": true, "introducedAt": 1, "endedAt": null }
    ]
  }
}

// 422 Unprocessable — type errors (frontend renders these in the editor)
{
  "ok": false,
  "errors": [
    { "code": "UndeclaredActor", "message": "Actor 'linton' has not been declared",
      "loc": { "line": 4, "column": 12 } }
  ]
}
```

### Backend Import (graph API — unchanged)

```
POST /api/import
Content-Type: application/json

<CompiledGraph JSON from the language server>
```

---

## Planned Directives (Future Syntax)

These are reserved for later versions and must not be used as actor identifiers or labels.

```ltg
# Series-level metadata
set title:     "Wuthering Heights"
set media:     book          # book | show | film
set unit:      "Chapter"     # displayed in the UI as "Chapter 3", "Episode 7", etc.
set author:    "Emily Brontë"

# Explicit kind override (when inference is wrong or ambiguous)
parent_child:father(earnshaw -> heathcliff)

# Aliases
alias(heathcliff, "The Dark Stranger")

# Character metadata
describe(heathcliff, "A foundling brought from Liverpool …")
```

---

## Implementation Roadmap

### Phase A — Specification *(done)*
- [x] Language grammar defined
- [x] Statement vocabulary complete
- [x] Type checking rules documented
- [x] AST and wire format types specified
- [x] Architecture: language server as the single source of truth
- [x] Full worked example (Wuthering Heights)

---

### Phase B — Language Server (`ltg-langserver`, Rust)

All parsing, type checking, and compilation lives here.  The frontend never sees an AST.

**Core pipeline (`ltg-langserver/src/`)**
- [ ] `lexer.rs` — `logos`-derived token enum; handles indentation depth, quoted strings,
      identifiers, `->` / `--` operators, line tracking for LSP positions
- [ ] `parser.rs` — `chumsky` combinator parser; produces `Program` or
      `Vec<ParseError>` with source spans; error recovery allows partial ASTs so
      diagnostics keep working mid-edit
- [ ] `checker.rs` — semantic analyser; simulates graph state block-by-block (accumulates
      active relationships, tracks deceased actors) and emits `Vec<Diagnostic>` with
      typed error codes
- [ ] `compiler.rs` — validated `Program` → `CompiledGraph` (the JSON struct POSTed to the
      graph API); pure function, no I/O
- [ ] `pipeline.rs` — chains lex → parse → check → compile; returns a `PipelineResult`
      with diagnostics and optional `CompiledGraph`
- [ ] Unit tests for each module (`cargo test`)

**LSP server (`ltg-langserver/src/lsp.rs`)**
- [ ] `tower-lsp` `LanguageServer` trait implementation
- [ ] stdio transport — for VSCode extension and CLI
- [ ] WebSocket transport (via `tokio-tungstenite`) — for browser; same handler, different
      framing
- [ ] Handle `initialize`, `textDocument/didOpen`, `textDocument/didChange`,
      `textDocument/didClose` — run pipeline on every change, push `publishDiagnostics`
- [ ] `workspace/executeCommand: ltg.compile` — run compiler, return `CompiledGraph` JSON
      as the command result (used by the "Save" button)

**HTTP companion (`ltg-langserver/src/http.rs`, `axum`)**
- [ ] `POST /compile` — one-shot compile for the file-upload import flow; no WebSocket
      session required
- [ ] `GET /health`

**Infrastructure**
- [ ] `ltg-langserver/` Cargo workspace member alongside `frontend/` and `backend/`
- [ ] `Cargo.toml` with `logos`, `chumsky`, `tower-lsp`, `tokio`, `axum`,
      `tokio-tungstenite`, `serde`, `serde_json`
- [ ] Added to `compose.yaml` as a service (optional for dev — can run standalone)
- [ ] `Dockerfile` using `rust:alpine` builder → scratch/distroless final image

---

### Phase C — Import UI (Frontend — thin client)

The frontend has **no parsing logic**.  It sends raw text, receives structured JSON.

**File-upload / paste flow (no editor session needed)**
- [ ] "Import" button in the header
- [ ] `ImportModal` component — textarea + `.ltg` file upload
- [ ] On submit: `POST /compile` (language server HTTP endpoint) → display errors or
      proceed
- [ ] On success: `POST /api/import` (graph API) → load the returned series in the viewer
- [ ] In-memory series mode in `App.tsx` — bypasses `useGraphData` when a compiled graph
      is active; "Clear" button to return to backend-served data

---

### Phase D — Backend Import API (Graph API, Go)
- [ ] `POST /api/import` — accepts `CompiledGraph` JSON, writes to PostgreSQL, returns the
      new `Series` UUID and the first snapshot
- [ ] Upsert semantics keyed on `(series_id, identifier)` — re-importing updates in place
- [ ] Server-side validation (the language server is the primary guard, but the API
      validates shape)
- [ ] `GET /api/series/:id/export` — serialise an existing series back to LTG source
      (round-trip)

---

### Phase E — In-Browser Editor (Frontend — thin client)

A live editing experience powered entirely by the language server over WebSocket.  The
frontend renders what the server tells it.

- [ ] Embed **Monaco Editor** in a split-pane layout (editor left, graph preview right)
- [ ] `monaco-languageclient` + `vscode-languageserver-protocol` — connects Monaco to the
      language server WebSocket; diagnostics (squiggles) appear automatically via
      `publishDiagnostics` with zero frontend parsing code
- [ ] LTG TextMate grammar for Monaco syntax highlighting (keywords, strings, operators)
- [ ] "Save to server" button — sends `ltg.compile` command over LSP, receives
      `CompiledGraph`, POSTs to `POST /api/import`
- [ ] Debounce document changes at 300 ms before sending `didChange` to the server

---

### Phase F — Tooling & DX

Because the language server implements standard LSP, most tooling comes for free.

- [ ] **VSCode extension** — `vscode-languageclient` connects to `ltg-langserver` over
      stdio; provides diagnostics, go-to-definition (actor declarations), hover (show kind
      inference)
- [ ] **CLI** — `ltg check <file>` embeds the language server core (no network); exits
      non-zero on errors (CI-friendly)
- [ ] **Formatter** — `ltg fmt` canonicalises indentation, aligns `:` in actor declarations,
      sorts top-level actors alphabetically
- [ ] **`.ltg` file association** — `files.associations` in the VSCode extension manifest
