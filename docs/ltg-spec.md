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
| **metadata** | Series-level information (`title`, `media`, `author`) declared with the `metadata` keyword. Required fields are enforced by the compiler. Passes through to the `Series` record unchanged — the compiler does not act on it structurally. |
| **actor** | A named character. Declared inside a block body; their `introducedAt` is the index of the block they are declared in. Actors are never declared at the top level. |
| **block type** | The unit of time for a series — declared once with `set block:`. The identifier becomes the keyword used in `new` statements; the optional display label becomes `unitLabel` in the domain model. |
| **block** | One unit of time. `init:` is always block 1. Each `new <type>:` is a subsequent block, numbered globally and sequentially from 1. |
| **group** | An optional organisational container for blocks — e.g. a season holding episodes, or a volume holding chapters. Declared with `group "<label>":`. Purely structural; does not affect block numbering. |
| **group type** | An optional name for the container level — declared with `set group:` (e.g. `season`, `volume`, `arc`). Used by the UI timeline scrubber. |
| **event** | A statement inside a block that changes the graph: `link`, `unlink`, or `deceased`. |
| **relationship** | A directed (`->`) or undirected (`--`) edge between two actors, identified by a free-form label. |
| **label** | A free-form identifier naming a relationship (e.g. `siblings`, `blood_oath`, `reluctant_allies`). Inferred from position in the `link` statement — always the token between `link` and `(`. Stored verbatim; drives edge colour via a deterministic hash. Reserved keywords are illegal as labels. |

---

## File Structure

```
# ── Required metadata ────────────────────────────────────────────────
metadata title:  "<series title>"
metadata media:  book | show | film

# ── Optional metadata ────────────────────────────────────────────────
metadata author: "<author name>"

# ── Structural directives ────────────────────────────────────────────
set block: <type>                    # required
set block: <type> = "<display>"      # optional display label override
set group: <type>                    # optional
set colour: <label> = "<hex>"        # zero or more

# ── Blocks ──────────────────────────────────────────────────────────
init:
    <actor declarations>             # characters present from block 1
    <events>

new <type>:                          # empty block — graph unchanged
new <type>: "<label>"                # block with an optional display label
    <actor declarations>             # characters introduced this block
    <events>

group "<label>":                     # optional organisational container
    new <type>:
        <actor declarations>
        <events>
    new <type>:                      # empty block inside a group
```

All `metadata` and `set block:` directives must appear before `init:`. The compiler
enforces this; ordering between `metadata` and `set` directives is not prescribed.

Blocks are numbered **globally and sequentially** starting from 1 (`init:` = block 1,
first `new <type>:` = block 2, and so on). Groups are purely organisational — a block
inside a group has the same sequential index it would have outside one.

---

## Syntax Reference

### Comments

```
# This is a comment. Ignored by the compiler.
```

### Indentation

LTG uses indentation to define block scope (Python-style). The rules are strict:

- **4 spaces per indent level.** One level of indentation opens a block body; two levels are used inside a `group` block (group header → block header → block body).
- **Tab characters are a lexer error.** `InvalidIndentation` is reported at the position of the tab. Configure your editor to expand tabs to spaces.
- **Blank lines and comment-only lines** are ignored and do not affect indentation tracking.
- **Inconsistent indentation** (e.g. 3 or 5 spaces where 4 are expected) produces `InvalidIndentation`.

```
init:                        # 0 spaces — top level
    link ally(a -- b)        # 4 spaces — block body

group "Season 1":            # 0 spaces — top level
    new episode:             # 4 spaces — group body
        link ally(a -- b)    # 8 spaces — block body inside group
```

### Metadata Directives

Declare series-level information. `title` and `media` are required and must appear before
`init:`. The compiler produces `MissingMetadata` if either is absent and `DuplicateMetadata`
if either appears more than once.

```
metadata title:  "<series title>"
metadata media:  book | show | film
metadata author: "<author name>"     # optional
```

- `title` — the display name of the series. Stored as `Series.title`.
- `media` — the medium. Constrained to `book`, `show`, or `film`; any other value is an
  `InvalidMediaType` error. Stored as `Series.mediaType`.
- `author` — optional. Stored for display; not part of the current domain model query
  surface.

```ltg
metadata title:  "Wuthering Heights"
metadata media:  book
metadata author: "Emily Brontë"
```

The `metadata` keyword is distinct from `set` by design:
- `metadata` — domain data that passes through to the `Series` record; the compiler does
  not act on it structurally.
- `set` — compiler/structural directives that affect how the file is processed.

### Block Type Declaration

Required. Must appear before `init:`. Declares the unit of time for the series and
establishes the keyword used in `new` statements. An optional `= "<display>"` suffix
sets the human-readable unit label shown in the UI (e.g. `"Story Arc"` for `story_arc`).
When omitted, the compiler derives the display label by title-casing the type name and
replacing underscores with spaces (`story_arc` → `"Story Arc"`).

```
set block: <type>                    # display label auto-derived
set block: <type> = "<display>"      # explicit display label
```

- `<type>` — unquoted identifier used in `new` statements: `chapter`, `episode`, `part`, etc.
- `= "<display>"` — optional. The display string shown by the UI scrubber (`"Chapter 3"`,
  `"Story Arc 2"`). Required when the auto-derived form would look wrong (e.g. compound
  or stylised labels).
- Every `new` statement in the file must use the declared type; mismatches are a
  `WrongBlockType` error.

```ltg
set block: chapter                   # unitLabel → "Chapter"
set block: episode                   # unitLabel → "Episode"
set block: story_arc = "Story Arc"   # unitLabel → "Story Arc" (explicit)
set block: part = "Book Part"        # unitLabel → "Book Part" (explicit)
```

### Group Type Declaration

Optional. Declares a display name for the organisational container level. Used by the
timeline scrubber to label groups in the UI. Ignored if no `group` blocks are present.

```
set group: <type>
```

```ltg
set group: season
set group: volume
set group: arc
```

### Colour Override

Overrides the hash-assigned colour for a specific relationship label. Any number of
overrides may appear before `init:`.

```
set colour: <label> = "<hex>"
```

```ltg
set colour: married  = "#f472b6"
set colour: siblings = "#60a5fa"
set colour: enemy    = "#f87171"
```

### Actor Declaration

```
actor <identifier>: "<Display Name>"
```

- `identifier` — alphanumeric + underscores, case-sensitive, unique within the file.
- `Display Name` — the human-readable name shown in the viewer.
- **Must appear inside a block body** — `init:` or `new <type>:`. Top-level actor
  declarations (outside any block) are a `TopLevelActor` error.
- The block the declaration appears in sets `introducedAt` for that character. Characters
  present from the start of the series are declared inside `init:`.
- The exporter always emits actor declarations inside their introduction block — this is
  the canonical form. No information is lost in the `DB → LTG` round-trip.

```ltg
init:
    actor heathcliff: "Heathcliff"
    actor catherine:  "Catherine Earnshaw"

new chapter: "Chapter 6"
    actor linton: "Edgar Linton"    # introducedAt = this block's index
```

### Init Block

Defines the graph state at **block 1** (the starting point). Required; must appear
exactly once, before any `new` or `group` blocks.

The `init:` body supports `actor` declarations and `link` events only. `unlink` is
invalid here (`UnlinkInInit` error) because there is nothing to remove before the series
has started. `deceased` is likewise invalid (`DeceasedInInit` error) — a character who
never appears alive should simply be omitted from the file.

All characters present from the start of the series are declared here. There is no
top-level actor syntax — `init:` is the canonical home for block-1 characters.

```ltg
init:
    actor earnshaw:   "Mr. Earnshaw"
    actor hindley:    "Hindley Earnshaw"
    actor catherine:  "Catherine Earnshaw"
    actor heathcliff: "Heathcliff"
    link sibling(hindley -- catherine)
    link father(earnshaw -> hindley)
    link father(earnshaw -> catherine)
```

### New Block

Defines incremental changes at the next block. Each `new <type>:` advances the block
counter by one. Blocks with no events are valid — they record that the graph was
unchanged during that unit of time.

```
new <type>:                    # empty block — graph unchanged, counter advances
new <type>: "<label>"          # optional display label (e.g. a chapter title)
    <actor declarations>
    <events>
```

The block's optional display label is distinct from the type display label set in
`set block:`. The scrubber uses both: type label for position (`"Chapter 3"`) and block
label as a subtitle (`"The Storm"`), displayed together as `"Chapter 3 — The Storm"`.

```ltg
new chapter:                           # block 2, no changes
new chapter: "The Storm"               # block 3, with a display label
    deceased earnshaw
    link enemy(hindley -> heathcliff)
new chapter:                           # block 4, no changes
new chapter: "A New Alliance"          # block 5
    actor hareton: "Hareton Earnshaw"
    link father(hindley -> hareton)
```

### Group Block

An optional organisational container for `new <type>:` blocks. Groups have no effect on
block numbering — the sequential index continues across group boundaries. One level of
nesting is supported; groups cannot contain other groups.

The group label is **optional**. When omitted, the group is unnamed — useful for
imposing structure (e.g. separating volumes) without giving the container a display name.
When no `group` blocks appear at all, all blocks are implicitly treated as one unnamed
group by the scrubber.

```
group:               # unnamed group
group "<label>":     # named group
    new <type>:
        <events>
    new <type>:
```

```ltg
group "Series 1":
    new episode: "Pilot"
        link ally(watson -- holmes)
    new episode:                       # empty — no changes this episode
    new episode: "The Chase"
        deceased moriarty

group "Series 2":
    new episode: "A New Case"
        actor mary: "Mary Morstan"
        link romantic(watson -- mary)
    new episode:
```

### Link Event

Creates a relationship between two actors. The label is the token immediately after
`link` and before `(` — its position is unambiguous and no additional keyword is needed.
Use any identifier-safe string that describes the relationship; labels are stored verbatim.

> **Reserved labels** — the following identifiers are keywords and may not be used as
> relationship labels or actor identifiers: `link`, `unlink`, `deceased`, `actor`,
> `rename`, `init`, `new`, `group`, `set`, `metadata`, `alias`, `describe`.

**Undirected** (symmetric — order of actors is irrelevant):
```
link <label>(<a> -- <b>)
```

**Directed** (asymmetric — `from` → `to` carries semantic meaning):
```
link <label>(<from> -> <to>)
```

```ltg
link sibling(hindley -- catherine)       # undirected
link married(heathcliff -- isabella)     # undirected
link father(earnshaw -> heathcliff)      # directed: earnshaw is the father
link blood_oath(edmond -- haydee)        # undirected, multi-word via underscore
```

### Unlink Event

Removes a specific active relationship by label. The label must match the one used in
the corresponding `link`. Order of `<a>` and `<b>` is irrelevant for undirected edges;
either order is accepted for directed edges. Sets `endedAt` to `blockIndex - 1`.

The label is always required — two actors can have more than one active relationship
simultaneously, so omitting it would be ambiguous.

```
unlink <label> <a> <b>
```

```ltg
unlink romantic heathcliff catherine
unlink ally     catherine  hindley
```

### Deceased Event

Marks an actor as having died in this block. Sets `diedAt` on the character.
An actor can only be marked deceased once.

```
deceased <identifier>
```

```ltg
deceased earnshaw
deceased catherine
```

### Rename Event

Changes the display name of an actor from this block onwards. The actor's identifier
remains unchanged — only the name shown in the viewer changes. The previous name is
automatically added to the actor's aliases so the character panel and search surfaces
both names throughout the series.

```
rename <identifier>: "<New Display Name>"
```

- `identifier` must refer to a declared actor.
- Multiple renames on the same actor are valid — each overwrites the display name from
  that block onwards.
- `rename` is not valid inside `init:` (`RenameInInit`) — the display name at block 1 is
  set by the `actor` declaration.
- `rename` at the top level (outside a block) is a `TopLevelRename` error.
- Renaming a deceased actor produces a `RenameDeceased` warning (not an error — valid for
  posthumous name changes in historical fiction, but unusual).

```ltg
new chapter: "Chapter 14"
    rename catherine: "Catherine Linton"   # married name; "Catherine Earnshaw" → alias
    link married(catherine -- linton)
    unlink romantic heathcliff catherine
```

The graph scrubber reflects the name change correctly: scrubbing to block 13 shows
"Catherine Earnshaw"; scrubbing to block 14 or later shows "Catherine Linton".
The character panel shows both names at all times via the aliases list.

---

## Colour Assignment

Every relationship label is assigned a colour for rendering. The rules, in priority order:

1. **Author override** — a `set colour: <label> = "<hex>"` directive wins unconditionally.
2. **Deterministic hash** — for labels without an override, the compiler hashes the label
   string into a curated palette. The same label always produces the same colour, across
   files, series, and sessions — no state required.

The palette is chosen to be visually distinct and legible on the viewer's dark background.
The full `colours` map (hash defaults + overrides) is included in the `CompiledGraph` so
the backend persists it and the frontend never recomputes it.

---

## Full Example — Wuthering Heights

```ltg
# ── Metadata ─────────────────────────────────────────────────────────
metadata title:  "Wuthering Heights"
metadata media:  book
metadata author: "Emily Brontë"

# ── Structural declarations ───────────────────────────────────────────
set block: chapter

set colour: father   = "#34d399"
set colour: sibling  = "#60a5fa"
set colour: married  = "#f472b6"
set colour: romantic = "#f472b6"
set colour: ally     = "#a78bfa"
set colour: rival    = "#fb923c"
set colour: enemy    = "#f87171"

# ── Block 1: initial state ───────────────────────────────────────────
init:
    actor earnshaw:   "Mr. Earnshaw"
    actor hindley:    "Hindley Earnshaw"
    actor catherine:  "Catherine Earnshaw"
    actor heathcliff: "Heathcliff"
    actor nelly:      "Nelly Dean"
    actor frances:    "Frances Earnshaw"
    link father(earnshaw -> hindley)
    link father(earnshaw -> catherine)
    link sibling(hindley -- catherine)
    link ally(heathcliff -- catherine)
    link ally(nelly -- catherine)

# ── Block 2 ─────────────────────────────────────────────────────────
new chapter:

# ── Block 3 ─────────────────────────────────────────────────────────
new chapter: "Chapter 3"
    link married(hindley -- frances)
    link rival(hindley -> heathcliff)

# ── Blocks 4–5 ──────────────────────────────────────────────────────
new chapter:
new chapter:

# ── Block 6 ─────────────────────────────────────────────────────────
new chapter: "Chapter 6"
    actor linton:   "Edgar Linton"
    actor isabella: "Isabella Linton"
    link sibling(linton -- isabella)
    link ally(catherine -- linton)

# ── Blocks 7–8 ──────────────────────────────────────────────────────
new chapter:
new chapter:

# ── Block 9 ─────────────────────────────────────────────────────────
new chapter: "Chapter 9"
    deceased earnshaw
    deceased frances
    link romantic(heathcliff -- catherine)

# ── Blocks 10–13 ────────────────────────────────────────────────────
new chapter:
new chapter:
new chapter:
new chapter:

# ── Block 14 ────────────────────────────────────────────────────────
new chapter: "Chapter 14"
    rename catherine: "Catherine Linton"
    link married(catherine -- linton)
    unlink romantic heathcliff catherine
    link enemy(heathcliff -> linton)

# ── Block 15 ────────────────────────────────────────────────────────
new chapter:

# ── Block 16 ────────────────────────────────────────────────────────
new chapter: "Chapter 16"
    deceased catherine

# ── Block 17 ────────────────────────────────────────────────────────
new chapter: "Chapter 17"
    link married(heathcliff -- isabella)
    link enemy(heathcliff -> isabella)
```

---

## Full Example — Grouped (TV Show)

```ltg
# ── Metadata ─────────────────────────────────────────────────────────
metadata title: "Sherlock"
metadata media: show

# ── Structural declarations ───────────────────────────────────────────
set block: episode
set group: season

set colour: ally    = "#a78bfa"
set colour: enemy   = "#f87171"
set colour: married = "#f472b6"

# ── Block 1: initial state ───────────────────────────────────────────
init:
    actor holmes: "Sherlock Holmes"
    actor watson: "Dr. Watson"
    link ally(holmes -- watson)

# ── Season 1 ────────────────────────────────────────────────────────
group "Season 1":
    new episode: "A Study in Pink"
        actor lestrade: "Inspector Lestrade"
        link ally(holmes -- lestrade)
    new episode:
    new episode: "The Great Game"
        actor moriarty: "Jim Moriarty"
        link enemy(moriarty -> holmes)

# ── Season 2 ────────────────────────────────────────────────────────
group "Season 2":
    new episode:
    new episode: "The Hounds of Baskerville"
        actor mary: "Mary Morstan"
    new episode: "The Reichenbach Fall"
        deceased moriarty
        unlink ally holmes lestrade
```

---

## Type System & Semantic Rules

The compiler performs three passes:

### Pass 1 — Lexing & Parsing ✅
Converts raw text into an AST. Produces **syntax errors** (unexpected token, unterminated
string, bad indentation, etc.).

Implemented in `ltg-langserver/src/lexer.rs` and `ltg-langserver/src/parser.rs`.
102 unit tests passing covering all token types, indentation rules, error recovery,
and every statement and block form.

### Pass 2 — Semantic Analysis (Type Checker) ✅
Validates the AST against these rules:

Implemented in `ltg-langserver/src/checker.rs`.
42 unit tests passing covering every named error code and warning in the table below.
Rules already enforced structurally by the parser (`TopLevelActor`, `TopLevelRename`,
`ReservedLabel`, `NestedGroup`) and by the lexer (`InvalidIndentation`) are handled
at those earlier passes rather than here.

| Rule | Error |
|---|---|
| `metadata title:` must appear exactly once, before `init:`. | `MissingMetadata` / `DuplicateMetadata` |
| `metadata media:` must appear exactly once, before `init:`. | `MissingMetadata` / `DuplicateMetadata` |
| `metadata media:` value must be `book`, `show`, or `film`. | `InvalidMediaType` |
| `set block: <type>` must appear exactly once, before `init:`. | `MissingBlockDeclaration` / `DuplicateBlockDeclaration` |
| The optional `= "<display>"` value on `set block:` must be a non-empty string. | `InvalidDisplayLabel` |
| Every `new` statement must use the type declared in `set block:`. | `WrongBlockType` |
| An `actor` declaration appearing outside a block body (at the top level). | `TopLevelActor` |
| Every identifier used in a statement must be declared as an actor before that point in the file (forward references are not allowed). | `UndeclaredActor` |
| An actor identifier must be unique across the whole file. | `DuplicateActor` |
| A `link` between two actors with the same label may not be declared while one with that label already exists between them. | `DuplicateRelationship` |
| `deceased` may only be applied once per actor. | `AlreadyDeceased` |
| `unlink <label> <a> <b>` requires an active relationship with that exact label between `a` and `b`. | `NoSuchRelationship` |
| A relationship that was `unlink`ed may be re-established with a new `link` using the same label. After re-linking, the checker resets the slot — `RelationshipAlreadyRemoved` no longer applies. Each `link`/`unlink` pair produces a separate DB row with a distinct temporal window. | *(no error — valid)* |
| A label used in a `link` statement must not be a reserved keyword. | `ReservedLabel` |
| A `set colour:` value must be a valid 6-digit hex colour string (`#rrggbb`). | `InvalidColour` |
| A `set colour:` override whose label never appears in any `link` statement. | `UnusedColourOverride` *(warning)* |
| Groups cannot contain other groups. | `NestedGroup` |
| The `init:` block must appear exactly once, before any `new` or `group` blocks. | `MissingInit` / `DuplicateInit` |
| `unlink` used inside an `init:` block. | `UnlinkInInit` |
| `deceased` used inside an `init:` block. | `DeceasedInInit` |
| `rename` used inside an `init:` block. | `RenameInInit` |
| `rename` used at the top level (outside a block body). | `TopLevelRename` |
| `rename` applied to a deceased actor. | `RenameDeceased` *(warning)* |
| 4-space indentation rule violated (tab character used, or wrong space count). | `InvalidIndentation` |

Each error carries: **error code**, **message**, **severity** (`error` or `warning`), and **source location** (`line`, `column`).

Warnings do not prevent compilation — a `CompiledGraph` is still produced. Errors halt compilation at the end of the semantic pass.

### Pass 3 — Compilation ✅
Converts the validated AST into the LitTree domain model:

Implemented in `ltg-langserver/src/compiler.rs`.
34 unit tests passing covering series fields, sequential block numbering (transparent
through groups), character `introducedAt`/`diedAt`, rename aliases, relationship
temporal windows (`endedAt = unlinkBlock - 1`), relink producing a second row,
and the colour map (FNV-1a hash into a 12-colour Tailwind palette, overridden by
`set colour:` directives).

- One `Series` record:
  - `title` from `metadata title:`
  - `mediaType` from `metadata media:`
  - `unitLabel` from `set block:` — the explicit `= "<display>"` value if present,
    otherwise the type name title-cased with underscores replaced by spaces
  - `totalUnits` = total block count (including `init:`)
- One `Character` per actor with `introducedAt` = block index of declaration; each
  `rename` in the file appends a `CompiledRename` to that character's `renames` list and
  automatically adds the previous display name to `aliases`
- One `Relationship` per edge with `introducedAt` = block index of declaration, `endedAt`
  set when `unlink` is used (= `unlinkBlockIndex - 1`)
- One `colours` map — label → hex string — combining hash-assigned defaults with any
  `set colour:` overrides
- One `groups` list — for the timeline scrubber — each entry records the group label and
  the range of block indices it contains; absent if no `group` blocks are used

The compiler does **not** persist anything — it returns a pure data structure that is
then POSTed to the backend import endpoint.

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
use logos::Span;

#[derive(Debug, Clone)]
pub struct Spanned<T> {
    pub node: T,
    pub span: Span,
}

// ── Metadata ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum MediaType { Book, Show, Film }

/// Collected from `metadata title:`, `metadata media:`, `metadata author:`.
/// `title` and `media` are required; the checker enforces their presence.
#[derive(Debug, Clone)]
pub struct SeriesMetadata {
    pub title:  String,
    pub media:  MediaType,
    pub author: Option<String>,
}

// ── Structural declarations ──────────────────────────────────────────

/// `set block: chapter` or `set block: story_arc = "Story Arc"`
#[derive(Debug, Clone)]
pub struct BlockTypeDecl {
    pub type_name:     String,         // keyword used in `new` statements
    pub display_label: Option<String>, // explicit override; auto-derived if None
}

impl BlockTypeDecl {
    /// Returns the resolved unitLabel: explicit override or title-cased type_name.
    pub fn unit_label(&self) -> String {
        self.display_label.clone().unwrap_or_else(|| {
            self.type_name
                .split('_')
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
    }
}

/// `set group: season`  (optional)
#[derive(Debug, Clone)]
pub struct GroupTypeDecl {
    pub type_name: String,
}

/// `set colour: married = "#f472b6"`
#[derive(Debug, Clone)]
pub struct ColourOverride {
    pub label: String,
    pub hex:   String,
}

// ── Statements ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ActorDecl {
    pub identifier:   String,
    pub display_name: String,
}

/// Produced by `link <label>(<from> -> <to>)` or `link <label>(<a> -- <b>)`.
/// The label is inferred from position — always the token between `link` and `(`.
#[derive(Debug, Clone)]
pub struct LinkStmt {
    pub label:    String,
    pub from:     String,
    pub to:       String,
    pub directed: bool,
}

/// Produced by `unlink <label> <a> <b>`.
#[derive(Debug, Clone)]
pub struct UnlinkStmt {
    pub label: String,
    pub a:     String,
    pub b:     String,
}

#[derive(Debug, Clone)]
pub struct DeceasedStmt {
    pub actor: String,
}

/// Produced by `rename <identifier>: "<New Display Name>"`.
/// Previous display name is automatically added to actor's aliases by the compiler.
#[derive(Debug, Clone)]
pub struct RenameStmt {
    pub actor:    String,
    pub new_name: String,
}

#[derive(Debug, Clone)]
pub enum Statement {
    Actor(ActorDecl),
    Link(LinkStmt),
    Unlink(UnlinkStmt),
    Deceased(DeceasedStmt),
    Rename(RenameStmt),
}

// ── Blocks ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct InitBlock {
    pub statements: Vec<Spanned<Statement>>,
}

/// Produced by `new <type>:` or `new <type>: "<label>"`.
/// Empty `statements` = valid empty block (graph unchanged this unit).
#[derive(Debug, Clone)]
pub struct EventBlock {
    pub label:      Option<String>,
    pub statements: Vec<Spanned<Statement>>,
}

/// Produced by `group "<label>":` with indented EventBlocks.
#[derive(Debug, Clone)]
pub struct GroupBlock {
    pub label:  Option<String>,
    pub blocks: Vec<Spanned<EventBlock>>,
}

#[derive(Debug, Clone)]
pub enum TopLevelItem {
    Block(EventBlock),
    Group(GroupBlock),
}

// ── Program ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Program {
    pub metadata:         SeriesMetadata,
    pub block_type:       BlockTypeDecl,
    pub group_type:       Option<GroupTypeDecl>,
    pub colour_overrides: Vec<Spanned<ColourOverride>>,
    pub init_block:       InitBlock,   // actor declarations live here for block-1 characters
    pub items:            Vec<Spanned<TopLevelItem>>,
}

// ── Compiler output ──────────────────────────────────────────────────
// These types are serialised as JSON and sent over the wire.
// They are distinct from the AST — identifiers replace UUIDs, and
// all temporal data is expressed as block indices.

use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct CompiledBlock {
    pub index:       usize,
    pub label:       Option<String>,  // from `new chapter: "The Storm"`
    pub group_label: Option<String>,  // from enclosing `group "Season 1":`
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledRename {
    pub name:          String,  // the new display name
    pub introduced_at: usize,   // block index where the rename takes effect (>= 2)
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledCharacter {
    pub identifier:    String,              // the ltg_identifier
    pub name:          String,              // initial display name (from actor declaration)
    pub aliases:       Vec<String>,         // user-defined + auto-added previous names from renames
    pub renames:       Vec<CompiledRename>, // temporal name changes, ordered by introduced_at
    pub introduced_at: usize,
    pub died_at:       Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledRelationship {
    pub from_identifier: String,
    pub to_identifier:   String,
    pub label:           String,
    pub directed:        bool,
    pub introduced_at:   usize,
    pub ended_at:        Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledSeries {
    pub title:       String,
    pub media_type:  MediaType,
    pub unit_label:  String,          // resolved from BlockTypeDecl::unit_label()
    pub total_units: usize,
    pub author:      Option<String>,  // from `metadata author:`
    pub group_type:  Option<String>,  // from `set group:`
}

#[derive(Debug, Clone, Serialize)]
pub struct CompiledGraph {
    pub series:        CompiledSeries,
    pub characters:    Vec<CompiledCharacter>,
    pub relationships: Vec<CompiledRelationship>,
    pub colours:       HashMap<String, String>, // label → hex, hash defaults + overrides
    pub blocks:        Vec<CompiledBlock>,       // one entry per block, index 1 = init:
}
```

---

## Wire Formats (LSP + custom endpoints)

### Diagnostics (standard LSP `textDocument/publishDiagnostics`)

The language server pushes diagnostics to the client using the standard LSP notification.
The frontend uses `monaco-languageclient` and receives these natively.

```jsonc
// Error codes sent in Diagnostic.code (severity 1 = error, 2 = warning)
//
// Errors:
//   MissingMetadata | DuplicateMetadata | InvalidMediaType |
//   MissingBlockDeclaration | DuplicateBlockDeclaration | InvalidDisplayLabel | WrongBlockType |
//   TopLevelActor | UndeclaredActor | DuplicateActor | DuplicateRelationship |
//   AlreadyDeceased | NoSuchRelationship | RelationshipAlreadyRemoved |
//   ReservedLabel | InvalidColour | NestedGroup |
//   MissingInit | DuplicateInit | UnlinkInInit | DeceasedInInit | RenameInInit |
//   TopLevelRename | InvalidIndentation | SyntaxError
//
// Warnings:
//   UnusedColourOverride | RenameDeceased
{
  "range": { "start": { "line": 4, "character": 12 },
             "end":   { "line": 4, "character": 22 } },
  "severity": 1,
  "code": "UndeclaredActor",
  "source": "ltg",
  "message": "Actor 'linton' has not been declared"
}
```

### Compile Request

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
      "title":      "Wuthering Heights",  // from: metadata title:
      "mediaType":  "book",               // from: metadata media:
      "unitLabel":  "Chapter",            // from: set block: chapter (auto-derived)
      "totalUnits": 34,
      "author":     "Emily Brontë",       // from: metadata author: (omitted if absent)
      "groupType":  null                  // from: set group: (omitted if absent)
    },
    "characters": [
      {
        "identifier":   "heathcliff",  // ltg identifier — stored for export round-trip
        "name":         "Heathcliff",
        "aliases":      [],
        "renames":      [],
        "introducedAt": 1,
        "diedAt":       null
      },
      {
        "identifier":   "catherine",
        "name":         "Catherine Earnshaw",       // initial name
        "aliases":      ["Catherine Linton"],        // auto-added by compiler from rename
        "renames":      [
          { "name": "Catherine Linton", "introducedAt": 14 }
        ],
        "introducedAt": 1,
        "diedAt":       16
      }
    ],
    "relationships": [
      {
        "fromIdentifier": "earnshaw",
        "toIdentifier":   "heathcliff",
        "label":          "father",
        "directed":       true,
        "introducedAt":   1,
        "endedAt":        null
      }
    ],
    // Merged colour map: hash defaults + set colour: overrides.
    "colours": {
      "father":   "#34d399",
      "sibling":  "#60a5fa",
      "married":  "#f472b6",
      "romantic": "#f472b6",
      "ally":     "#a78bfa",
      "rival":    "#fb923c",
      "enemy":    "#f87171"
    },
    // One entry per block, including init: (index 1) and empty blocks.
    // groupLabel is null for top-level blocks; set for blocks inside a `group` container.
    "blocks": [
      { "index": 1, "label": null,        "groupLabel": null },
      { "index": 2, "label": "A Study in Pink", "groupLabel": "Season 1" },
      { "index": 3, "label": null,        "groupLabel": "Season 1" },
      { "index": 4, "label": "The Great Game",  "groupLabel": "Season 1" },
      { "index": 5, "label": null,        "groupLabel": "Season 2" }
    ]
  }
}

// 422 Unprocessable — type errors
{
  "ok": false,
  "errors": [
    {
      "code":    "MissingMetadata",
      "message": "'metadata media:' is required but was not declared",
      "loc": { "line": 0, "column": 0 }
    }
  ]
}
```

### Backend Import

```
POST /api/import
Content-Type: application/json

<CompiledGraph JSON from the language server>
```

---

## Persistence Model

The LTG compiler emits a `CompiledGraph` that the backend persists across six tables.
The schema below reflects the state after migration `002_ltg_import`.

### Table overview

| Table | Purpose |
|---|---|
| `series` | One row per series — title, media type, unit label, total blocks, author, group type |
| `characters` | One row per actor — initial display name, aliases, temporal window, `ltg_identifier` |
| `character_renames` | One row per rename event — new name, block index; effective name resolved at query time |
| `relationships` | One row per edge — free-form label, directed flag, temporal window |
| `blocks` | One row per block — display label, group membership |
| `series_colours` | One row per label per series — hex colour, override flag |

`series.author` (from `metadata author:`) and `series.group_type` (from `set group:`) are
nullable and populated only for LTG-imported series. Both are required for export
round-trip fidelity — without them, `GET /api/series/:id/export` cannot reconstruct the
corresponding directives (migration `004_series_metadata`).

### `characters.ltg_identifier` (Gap 2)

The `ltg_identifier` column stores the unquoted identifier used in the `.ltg` source
(e.g. `heathcliff`, `young_cathy`). It is:

- **Nullable** — records created outside the LTG import flow (manual inserts, seed data)
  do not have one and are unaffected.
- **Unique within a series** — a partial unique index on `(series_id, ltg_identifier) WHERE
  ltg_identifier IS NOT NULL` enforces this without conflicting with NULL rows.
- **Required for export round-trip** — `GET /api/series/:id/export` uses it as the actor
  identifier in the generated `.ltg` file. Series without identifiers cannot be exported
  to LTG.
- **Upsert key** — `POST /api/import` uses `(series_id, ltg_identifier)` as the natural
  key, so re-importing an updated `.ltg` file updates existing records in place rather than
  creating duplicates.

### `blocks` table (Gap 3a)

Persists the timeline structure so the scrubber can display block labels and group
membership without recompiling the source.

```sql
CREATE TABLE blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id   UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    block_index INT  NOT NULL CHECK (block_index >= 1),
    label       TEXT,   -- optional: from `new chapter: "The Storm"`
    group_label TEXT,   -- optional: from enclosing `group "Season 1":`
    UNIQUE (series_id, block_index)
);
```

`block_index` is the global sequential index (1 = `init:`, 2 = first `new <type>:`, etc.).
Groups do not affect numbering — a block inside a group has the same index it would have
outside one.

### `series_colours` table (Gap 3b)

Stores the full colour map for each series — both hash-derived defaults and `set colour:`
overrides. The frontend reads this table to colour edges without recomputing hashes.

```sql
CREATE TABLE series_colours (
    series_id   UUID    NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    label       TEXT    NOT NULL,
    hex         TEXT    NOT NULL,
    is_override BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (series_id, label)
);
```

`is_override = true` means the colour came from a `set colour:` directive in the source.
The export path (`GET /api/series/:id/export`) emits only override rows as `set colour:`
directives; hash-derived rows are recomputed by the compiler on the next import.

### `relationships` label model

Migration `002` transitions the `relationships` table to the free-form label model:

- `kind` — the old enum (`family`, `parent_child`, …) is now **nullable**. Existing seed
  data retains its kind value. LTG-imported relationships set `kind = NULL`.
- `label` — now **NOT NULL**. Seed data was backfilled from `kind`; LTG-imported rows
  use the free-form label directly (e.g. `siblings`, `blood_oath`).

`label` is the canonical field used for colour lookup and export. `kind` is a legacy
read-only field used only by the existing frontend edge-styling path.

---

## Bidirectional Sync

The LTG editor and the visual graph editor share the same underlying data. To avoid
conflicts, the system uses a **mode ownership model**: only one mode can be the source
of truth at a time.

### Mode ownership

| Mode | Who owns the source of truth | Sync direction |
|---|---|---|
| **Text mode** | The `.ltg` text in Monaco | text → graph (live preview) |
| **Visual mode** | The visual graph canvas | graph → text (on export) |

Simultaneous bidirectional sync is not supported. The UI enforces this with a mode toggle
visible in the editor panel header. Switching modes prompts the user if there are unsaved
changes.

### Text → Graph (Gap 4)

While in text mode, the language server provides live preview:

1. On every `textDocument/didChange` (debounced at 300 ms), the language server runs the
   full pipeline: lex → parse → check → compile.
2. If the file is valid, the server pushes a `CompiledGraph` to the frontend via a custom
   LSP notification: `ltg/graphUpdated`.
3. The frontend's `GraphSource` (see below) switches to `local` mode and renders the
   compiled graph directly — no round-trip to the backend API.
4. Diagnostics (errors/warnings) are pushed via the standard `publishDiagnostics`
   notification and appear as squiggles in Monaco.

The graph preview is ephemeral — it is not persisted until the user clicks "Save to
server", which triggers a `POST /api/import`.

### Graph → LTG (Gap 4)

While in visual mode, changes to the graph are serialised to LTG on export:

1. The user edits the graph using the visual editor's action panel. The supported
   operations map directly to LTG event keywords:
   - **Add actor** → `actor <id>: "<Name>"` inside the current block. Actors are created
     by clicking an "Add character" button; the user supplies a display name and the
     editor generates a slug identifier (e.g. `"Mary Morstan"` → `mary_morstan`). If the
     slug collides with an existing identifier, `_2`, `_3`, etc. are appended until
     unique. The actor declaration is emitted into the block currently shown by the
     scrubber.
   - **Add relationship** → `link <label>(<a> -- <b>)` or `link <label>(<a> -> <b>)`
   - **Remove relationship** → `unlink <label> <a> <b>`
   - **Mark deceased** → `deceased <id>`
2. All changes are applied to the in-memory `CompiledGraph`.
3. On "Export to LTG" (or on switch back to text mode), the frontend sends the current
   `CompiledGraph` to `POST /compile/export` — a new language-server endpoint that
   generates `.ltg` source from a `CompiledGraph`.
4. The generated source replaces the Monaco editor content.

### GraphSource abstraction (Gap 5)

The frontend graph canvas is decoupled from its data source via a `GraphSource` union:

```ts
type GraphSource =
  | { kind: 'remote'; seriesId: string }         // backed by GET /api/series/:id/graph
  | { kind: 'local';  graph: CompiledGraph }      // backed by an in-memory CompiledGraph
```

- **`remote`** — the current default. `useGraphData` fetches from the Go API and the
  scrubber controls which block is visible.
- **`local`** — active during text-mode live preview and after a visual-mode import before
  "Save to server". The scrubber still works — it filters the in-memory graph client-side.

When the user saves to the server (`POST /api/import`), the source transitions from
`local` to `remote` with the newly created `seriesId`.

### Visual editor target block (Gap 6)

When in visual mode, the scrubber position determines **which block receives new events**
during export. The rule is:

> New events added in visual mode are assigned to the block currently shown by the
> scrubber. If the user is at block 5, a new `link` statement is emitted into the `new
> <type>:` block at index 5 in the generated `.ltg` source.

This means:
- The user navigates to the block they want to edit using the scrubber.
- They make changes on the canvas (drag a new edge, click "Mark deceased", etc.).
- On export, all changes are attributed to the current block.
- Changes that span multiple blocks (e.g. an `unlink` that should appear in block 7 while
  the relationship was created in block 3) require the user to navigate to the target block
  before making the change.

The visual editor enforces this constraint explicitly — the action panel always displays
"Editing block N" so the user knows where events will land.

---

## Planned Directives (Future Syntax)

These identifiers (`alias`, `describe`) are reserved keywords and may not be used as
actor identifiers or relationship labels today. Their syntax and semantics are specified
here so the lexer and parser can reserve the tokens, and so future implementation has a
clear target.

### `alias`

Attaches one or more alternative names to an actor. Aliases are stored in the
`characters.aliases` array and surfaced in the character panel and search.

```
alias(<identifier>, "<alternative name>")
```

```ltg
alias(heathcliff, "The Dark Stranger")
alias(catherine, "Cathy")
alias(catherine, "Mrs Linton")   # multiple aliases: one directive each
```

- `identifier` must be a declared actor.
- The alias string must be non-empty.
- Duplicate alias strings on the same actor are a warning (`DuplicateAlias`).
- May appear at the top level or inside any block (aliases do not have temporal scope —
  they apply to the whole series).

### `describe`

Attaches a prose description to an actor. Stored in `characters.description` and shown
in the character panel.

```
describe(<identifier>, "<description text>")
```

```ltg
describe(heathcliff, "A foundling brought from Liverpool by Mr. Earnshaw; dark, brooding, and consumed by revenge.")
describe(catherine, "Wild and passionate; torn between social ambition and her love for Heathcliff.")
```

- `identifier` must be a declared actor.
- Only one `describe` per actor; a second is a `DuplicateDescription` error.
- May appear at the top level or inside any block (descriptions do not have temporal scope).

---

## Implementation Roadmap

### Phase A — Specification *(done)*
- [x] Language grammar defined
- [x] Statement vocabulary complete (`link`, `unlink`, `deceased`)
- [x] `metadata` keyword for required series data (`title`, `media`) and optional fields (`author`); distinct from `set` by design
- [x] `set block: <type>` required; optional `= "<display>"` suffix for explicit unit label; auto-derives by title-casing when omitted
- [x] `new <type>:` replaces `set block: "<label>"`; empty blocks supported
- [x] `group "<label>":` for one level of hierarchical block grouping; `set group:` optional
- [x] Free-form relationship labels — no fixed kind enum; label inferred from position
- [x] Reserved keywords illegal as labels and actor identifiers
- [x] Colour assignment: deterministic hash + `set colour:` override
- [x] Type checking rules documented
- [x] AST and wire format types specified
- [x] Architecture: language server as the single source of truth
- [x] Full worked examples (Wuthering Heights, grouped TV show)
- [x] Persistence model documented: `ltg_identifier`, `blocks` table, `series_colours` table, label-first `relationships` schema, `author`/`group_type` on `series`
- [x] Bidirectional sync model documented: mode ownership, `GraphSource` abstraction, visual editor target block, visual mode actor creation
- [x] Indentation rules: 4 spaces per level, tabs are `InvalidIndentation`
- [x] `UnlinkInInit`, `DeceasedInInit` checker rules added
- [x] `UnusedColourOverride` as a warning (not error); warnings do not block compilation
- [x] Re-linking after `unlink` explicitly permitted; checker resets the slot
- [x] `alias` and `describe` reserved; planned directives fully specified
- [x] `CompiledGraph` Rust types specified; `blocks` array replaces `groups` in wire format
- [x] `GET /api/series/:id/export` returns `application/json` `{ "source": "..." }`
- [x] Actor declarations restricted to block bodies only; `TopLevelActor` error added; export canonical form is always inside the introduction block
- [x] `rename` directive: temporal display-name change; old name auto-added to aliases; `RenameInInit`, `TopLevelRename` errors; `RenameDeceased` warning; `character_renames` DB table; effective name resolved server-side

---

### Phase B — Language Server (`ltg-langserver`, Rust)

All parsing, type checking, and compilation lives here.  The frontend never sees an AST.

**Core pipeline (`ltg-langserver/src/`)**
- [ ] `lexer.rs` — `logos`-derived token enum; handles indentation depth, quoted strings,
      identifiers, `->` / `--` operators; keywords: `metadata`, `link`, `unlink`,
      `deceased`, `new`, `group`, `set`, `actor`, `init`; line tracking for LSP positions
- [ ] `parser.rs` — `chumsky` combinator parser; produces `Program` or `Vec<ParseError>`
      with source spans; error recovery allows partial ASTs so diagnostics keep working
      mid-edit; parses `metadata` directives, `set block:` with optional `= "<display>"`,
      `set group:` / `set colour:`, `new <type>:` blocks (optional label, empty body),
      and `group "<label>":` containers
- [ ] `checker.rs` — semantic analyser; enforces `metadata title:` and `metadata media:`
      presence and uniqueness; validates `media` value against `book | show | film`;
      validates `set block:` declared before `init:` and that all `new` statements match
      it; rejects `actor` declarations at the top level (`TopLevelActor`); simulates
      graph state block-by-block (tracks active relationships keyed by `(label, a, b)`,
      tracks deceased actors, resets removed-relationship flag on re-link); rejects
      `unlink`/`deceased`/`rename` in `init:` (`UnlinkInInit`, `DeceasedInInit`,
      `RenameInInit`); rejects `rename` at top level (`TopLevelRename`); emits
      `RenameDeceased` warning for renames on deceased actors; rejects reserved keywords
      as labels or actor identifiers; validates `set colour:` hex values; emits
      `UnusedColourOverride` warnings for overrides with no matching `link`; rejects
      nested groups; enforces 4-space indentation (delegates to lexer)
- [ ] `compiler.rs` — for each `rename` statement: appends a `CompiledRename` to the
      character's `renames` list and auto-adds the previous display name to `aliases`
- [ ] `compiler.rs` — validated `Program` → `CompiledGraph`; resolves `unitLabel` via
      `BlockTypeDecl::unit_label()`; assigns sequential block indices; builds `blocks`
      array (one `CompiledBlock` per block including `init:` and empty blocks, with
      `group_label` set for blocks inside a `group` container); computes the final
      `colours` map; pure function
- [ ] `colours.rs` — palette hash: maps a label string to a hex colour from a curated
      dark-background-friendly palette; deterministic, no state
- [ ] `pipeline.rs` — chains lex → parse → check → compile; returns `PipelineResult`
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
- [ ] `POST /compile` — one-shot compile for the file-upload import flow
- [ ] `GET /health`

**Infrastructure**
- [ ] `ltg-langserver/` Cargo workspace member alongside `frontend/` and `backend/`
- [ ] `Cargo.toml` with `logos`, `chumsky`, `tower-lsp`, `tokio`, `axum`,
      `tokio-tungstenite`, `serde`, `serde_json`
- [ ] Added to `compose.yaml` as a service (optional for dev — can run standalone)
- [ ] `Dockerfile` using `rust:alpine` builder → scratch/distroless final image

---

### Phase C — Import UI (Frontend — thin client)

> **Dependency:** Phase C requires both Phase B (`POST /compile`) and Phase D
> (`POST /api/import`). Develop C and D concurrently.

The frontend has **no parsing logic**. It sends raw text, receives structured JSON.

- [ ] "Import" button in the header
- [ ] `ImportModal` component — textarea + `.ltg` file upload
- [ ] On submit: `POST /compile` → display errors inline (with line numbers) or proceed
- [ ] On success: `POST /api/import` → redirect to the returned `seriesId` in the viewer
- [ ] In-memory series mode in `App.tsx` — bypasses `useGraphData` when a compiled graph
      is active; "Clear" button to return to backend-served data

---

### Phase D — Backend Import API (Graph API, Go)

> **Dependency:** Phase D must be developed concurrently with Phase C.

**Schema** *(migrations `002`–`004` — done)*
- [x] `characters.ltg_identifier` — nullable text, partial unique index on `(series_id, ltg_identifier)`
- [x] `blocks (series_id, block_index, label, group_label)` — timeline structure persistence
- [x] `series_colours (series_id, label, hex, is_override)` — colour map persistence
- [x] `relationships.kind` — nullable (legacy field); `relationships.label` — NOT NULL (canonical field)
- [x] `series.author` — nullable text, from `metadata author:`
- [x] `series.group_type` — nullable text, from `set group:`
- [x] `character_renames (character_id, series_id, name, introduced_at)` — temporal name changes; effective name resolved via correlated subquery in `GetCharactersAt`

**API**
- [ ] `POST /api/import` — accepts `CompiledGraph` JSON, writes to PostgreSQL; response
      format TBD (at minimum: `{ "seriesId": "uuid" }` on 201, errors on 422)
- [ ] Persist `colours` map → `series_colours`; `blocks` array → `blocks` table
- [ ] Upsert semantics keyed on `(series_id, ltg_identifier)` — re-importing updates in place
- [ ] Extend `GET /api/series/:id/graph` response to include `colours` map from
      `series_colours` (needed for LTG-imported series edge styling)
- [ ] `GET /api/series/:id/export` — `Content-Type: application/json`;
      body: `{ "source": "<raw .ltg text>" }`; reconstructs `metadata` directives,
      `set block:` with display label, `set group:`, `set colour:` (overrides only),
      `group` containers, and empty `new <type>:` blocks

---

### Phase E — In-Browser Editor (Frontend — thin client)

**Editor**
- [ ] Embed **Monaco Editor** in a split-pane layout (editor left, graph preview right)
- [ ] `monaco-languageclient` + `vscode-languageserver-protocol` — connects Monaco to the
      language server WebSocket; diagnostics appear automatically via `publishDiagnostics`
- [ ] LTG TextMate grammar for Monaco syntax highlighting (`metadata`, `link`, `unlink`,
      `deceased`, `new`, `group`, `set` keywords, `->` / `--` operators, `set colour:`
      directives, strings, comments)
- [ ] "Save to server" button — sends `ltg.compile` command over LSP, receives
      `CompiledGraph`, POSTs to `POST /api/import`
- [ ] Debounce document changes at 300 ms before sending `didChange` to the server

**Bidirectional sync**
- [ ] `GraphSource` union in the frontend store (`remote` | `local`) — see Bidirectional
      Sync section
- [ ] Mode toggle in editor panel header (text mode / visual mode)
- [ ] Text mode: on `ltg/graphUpdated` notification, switch `GraphSource` to `local` and
      re-render the graph canvas
- [ ] Visual mode: action panel with "Editing block N" indicator driven by scrubber
      position; changes applied to in-memory `CompiledGraph`
- [ ] Export flow: `POST /compile/export` on the language server, replaces Monaco content
      with generated `.ltg`; language server adds a new `POST /compile/export` endpoint
      accepting `CompiledGraph` and returning `.ltg` source

---

### Phase F — Tooling & DX

- [ ] **VSCode extension** — diagnostics, go-to-definition (actor declarations), hover
      (show resolved colour swatch for `link` statements and label hash preview)
- [ ] **CLI** — `ltg check <file>` embeds the language server core; exits non-zero on
      errors (CI-friendly)
- [ ] **Formatter** — `ltg fmt` canonicalises indentation; groups `metadata` directives
      first, then `set` directives, then actors; aligns `:` within each group; collapses
      consecutive empty `new <type>:` blocks onto one line with a count comment
- [ ] **`.ltg` file association** — `files.associations` in the VSCode extension manifest
