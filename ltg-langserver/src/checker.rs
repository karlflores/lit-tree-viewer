use std::collections::{HashMap, HashSet};

use crate::ast::*;
use crate::lexer::Span;

// ── Public error types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CheckError {
    pub code: CheckErrorCode,
    pub message: String,
    pub severity: Severity,
    pub span: Span,
}

/// One variant per named error/warning in the LTG spec.
///
/// Rules already enforced structurally by the parser (`TopLevelActor`,
/// `TopLevelRename`, `ReservedLabel`, `NestedGroup`) and by the lexer
/// (`InvalidIndentation`) are intentionally absent here.
#[derive(Debug, Clone, PartialEq)]
pub enum CheckErrorCode {
    // ── Metadata ─────────────────────────────────────────────────────────
    /// A required metadata field (`title` or `media`) was never declared.
    MissingMetadata { key: &'static str },
    /// A metadata field appeared more than once.
    DuplicateMetadata { key: &'static str },
    /// `metadata media:` value was not `book`, `show`, or `film`.
    InvalidMediaType,

    // ── Structural declarations ───────────────────────────────────────────
    /// No `set block: <type>` was present.
    MissingBlockDeclaration,
    /// `set block:` appeared more than once.
    DuplicateBlockDeclaration,
    /// The `= "<display>"` value on `set block:` was an empty string.
    InvalidDisplayLabel,
    /// A `new <type>:` block used a type name that differs from the declared one.
    WrongBlockType { expected: String, found: String },

    // ── Init ─────────────────────────────────────────────────────────────
    /// No `init:` block was present.
    MissingInit,
    /// `init:` appeared more than once.
    DuplicateInit,
    /// `unlink` was used inside `init:`.
    UnlinkInInit,
    /// `deceased` was used inside `init:`.
    DeceasedInInit,
    /// `rename` was used inside `init:`.
    RenameInInit,

    // ── Actors ───────────────────────────────────────────────────────────
    /// An identifier was referenced before its `actor` declaration.
    UndeclaredActor { name: String },
    /// An actor identifier was declared more than once.
    DuplicateActor { name: String },
    /// An actor was marked `deceased` more than once.
    AlreadyDeceased { name: String },
    /// `rename` was applied to a deceased actor (warning).
    RenameDeceased { name: String },

    // ── Relationships ────────────────────────────────────────────────────
    /// A `link` was declared while an identical one was already active.
    DuplicateRelationship { label: String, a: String, b: String },
    /// `unlink` referenced a relationship that is not currently active.
    NoSuchRelationship { label: String, a: String, b: String },

    // ── Colour overrides ─────────────────────────────────────────────────
    /// `set colour:` hex value was not a valid `#rrggbb` string.
    InvalidColour { value: String },
    /// A `set colour:` label was never used in any `link` statement (warning).
    UnusedColourOverride { label: String },
}

// ── Checker state ─────────────────────────────────────────────────────────────

struct State {
    title_span: Option<Span>,
    media_span: Option<Span>,
    /// Declared block type name and its declaration span.
    block_decl: Option<(String, Span)>,
    init_seen: bool,

    /// Actors declared so far: identifier → declaration span.
    actors: HashMap<String, Span>,
    /// Actors that have been marked deceased.
    deceased: HashSet<String>,
    /// Active relationships: canonical key → span of the `link` that opened it.
    /// Key: `(label, min(a,b), max(a,b))` — direction is not part of the key
    /// because `unlink` accepts either actor order for both directed and undirected edges.
    active_rels: HashMap<(String, String, String), Span>,

    /// `set colour:` directives in order: `(label, directive_span)`.
    colour_overrides: Vec<(String, Span)>,
    /// Every label that appeared in a `link` statement.
    link_labels_seen: HashSet<String>,
}

impl State {
    fn new() -> Self {
        Self {
            title_span: None,
            media_span: None,
            block_decl: None,
            init_seen: false,
            actors: HashMap::new(),
            deceased: HashSet::new(),
            active_rels: HashMap::new(),
            colour_overrides: Vec::new(),
            link_labels_seen: HashSet::new(),
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Semantically validate a parsed `Program`.
///
/// Returns all errors and warnings.  Warnings have `severity = Warning` and do
/// not prevent compilation.  Errors have `severity = Error`.
pub fn check(program: &Program) -> Vec<CheckError> {
    let mut errors: Vec<CheckError> = Vec::new();
    let mut state = State::new();

    for (decl, span) in &program.items {
        check_top_level(decl, span.clone(), &mut state, &mut errors);
    }

    // ── Post-pass: missing required declarations ──────────────────────────
    if state.title_span.is_none() {
        errors.push(mk_err(
            CheckErrorCode::MissingMetadata { key: "title" },
            "missing required `metadata title: \"...\"`",
            0..0,
        ));
    }
    if state.media_span.is_none() {
        errors.push(mk_err(
            CheckErrorCode::MissingMetadata { key: "media" },
            "missing required `metadata media: book | show | film`",
            0..0,
        ));
    }
    if state.block_decl.is_none() {
        errors.push(mk_err(
            CheckErrorCode::MissingBlockDeclaration,
            "missing required `set block: <type>`",
            0..0,
        ));
    }
    if !state.init_seen {
        errors.push(mk_err(
            CheckErrorCode::MissingInit,
            "missing required `init:` block",
            0..0,
        ));
    }

    // ── Post-pass: unused colour overrides ────────────────────────────────
    for (label, col_span) in &state.colour_overrides {
        if !state.link_labels_seen.contains(label) {
            errors.push(mk_warn(
                CheckErrorCode::UnusedColourOverride { label: label.clone() },
                format!("colour override for `{label}` is never used in any `link` statement"),
                col_span.clone(),
            ));
        }
    }

    errors
}

// ── Top-level dispatch ────────────────────────────────────────────────────────

fn check_top_level(
    decl: &TopLevelDecl,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    match decl {
        TopLevelDecl::Metadata(dir)    => check_metadata(dir, span, state, errors),
        TopLevelDecl::SetBlock(decl)   => check_set_block(decl, span, state, errors),
        TopLevelDecl::SetGroup(_)      => {} // No semantic errors per spec
        TopLevelDecl::SetColour(col)   => check_set_colour(col, span, state, errors),
        TopLevelDecl::Init(block)      => check_init(block, span, state, errors),
        TopLevelDecl::NewBlock(block)  => check_new_block(block, span, state, errors),
        TopLevelDecl::Group(group)     => check_group(group, span, state, errors),
    }
}

// ── Directive checkers ────────────────────────────────────────────────────────

fn check_metadata(
    dir: &MetadataDirective,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    match dir.key.as_str() {
        "title" => {
            if state.title_span.is_some() {
                errors.push(mk_err(
                    CheckErrorCode::DuplicateMetadata { key: "title" },
                    "duplicate `metadata title:`",
                    span,
                ));
            } else {
                state.title_span = Some(span);
            }
        }
        "media" => {
            // Check value first (applies to every `media` directive, not just the first).
            if let MetadataValue::Str(_) = &dir.value {
                errors.push(mk_err(
                    CheckErrorCode::InvalidMediaType,
                    "metadata media: value must be `book`, `show`, or `film` (unquoted)",
                    span.clone(),
                ));
            }
            if state.media_span.is_some() {
                errors.push(mk_err(
                    CheckErrorCode::DuplicateMetadata { key: "media" },
                    "duplicate `metadata media:`",
                    span,
                ));
            } else {
                state.media_span = Some(span);
            }
        }
        _ => {} // Unknown keys pass through; the checker does not validate arbitrary metadata
    }
}

fn check_set_block(
    decl: &BlockTypeDecl,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    // Empty display label check (independent of duplicate check).
    if let Some(label) = &decl.display_label {
        if label.is_empty() {
            errors.push(mk_err(
                CheckErrorCode::InvalidDisplayLabel,
                "`set block:` display label must not be empty",
                span.clone(),
            ));
        }
    }

    if state.block_decl.is_some() {
        errors.push(mk_err(
            CheckErrorCode::DuplicateBlockDeclaration,
            "duplicate `set block:` declaration",
            span,
        ));
    } else {
        state.block_decl = Some((decl.type_name.clone(), span));
    }
}

fn check_set_colour(
    col: &ColourOverride,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    if !is_valid_hex(&col.hex) {
        errors.push(mk_err(
            CheckErrorCode::InvalidColour { value: col.hex.clone() },
            format!("`{}` is not a valid hex colour — expected `#rrggbb`", col.hex),
            span.clone(),
        ));
    }
    state.colour_overrides.push((col.label.clone(), span));
}

fn check_init(
    block: &InitBlock,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    if state.init_seen {
        errors.push(mk_err(
            CheckErrorCode::DuplicateInit,
            "duplicate `init:` block — `init:` must appear exactly once",
            span,
        ));
        return; // Don't process statements of the duplicate; avoids spurious actor errors.
    }
    state.init_seen = true;

    for (stmt, stmt_span) in &block.statements {
        check_statement(stmt, stmt_span.clone(), state, errors, /*in_init=*/ true);
    }
}

fn check_new_block(
    block: &EventBlock,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    if let Some((expected, _)) = &state.block_decl {
        if block.block_type != *expected {
            errors.push(mk_err(
                CheckErrorCode::WrongBlockType {
                    expected: expected.clone(),
                    found: block.block_type.clone(),
                },
                format!(
                    "block type `{}` does not match the declared type `{}`",
                    block.block_type, expected
                ),
                span,
            ));
        }
    }

    for (stmt, stmt_span) in &block.statements {
        check_statement(stmt, stmt_span.clone(), state, errors, /*in_init=*/ false);
    }
}

fn check_group(
    group: &GroupBlock,
    _span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
) {
    for (block, blk_span) in &group.blocks {
        check_new_block(block, blk_span.clone(), state, errors);
    }
}

// ── Statement checker ─────────────────────────────────────────────────────────

fn check_statement(
    stmt: &Statement,
    span: Span,
    state: &mut State,
    errors: &mut Vec<CheckError>,
    in_init: bool,
) {
    match stmt {
        Statement::Actor(decl) => {
            if state.actors.contains_key(&decl.identifier) {
                errors.push(mk_err(
                    CheckErrorCode::DuplicateActor { name: decl.identifier.clone() },
                    format!("actor `{}` is already declared", decl.identifier),
                    span,
                ));
            } else {
                state.actors.insert(decl.identifier.clone(), span);
            }
        }

        Statement::Link(link) => {
            let from_ok = require_actor(&link.from, span.clone(), state, errors);
            let to_ok   = require_actor(&link.to,   span.clone(), state, errors);

            state.link_labels_seen.insert(link.label.clone());

            if from_ok && to_ok {
                let key = rel_key(&link.label, &link.from, &link.to);
                if state.active_rels.contains_key(&key) {
                    errors.push(mk_err(
                        CheckErrorCode::DuplicateRelationship {
                            label: link.label.clone(),
                            a: link.from.clone(),
                            b: link.to.clone(),
                        },
                        format!(
                            "relationship `{}` between `{}` and `{}` is already active",
                            link.label, link.from, link.to
                        ),
                        span,
                    ));
                } else {
                    state.active_rels.insert(key, span);
                }
            }
        }

        Statement::Unlink(unlink) => {
            if in_init {
                errors.push(mk_err(
                    CheckErrorCode::UnlinkInInit,
                    "`unlink` is not valid inside `init:` — there are no relationships to remove yet",
                    span.clone(),
                ));
            }

            let a_ok = require_actor(&unlink.a, span.clone(), state, errors);
            let b_ok = require_actor(&unlink.b, span.clone(), state, errors);

            if a_ok && b_ok {
                let key = rel_key(&unlink.label, &unlink.a, &unlink.b);
                if state.active_rels.remove(&key).is_none() {
                    errors.push(mk_err(
                        CheckErrorCode::NoSuchRelationship {
                            label: unlink.label.clone(),
                            a: unlink.a.clone(),
                            b: unlink.b.clone(),
                        },
                        format!(
                            "no active relationship `{}` between `{}` and `{}`",
                            unlink.label, unlink.a, unlink.b
                        ),
                        span,
                    ));
                }
            }
        }

        Statement::Deceased(dec) => {
            if in_init {
                errors.push(mk_err(
                    CheckErrorCode::DeceasedInInit,
                    "`deceased` is not valid inside `init:` — omit characters who never appear alive",
                    span.clone(),
                ));
            }

            if require_actor(&dec.actor, span.clone(), state, errors) {
                if state.deceased.contains(&dec.actor) {
                    errors.push(mk_err(
                        CheckErrorCode::AlreadyDeceased { name: dec.actor.clone() },
                        format!("actor `{}` is already marked deceased", dec.actor),
                        span,
                    ));
                } else {
                    state.deceased.insert(dec.actor.clone());
                }
            }
        }

        Statement::Rename(rename) => {
            if in_init {
                errors.push(mk_err(
                    CheckErrorCode::RenameInInit,
                    "`rename` is not valid inside `init:` — set the display name in the `actor` declaration",
                    span.clone(),
                ));
            }

            if require_actor(&rename.actor, span.clone(), state, errors) {
                if state.deceased.contains(&rename.actor) {
                    errors.push(mk_warn(
                        CheckErrorCode::RenameDeceased { name: rename.actor.clone() },
                        format!(
                            "actor `{}` is deceased; renaming a deceased actor is unusual",
                            rename.actor
                        ),
                        span,
                    ));
                }
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Check that `name` has been declared as an actor.  Pushes `UndeclaredActor`
/// if not.  Returns `true` iff the actor is declared (allowing callers to
/// skip follow-on checks that would produce spurious errors).
fn require_actor(
    name: &str,
    span: Span,
    state: &State,
    errors: &mut Vec<CheckError>,
) -> bool {
    if state.actors.contains_key(name) {
        true
    } else {
        errors.push(mk_err(
            CheckErrorCode::UndeclaredActor { name: name.to_string() },
            format!("actor `{name}` is not declared"),
            span,
        ));
        false
    }
}

/// Canonical relationship key: direction is ignored — both `(A→B)` and `(B→A)`
/// share the same slot.  This matches the spec's unlink semantics ("either order
/// is accepted for directed edges").
fn rel_key(label: &str, a: &str, b: &str) -> (String, String, String) {
    let (ca, cb) = if a <= b { (a, b) } else { (b, a) };
    (label.to_string(), ca.to_string(), cb.to_string())
}

/// A valid LTG hex colour: exactly `#` followed by 6 ASCII hex digits.
fn is_valid_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn mk_err(code: CheckErrorCode, message: impl Into<String>, span: Span) -> CheckError {
    CheckError { code, message: message.into(), severity: Severity::Error, span }
}

fn mk_warn(code: CheckErrorCode, message: impl Into<String>, span: Span) -> CheckError {
    CheckError { code, message: message.into(), severity: Severity::Warning, span }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::lex;
    use crate::parser::parse;

    // ── Test helpers ──────────────────────────────────────────────────────

    fn check_src(src: &str) -> Vec<CheckError> {
        let (tokens, lex_errs) = lex(src);
        assert!(lex_errs.is_empty(), "unexpected lex errors: {lex_errs:?}");
        let (prog, parse_errs) = parse(tokens, src.len());
        assert!(parse_errs.is_empty(), "unexpected parse errors: {parse_errs:?}");
        check(&prog.unwrap())
    }

    /// Collect only the error codes (drops messages and spans for easier assertions).
    fn codes(src: &str) -> Vec<CheckErrorCode> {
        check_src(src).into_iter().map(|e| e.code).collect()
    }

    /// Assert the program is semantically clean (no errors or warnings).
    fn check_ok(src: &str) {
        let errs = check_src(src);
        assert!(errs.is_empty(), "expected no errors, got: {errs:#?}");
    }

    /// Minimal valid program used as a base for tests that only care about one rule.
    const HEADER: &str = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\n";

    /// Minimal valid program (header + empty init).
    fn valid() -> String {
        format!("{HEADER}init:")
    }

    /// Valid program with two actors declared in init.
    fn valid_with_actors() -> String {
        format!("{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"")
    }

    // ── Full valid program ────────────────────────────────────────────────

    #[test]
    fn valid_minimal_program_passes() {
        check_ok(&valid());
    }

    #[test]
    fn valid_full_wuthering_heights_passes() {
        let src = r##"
metadata title:  "Wuthering Heights"
metadata media:  book
metadata author: "Emily Brontë"

set block: chapter

set colour: father  = "#34d399"
set colour: sibling = "#60a5fa"

init:
    actor earnshaw:   "Mr. Earnshaw"
    actor hindley:    "Hindley Earnshaw"
    actor catherine:  "Catherine Earnshaw"
    actor heathcliff: "Heathcliff"
    link father(earnshaw -> hindley)
    link sibling(hindley -- catherine)

new chapter:

new chapter: "Chapter 9"
    deceased earnshaw

new chapter: "Chapter 14"
    actor linton: "Edgar Linton"
    rename catherine: "Catherine Linton"
    link married(catherine -- linton)
    unlink sibling hindley catherine
"##;
        check_ok(src);
    }

    // ── MissingMetadata ───────────────────────────────────────────────────

    #[test]
    fn missing_title_produces_error() {
        let src = "metadata media: book\nset block: chapter\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::MissingMetadata { key: "title" }));
    }

    #[test]
    fn missing_media_produces_error() {
        let src = "metadata title: \"T\"\nset block: chapter\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::MissingMetadata { key: "media" }));
    }

    // ── DuplicateMetadata ─────────────────────────────────────────────────

    #[test]
    fn duplicate_title_produces_error() {
        let src = "metadata title: \"T\"\nmetadata title: \"T2\"\nmetadata media: book\nset block: chapter\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::DuplicateMetadata { key: "title" }));
    }

    #[test]
    fn duplicate_media_produces_error() {
        let src = "metadata title: \"T\"\nmetadata media: book\nmetadata media: show\nset block: chapter\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::DuplicateMetadata { key: "media" }));
    }

    // ── InvalidMediaType ──────────────────────────────────────────────────

    #[test]
    fn unknown_media_type_produces_error() {
        let src = "metadata title: \"T\"\nmetadata media: romance\nset block: chapter\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::InvalidMediaType));
    }

    #[test]
    fn quoted_media_type_produces_error() {
        // `"book"` (with quotes) is a string literal, not the keyword `book`.
        let src = "metadata title: \"T\"\nmetadata media: \"book\"\nset block: chapter\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::InvalidMediaType));
    }

    // ── MissingBlockDeclaration / DuplicateBlockDeclaration ───────────────

    #[test]
    fn missing_block_declaration_produces_error() {
        let src = "metadata title: \"T\"\nmetadata media: book\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::MissingBlockDeclaration));
    }

    #[test]
    fn duplicate_block_declaration_produces_error() {
        let src = format!("{HEADER}set block: episode\ninit:");
        assert!(codes(&src).contains(&CheckErrorCode::DuplicateBlockDeclaration));
    }

    // ── InvalidDisplayLabel ───────────────────────────────────────────────

    #[test]
    fn empty_display_label_produces_error() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter = \"\"\ninit:";
        assert!(codes(src).contains(&CheckErrorCode::InvalidDisplayLabel));
    }

    // ── WrongBlockType ────────────────────────────────────────────────────

    #[test]
    fn wrong_block_type_produces_error() {
        let src = format!("{}\nnew episode:", valid_with_actors());
        assert!(codes(&src).contains(&CheckErrorCode::WrongBlockType {
            expected: "chapter".to_string(),
            found: "episode".to_string(),
        }));
    }

    #[test]
    fn correct_block_type_passes() {
        let src = format!("{}\nnew chapter:", valid());
        check_ok(&src);
    }

    // ── MissingInit / DuplicateInit ───────────────────────────────────────

    #[test]
    fn missing_init_produces_error() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter";
        assert!(codes(src).contains(&CheckErrorCode::MissingInit));
    }

    #[test]
    fn duplicate_init_produces_error() {
        let src = format!("{}\ninit:", valid());
        assert!(codes(&src).contains(&CheckErrorCode::DuplicateInit));
    }

    // ── UnlinkInInit / DeceasedInInit / RenameInInit ──────────────────────

    #[test]
    fn unlink_in_init_produces_error() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\n    unlink ally a b"
        );
        assert!(codes(&src).contains(&CheckErrorCode::UnlinkInInit));
    }

    #[test]
    fn deceased_in_init_produces_error() {
        let src = format!("{HEADER}init:\n    actor a: \"A\"\n    deceased a");
        assert!(codes(&src).contains(&CheckErrorCode::DeceasedInInit));
    }

    #[test]
    fn rename_in_init_produces_error() {
        let src = format!("{HEADER}init:\n    actor a: \"A\"\n    rename a: \"New\"");
        assert!(codes(&src).contains(&CheckErrorCode::RenameInInit));
    }

    // ── DuplicateActor ────────────────────────────────────────────────────

    #[test]
    fn duplicate_actor_produces_error() {
        let src = format!("{HEADER}init:\n    actor a: \"A\"\n    actor a: \"A2\"");
        assert!(codes(&src).contains(&CheckErrorCode::DuplicateActor { name: "a".to_string() }));
    }

    #[test]
    fn duplicate_actor_across_blocks_produces_error() {
        let src = format!("{HEADER}init:\n    actor a: \"A\"\nnew chapter:\n    actor a: \"A2\"");
        assert!(codes(&src).contains(&CheckErrorCode::DuplicateActor { name: "a".to_string() }));
    }

    // ── UndeclaredActor ───────────────────────────────────────────────────

    #[test]
    fn undeclared_actor_in_link_produces_error() {
        let src = format!("{HEADER}init:\n    actor a: \"A\"\n    link ally(a -- ghost)");
        assert!(codes(&src).contains(&CheckErrorCode::UndeclaredActor { name: "ghost".to_string() }));
    }

    #[test]
    fn undeclared_actor_in_unlink_produces_error() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\nnew chapter:\n    unlink ally a ghost"
        );
        assert!(codes(&src).contains(&CheckErrorCode::UndeclaredActor { name: "ghost".to_string() }));
    }

    #[test]
    fn undeclared_actor_in_deceased_produces_error() {
        let src = format!("{HEADER}init:\nnew chapter:\n    deceased ghost");
        assert!(codes(&src).contains(&CheckErrorCode::UndeclaredActor { name: "ghost".to_string() }));
    }

    #[test]
    fn undeclared_actor_in_rename_produces_error() {
        let src = format!("{HEADER}init:\nnew chapter:\n    rename ghost: \"New\"");
        assert!(codes(&src).contains(&CheckErrorCode::UndeclaredActor { name: "ghost".to_string() }));
    }

    #[test]
    fn forward_reference_in_link_produces_error() {
        // `b` is declared after the link that references it.
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    link ally(a -- b)\n    actor b: \"B\""
        );
        assert!(codes(&src).contains(&CheckErrorCode::UndeclaredActor { name: "b".to_string() }));
    }

    // ── DuplicateRelationship ─────────────────────────────────────────────

    #[test]
    fn duplicate_link_same_label_produces_error() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\n    link ally(a -- b)"
        );
        assert!(codes(&src).contains(&CheckErrorCode::DuplicateRelationship {
            label: "ally".to_string(),
            a: "a".to_string(),
            b: "b".to_string(),
        }));
    }

    #[test]
    fn duplicate_link_reversed_actors_produces_error() {
        // Direction is irrelevant for uniqueness — `ally(a -- b)` and `ally(b -- a)` share a slot.
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\n    link ally(b -- a)"
        );
        assert!(codes(&src).iter().any(|c| matches!(c, CheckErrorCode::DuplicateRelationship { .. })));
    }

    #[test]
    fn two_different_labels_between_same_actors_passes() {
        // `ally` and `rival` are distinct labels → two separate active relationships.
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\n    link rival(a -- b)"
        );
        check_ok(&src);
    }

    // ── NoSuchRelationship ────────────────────────────────────────────────

    #[test]
    fn unlink_nonexistent_relationship_produces_error() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\nnew chapter:\n    unlink ally a b"
        );
        assert!(codes(&src).contains(&CheckErrorCode::NoSuchRelationship {
            label: "ally".to_string(),
            a: "a".to_string(),
            b: "b".to_string(),
        }));
    }

    #[test]
    fn unlink_already_removed_relationship_produces_error() {
        // Link, unlink, then unlink again — second unlink has no active rel.
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\nnew chapter:\n    unlink ally a b\nnew chapter:\n    unlink ally a b"
        );
        assert!(codes(&src).iter().any(|c| matches!(c, CheckErrorCode::NoSuchRelationship { .. })));
    }

    #[test]
    fn relink_after_unlink_passes() {
        // Spec: a re-established relationship after unlink is valid and creates a new DB row.
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\nnew chapter:\n    unlink ally a b\nnew chapter:\n    link ally(a -- b)"
        );
        check_ok(&src);
    }

    // ── AlreadyDeceased ───────────────────────────────────────────────────

    #[test]
    fn deceased_twice_produces_error() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\nnew chapter:\n    deceased a\nnew chapter:\n    deceased a"
        );
        assert!(codes(&src).contains(&CheckErrorCode::AlreadyDeceased { name: "a".to_string() }));
    }

    // ── RenameDeceased (warning) ──────────────────────────────────────────

    #[test]
    fn rename_deceased_produces_warning_not_error() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\nnew chapter:\n    deceased a\nnew chapter:\n    rename a: \"Ghost\""
        );
        let errs = check_src(&src);
        let rename_warn = errs.iter().find(|e| {
            e.code == CheckErrorCode::RenameDeceased { name: "a".to_string() }
        });
        assert!(rename_warn.is_some(), "expected RenameDeceased warning");
        assert_eq!(rename_warn.unwrap().severity, Severity::Warning);
        // No errors, only the one warning.
        assert!(!errs.iter().any(|e| e.severity == Severity::Error));
    }

    // ── InvalidColour ─────────────────────────────────────────────────────

    #[test]
    fn invalid_hex_too_short_produces_error() {
        let src = format!("{HEADER}set colour: ally = \"#abc\"\ninit:");
        assert!(codes(&src).contains(&CheckErrorCode::InvalidColour { value: "#abc".to_string() }));
    }

    #[test]
    fn invalid_hex_no_hash_produces_error() {
        let src = format!("{HEADER}set colour: ally = \"f472b6\"\ninit:");
        assert!(codes(&src).contains(&CheckErrorCode::InvalidColour { value: "f472b6".to_string() }));
    }

    #[test]
    fn invalid_hex_non_hex_digits_produces_error() {
        let src = format!("{HEADER}set colour: ally = \"#zzzzzz\"\ninit:");
        assert!(codes(&src).contains(&CheckErrorCode::InvalidColour { value: "#zzzzzz".to_string() }));
    }

    #[test]
    fn valid_hex_passes() {
        // r##"..."## because the hex string contains `"#`.
        let src = format!(r##"{HEADER}set colour: ally = "#a78bfa"
init:
    actor a: "A"
    actor b: "B"
    link ally(a -- b)"##);
        check_ok(&src);
    }

    // ── UnusedColourOverride (warning) ────────────────────────────────────

    #[test]
    fn unused_colour_override_produces_warning() {
        // `ally` override is declared but no `link ally(...)` ever appears.
        let src = format!(r##"{HEADER}set colour: ally = "#a78bfa"
init:"##);
        let errs = check_src(&src);
        let warn = errs.iter().find(|e| {
            e.code == CheckErrorCode::UnusedColourOverride { label: "ally".to_string() }
        });
        assert!(warn.is_some(), "expected UnusedColourOverride warning");
        assert_eq!(warn.unwrap().severity, Severity::Warning);
    }

    #[test]
    fn colour_override_is_used_no_warning() {
        let src = format!(
            r##"{HEADER}set colour: ally = "#a78bfa"
init:
    actor a: "A"
    actor b: "B"
    link ally(a -- b)"##
        );
        let errs = check_src(&src);
        assert!(!errs.iter().any(|e| matches!(&e.code, CheckErrorCode::UnusedColourOverride { .. })));
    }

    // ── Multiple errors accumulate ────────────────────────────────────────

    #[test]
    fn multiple_errors_reported_in_one_pass() {
        // Missing title, media, block decl, and init — all four should appear.
        let errs = check_src("new chapter:");
        let cs: Vec<_> = errs.iter().map(|e| &e.code).collect();
        assert!(cs.iter().any(|c| matches!(c, CheckErrorCode::MissingMetadata { key: "title" })));
        assert!(cs.iter().any(|c| matches!(c, CheckErrorCode::MissingMetadata { key: "media" })));
        assert!(cs.iter().any(|c| matches!(c, CheckErrorCode::MissingBlockDeclaration)));
        assert!(cs.iter().any(|c| matches!(c, CheckErrorCode::MissingInit)));
    }

    // ── Group block ───────────────────────────────────────────────────────

    #[test]
    fn statements_inside_group_blocks_are_checked() {
        // Ghost actor referenced inside a group's new block.
        let src = format!(
            "{HEADER}init:\ngroup \"S1\":\n    new chapter:\n        deceased ghost"
        );
        assert!(codes(&src).contains(&CheckErrorCode::UndeclaredActor { name: "ghost".to_string() }));
    }

    #[test]
    fn wrong_block_type_inside_group_produces_error() {
        let src = format!("{HEADER}init:\ngroup \"S1\":\n    new episode:");
        assert!(codes(&src).contains(&CheckErrorCode::WrongBlockType {
            expected: "chapter".to_string(),
            found: "episode".to_string(),
        }));
    }
}
