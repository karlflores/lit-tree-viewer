//! Chains lex → parse → check → compile into a single `run(src)` call.
//!
//! Every phase produces errors in its own type; this module unifies them into
//! a single `Diagnostic` representation that matches the LSP wire format.

use crate::checker::{self, CheckErrorCode, Severity};
use crate::compiler::{self, CompiledGraph};
use crate::lexer::{self, LexErrorKind, Span};
use crate::parser::{self, ParseError};

// ── Public types ──────────────────────────────────────────────────────────────

/// LSP-compatible 0-based line/character position.
#[derive(Debug, Clone, PartialEq)]
pub struct Position {
    pub line:      usize,
    pub character: usize,
}

/// A single diagnostic message from any pipeline phase.
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    /// 1 = error (halts compilation), 2 = warning (compilation continues).
    pub severity: u8,
    /// String error code matching the LTG spec's code table (e.g. `"UndeclaredActor"`).
    pub code:     String,
    pub message:  String,
    pub start:    Position,
    pub end:      Position,
}

impl Diagnostic {
    pub fn is_error(&self) -> bool {
        self.severity == 1
    }
}

/// The result of running the full pipeline on a source string.
#[derive(Debug)]
pub struct PipelineResult {
    /// Present only when all phases produced zero errors (warnings do not block this).
    pub graph:       Option<CompiledGraph>,
    /// All diagnostics from every phase, in emission order.
    pub diagnostics: Vec<Diagnostic>,
}

impl PipelineResult {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Run the full LTG pipeline on `src`.
///
/// All four phases are attempted as far as possible to maximise diagnostic
/// coverage.  Specifically:
/// - Lex errors are collected but parsing is still attempted.
/// - If chumsky error-recovery produces a partial AST alongside parse errors,
///   the checker still runs so callers see diagnostics from both phases.
/// - Compilation only runs when there are **zero errors** (warnings are fine).
pub fn run(src: &str) -> PipelineResult {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    // ── Phase 1: Lex ─────────────────────────────────────────────────────────
    let (tokens, lex_errors) = lexer::lex(src);
    for e in &lex_errors {
        diagnostics.push(lex_diagnostic(e, src));
    }

    // ── Phase 2: Parse ───────────────────────────────────────────────────────
    let (prog, parse_errors) = parser::parse(tokens, src.len());
    let has_parse_errors = !parse_errors.is_empty();
    for e in &parse_errors {
        diagnostics.push(parse_diagnostic(e, src));
    }

    let Some(prog) = prog else {
        // Parser produced no AST at all — cannot check or compile.
        return PipelineResult { graph: None, diagnostics };
    };

    // ── Phase 3: Check ───────────────────────────────────────────────────────
    let check_errors = checker::check(&prog);
    let has_check_errors = check_errors.iter().any(|e| e.severity == Severity::Error);
    for e in &check_errors {
        diagnostics.push(check_diagnostic(e, src));
    }

    if has_parse_errors || has_check_errors {
        return PipelineResult { graph: None, diagnostics };
    }

    // ── Phase 4: Compile ─────────────────────────────────────────────────────
    let graph = compiler::compile(&prog);
    PipelineResult { graph: Some(graph), diagnostics }
}

// ── Span → position conversion ────────────────────────────────────────────────

/// Convert a byte offset into a 0-based `(line, character)` position by
/// scanning the source up to that offset.
pub fn offset_to_position(src: &str, offset: usize) -> Position {
    let clamped = offset.min(src.len());
    let before = &src[..clamped];
    let line = before.bytes().filter(|&b| b == b'\n').count();
    let last_newline = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let character = clamped - last_newline;
    Position { line, character }
}

fn span_to_positions(src: &str, span: &Span) -> (Position, Position) {
    (offset_to_position(src, span.start), offset_to_position(src, span.end))
}

// ── Diagnostic constructors ───────────────────────────────────────────────────

fn lex_diagnostic(e: &lexer::LexError, src: &str) -> Diagnostic {
    let (start, end) = span_to_positions(src, &e.span);
    let (code, message) = match &e.kind {
        LexErrorKind::InvalidTab => (
            "InvalidIndentation",
            "tab character is not allowed — use 4 spaces per indent level".to_string(),
        ),
        LexErrorKind::InvalidIndentation { found } => (
            "InvalidIndentation",
            format!("indentation of {found} spaces is not a multiple of 4"),
        ),
        LexErrorKind::UnexpectedIndent { found } => (
            "InvalidIndentation",
            format!("unexpected indentation level {found} — jumped more than one level"),
        ),
        LexErrorKind::UnknownCharacter => (
            "SyntaxError",
            "unexpected character".to_string(),
        ),
    };
    Diagnostic { severity: 1, code: code.to_string(), message, start, end }
}

fn parse_diagnostic(e: &ParseError, src: &str) -> Diagnostic {
    let span = e.span();
    let (start, end) = span_to_positions(src, &span);
    Diagnostic {
        severity: 1,
        code:     "SyntaxError".to_string(),
        message:  format!("{e}"),
        start,
        end,
    }
}

fn check_diagnostic(e: &checker::CheckError, src: &str) -> Diagnostic {
    let (start, end) = span_to_positions(src, &e.span);
    let severity = match e.severity {
        Severity::Error   => 1,
        Severity::Warning => 2,
    };
    Diagnostic {
        severity,
        code:    check_code_str(&e.code).to_string(),
        message: e.message.clone(),
        start,
        end,
    }
}

/// Map a `CheckErrorCode` to its canonical LTG spec string code.
fn check_code_str(code: &CheckErrorCode) -> &'static str {
    use CheckErrorCode::*;
    match code {
        MissingMetadata { .. }       => "MissingMetadata",
        DuplicateMetadata { .. }     => "DuplicateMetadata",
        InvalidMediaType             => "InvalidMediaType",
        MissingBlockDeclaration      => "MissingBlockDeclaration",
        DuplicateBlockDeclaration    => "DuplicateBlockDeclaration",
        InvalidDisplayLabel          => "InvalidDisplayLabel",
        WrongBlockType { .. }        => "WrongBlockType",
        UndeclaredActor { .. }       => "UndeclaredActor",
        DuplicateActor { .. }        => "DuplicateActor",
        DuplicateRelationship { .. } => "DuplicateRelationship",
        AlreadyDeceased { .. }       => "AlreadyDeceased",
        NoSuchRelationship { .. }    => "NoSuchRelationship",
        InvalidColour { .. }         => "InvalidColour",
        UnusedColourOverride { .. }  => "UnusedColourOverride",
        MissingInit                  => "MissingInit",
        DuplicateInit                => "DuplicateInit",
        UnlinkInInit                 => "UnlinkInInit",
        DeceasedInInit               => "DeceasedInInit",
        RenameInInit                 => "RenameInInit",
        RenameDeceased { .. }        => "RenameDeceased",
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── offset_to_position ────────────────────────────────────────────────

    #[test]
    fn position_start_of_file() {
        assert_eq!(offset_to_position("hello", 0), Position { line: 0, character: 0 });
    }

    #[test]
    fn position_within_first_line() {
        assert_eq!(offset_to_position("hello world", 6), Position { line: 0, character: 6 });
    }

    #[test]
    fn position_start_of_second_line() {
        // "hello\n" is 6 bytes; offset 6 is the first char of line 1.
        assert_eq!(offset_to_position("hello\nworld", 6), Position { line: 1, character: 0 });
    }

    #[test]
    fn position_mid_second_line() {
        assert_eq!(offset_to_position("hello\nworld", 8), Position { line: 1, character: 2 });
    }

    #[test]
    fn position_clamped_to_src_len() {
        // Offset beyond end of source should not panic.
        let src = "hi";
        let pos = offset_to_position(src, 999);
        assert_eq!(pos, Position { line: 0, character: 2 });
    }

    #[test]
    fn position_after_multiple_newlines() {
        // "a\nb\nc\n" — offset 6 is the '\n' at the end of 'c'.
        assert_eq!(offset_to_position("a\nb\nc\n", 4), Position { line: 2, character: 0 });
    }

    // ── Full-pipeline happy path ───────────────────────────────────────────

    #[test]
    fn valid_program_returns_graph_no_diagnostics() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit:";
        let result = run(src);
        assert!(result.graph.is_some(), "expected a compiled graph");
        assert!(result.diagnostics.is_empty(), "expected no diagnostics: {:?}", result.diagnostics);
        assert!(!result.has_errors());
    }

    #[test]
    fn valid_program_with_warning_still_returns_graph() {
        // Unused colour override → warning but not an error → graph produced.
        let src = format!(
            r##"metadata title: "T"
metadata media: book
set colour: ally = "#a78bfa"
set block: chapter
init:"##
        );
        let result = run(&src);
        assert!(result.graph.is_some(), "warning must not suppress graph");
        assert!(result.diagnostics.iter().any(|d| d.severity == 2), "expected a warning");
        assert!(!result.has_errors());
    }

    // ── Lex errors ────────────────────────────────────────────────────────

    #[test]
    fn lex_error_tab_produces_diagnostic() {
        // A tab inside a line produces InvalidIndentation.
        let result = run("metadata\ttitle");
        let d = result.diagnostics.iter().find(|d| d.code == "InvalidIndentation");
        assert!(d.is_some(), "expected InvalidIndentation diagnostic");
        assert_eq!(d.unwrap().severity, 1);
    }

    #[test]
    fn lex_error_unknown_char_produces_diagnostic() {
        let result = run("@");
        let d = result.diagnostics.iter().find(|d| d.code == "SyntaxError");
        assert!(d.is_some(), "expected SyntaxError diagnostic");
    }

    #[test]
    fn lex_error_does_not_stop_parse_attempt() {
        // A lone `@` produces a lex error but parsing continues.
        // The program is still invalid (missing required fields), so no graph.
        let result = run("@ metadata title: \"T\"");
        assert!(result.diagnostics.iter().any(|d| d.code == "SyntaxError"));
        // Also missing required fields → more diagnostics from check phase.
        assert!(result.diagnostics.iter().any(|d| d.code == "MissingMetadata"
            || d.code == "MissingBlockDeclaration"
            || d.code == "MissingInit"));
    }

    // ── Parse errors ──────────────────────────────────────────────────────

    #[test]
    fn parse_error_produces_syntax_error_diagnostic() {
        // `init` without `:` is a parse error.
        let result = run("metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit");
        let d = result.diagnostics.iter().find(|d| d.code == "SyntaxError");
        assert!(d.is_some(), "expected SyntaxError diagnostic: {:?}", result.diagnostics);
        assert!(result.graph.is_none());
    }

    // ── Check errors ──────────────────────────────────────────────────────

    #[test]
    fn missing_title_produces_missing_metadata_diagnostic() {
        let result = run("metadata media: book\nset block: chapter\ninit:");
        assert!(result.diagnostics.iter().any(|d| d.code == "MissingMetadata"));
        assert!(result.graph.is_none());
    }

    #[test]
    fn invalid_media_type_produces_diagnostic() {
        let result = run("metadata title: \"T\"\nmetadata media: romance\nset block: chapter\ninit:");
        assert!(result.diagnostics.iter().any(|d| d.code == "InvalidMediaType"));
        assert!(result.graph.is_none());
    }

    #[test]
    fn undeclared_actor_produces_diagnostic() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit:\n    link ally(ghost -- nobody)";
        let result = run(src);
        assert!(result.diagnostics.iter().any(|d| d.code == "UndeclaredActor"));
        assert!(result.graph.is_none());
    }

    #[test]
    fn all_check_error_codes_are_mapped() {
        // Spot-check a handful of code strings to catch typos in check_code_str.
        use CheckErrorCode::*;
        let cases: &[(&CheckErrorCode, &str)] = &[
            (&MissingMetadata { key: "title" },  "MissingMetadata"),
            (&DuplicateInit,                      "DuplicateInit"),
            (&UnlinkInInit,                       "UnlinkInInit"),
            (&DeceasedInInit,                     "DeceasedInInit"),
            (&RenameInInit,                       "RenameInInit"),
            (&AlreadyDeceased { name: "a".into() }, "AlreadyDeceased"),
            (&InvalidColour { value: "#x".into() }, "InvalidColour"),
            (&UnusedColourOverride { label: "a".into() }, "UnusedColourOverride"),
            (&RenameDeceased { name: "a".into() },  "RenameDeceased"),
        ];
        for (code, expected) in cases {
            assert_eq!(check_code_str(code), *expected, "mismatch for {expected}");
        }
    }

    // ── Diagnostic positions ──────────────────────────────────────────────

    #[test]
    fn diagnostic_on_first_line_has_line_0() {
        // `metadata media: book` on line 0 but duplicate on line 1.
        let src = "metadata media: book\nmetadata media: show\nmetadata title: \"T\"\nset block: chapter\ninit:";
        let result = run(src);
        let dup = result.diagnostics.iter().find(|d| d.code == "DuplicateMetadata").unwrap();
        // The duplicate is on line 1 (second `metadata media:`)
        assert_eq!(dup.start.line, 1, "duplicate should be on line 1, got {:?}", dup.start);
    }

    #[test]
    fn missing_required_diagnostic_points_to_start_of_file() {
        // Missing fields have no specific location → reported at (0, 0).
        let result = run("init:");
        let missing = result.diagnostics.iter().find(|d| d.code == "MissingMetadata").unwrap();
        assert_eq!(missing.start, Position { line: 0, character: 0 });
    }

    // ── Severity mapping ──────────────────────────────────────────────────

    #[test]
    fn check_error_maps_to_severity_1() {
        let result = run("init:"); // missing everything
        assert!(result.diagnostics.iter().all(|d| d.severity == 1));
    }

    #[test]
    fn check_warning_maps_to_severity_2() {
        let src = format!(
            r##"metadata title: "T"
metadata media: book
set colour: never = "#ff0000"
set block: chapter
init:"##
        );
        let result = run(&src);
        let warn = result.diagnostics.iter().find(|d| d.code == "UnusedColourOverride").unwrap();
        assert_eq!(warn.severity, 2);
    }

    // ── Multiple phases accumulate diagnostics ────────────────────────────

    #[test]
    fn diagnostics_accumulate_across_phases() {
        // Completely empty source → missing title, media, block decl, init.
        let result = run("");
        assert!(result.diagnostics.len() >= 4);
        let codes: Vec<_> = result.diagnostics.iter().map(|d| d.code.as_str()).collect();
        assert!(codes.contains(&"MissingMetadata"));
        assert!(codes.contains(&"MissingBlockDeclaration"));
        assert!(codes.contains(&"MissingInit"));
    }
}
