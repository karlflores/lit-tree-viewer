use logos::Logos;
use std::ops::Range;

pub type Span = Range<usize>;

// ── Raw tokens (logos) ────────────────────────────────────────────────────────
//
// These are the tokens produced directly by `logos`. Indentation is not yet
// processed — that happens in a second pass (`process_indentation`).
//
// Keyword priority: `#[token]` patterns take precedence over `#[regex]` patterns
// for the same input length, so `metadata` → `Metadata` (not `Ident`).

/// Inline whitespace and line comments are skipped at the enum level so they
/// never appear in the token stream.  Newlines are captured separately.
#[derive(Logos, Debug, Clone, PartialEq)]
#[logos(error = LexRawError)]
#[logos(skip r"[ ]+")] // horizontal whitespace within a line
#[logos(skip(r"#[^\n]*", allow_greedy = true))] // `# …` line comments (not the newline itself)
pub enum RawToken {
    // ── Structural keywords ───────────────────────────────────────────────
    #[token("metadata")] Metadata,
    #[token("set")]      Set,
    #[token("init")]     Init,
    #[token("new")]      New,
    #[token("group")]    Group,
    #[token("actor")]    Actor,
    #[token("link")]     Link,
    #[token("unlink")]   Unlink,
    #[token("deceased")] Deceased,
    #[token("rename")]   Rename,
    #[token("alias")]    Alias,
    #[token("describe")] Describe,

    // ── Punctuation ───────────────────────────────────────────────────────
    #[token(":")] Colon,
    #[token("(")] LParen,
    #[token(")")] RParen,
    #[token("--")] Undirected,
    #[token("->")] Arrow,
    #[token("=")] Equals,

    // ── Literals ──────────────────────────────────────────────────────────
    /// A double-quoted string literal; the stored value strips the surrounding quotes.
    /// Escape sequences are not supported — `"` cannot appear inside a string.
    #[regex(r#""[^"]*""#, |lex| {
        let s = lex.slice();
        s[1..s.len() - 1].to_string()
    })]
    StringLit(String),

    /// Identifiers: `[a-zA-Z_][a-zA-Z0-9_]*`.
    /// Keywords have higher priority and are matched first when they have the same length.
    #[regex(r"[a-zA-Z_][a-zA-Z0-9_]*", |lex| lex.slice().to_string())]
    Ident(String),

    // ── Indentation / line structure ──────────────────────────────────────
    /// A newline (`\n`) followed by zero or more spaces on the NEXT line.
    /// The `usize` is the number of leading spaces — the effective indent of the next line.
    /// Tab characters on the next line are handled separately (they stop `[ ]*`).
    #[regex(r"\n[ ]*", |lex| lex.slice().len() - 1)]
    Newline(usize),

    /// A tab character — always an `InvalidIndentation` error in LTG.
    /// Tabs are never valid (not as block indent, not within a line).
    #[token("\t")]
    Tab,

}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct LexRawError;

// ── Processed token type ──────────────────────────────────────────────────────

/// The token type consumed by the parser after indentation processing.
/// `Indent` and `Dedent` are synthetic — they replace `Newline(n)` tokens.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Token {
    // Keywords
    Metadata, Set, Init, New, Group, Actor, Link, Unlink, Deceased, Rename, Alias, Describe,
    // Punctuation
    Colon, LParen, RParen, Undirected, Arrow, Equals,
    // Literals
    StringLit(String),
    Ident(String),
    // Synthetic indentation tokens
    Indent,
    Dedent,
}

impl std::fmt::Display for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Token::Metadata  => write!(f, "'metadata'"),
            Token::Set       => write!(f, "'set'"),
            Token::Init      => write!(f, "'init'"),
            Token::New       => write!(f, "'new'"),
            Token::Group     => write!(f, "'group'"),
            Token::Actor     => write!(f, "'actor'"),
            Token::Link      => write!(f, "'link'"),
            Token::Unlink    => write!(f, "'unlink'"),
            Token::Deceased  => write!(f, "'deceased'"),
            Token::Rename    => write!(f, "'rename'"),
            Token::Alias     => write!(f, "'alias'"),
            Token::Describe  => write!(f, "'describe'"),
            Token::Colon     => write!(f, "':'"),
            Token::LParen    => write!(f, "'('"),
            Token::RParen    => write!(f, "')'"),
            Token::Undirected => write!(f, "'--'"),
            Token::Arrow     => write!(f, "'->'"),
            Token::Equals    => write!(f, "'='"),
            Token::StringLit(s) => write!(f, "\"{}\"", s),
            Token::Ident(s)  => write!(f, "'{}'", s),
            Token::Indent    => write!(f, "INDENT"),
            Token::Dedent    => write!(f, "DEDENT"),
        }
    }
}

// ── Lex errors ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct LexError {
    pub kind: LexErrorKind,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LexErrorKind {
    /// A tab character was used (only 4-space indentation is valid).
    InvalidTab,
    /// Indentation was not a multiple of 4 spaces.
    InvalidIndentation { found: usize },
    /// Indentation jumped to a level that was never opened
    /// (e.g. 0 → 8 without an intervening 4).
    UnexpectedIndent { found: usize },
    /// An unrecognised character was encountered.
    UnknownCharacter,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// A token paired with its source span.
pub type Spanned<T> = (T, Span);

/// Lex `src` into a processed token stream.
///
/// Returns `(tokens, errors)`. Errors are non-fatal: the lexer continues after
/// each error. The caller should report all errors but may still attempt parsing.
pub fn lex(src: &str) -> (Vec<Spanned<Token>>, Vec<LexError>) {
    // Step 1: run logos to get raw (RawToken, Span) pairs.
    let raw: Vec<(Result<RawToken, LexRawError>, Span)> =
        RawToken::lexer(src).spanned().collect();

    // Step 2: collapse consecutive Newline tokens (blank lines / comment-only lines).
    let raw = collapse_blank_lines(raw);

    // Step 3: convert Newline(n) → Indent / Dedent via an indent stack.
    process_indentation(raw)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Collapse consecutive `Newline` tokens, keeping only the last one in each run.
/// This handles blank lines and comment-only lines (whose comments were already
/// skipped by logos, leaving a pair of adjacent `Newline`s).
fn collapse_blank_lines(
    raw: Vec<(Result<RawToken, LexRawError>, Span)>,
) -> Vec<(Result<RawToken, LexRawError>, Span)> {
    let mut out = Vec::with_capacity(raw.len());
    let mut pending: Option<(usize, Span)> = None;

    for (tok, span) in raw {
        if let Ok(RawToken::Newline(n)) = &tok {
            // Replace any previous pending newline (blank line elision).
            pending = Some((*n, span));
        } else {
            if let Some((n, nl_span)) = pending.take() {
                out.push((Ok(RawToken::Newline(n)), nl_span));
            }
            out.push((tok, span));
        }
    }
    // Flush the final pending newline — used to DEDENT unclosed blocks at EOF.
    if let Some((n, nl_span)) = pending {
        out.push((Ok(RawToken::Newline(n)), nl_span));
    }
    out
}

/// Walk the collapsed raw stream and emit `Token::Indent` / `Token::Dedent`
/// tokens in place of `RawToken::Newline(n)`, tracking an indent stack.
fn process_indentation(
    raw: Vec<(Result<RawToken, LexRawError>, Span)>,
) -> (Vec<Spanned<Token>>, Vec<LexError>) {
    let mut tokens: Vec<Spanned<Token>> = Vec::new();
    let mut errors: Vec<LexError> = Vec::new();
    let mut stack: Vec<usize> = vec![0]; // starts at column 0

    for (tok, span) in raw {
        match tok {
            Ok(RawToken::Newline(n)) => {
                // Indentation must be a multiple of 4.
                if n % 4 != 0 {
                    errors.push(LexError {
                        kind: LexErrorKind::InvalidIndentation { found: n },
                        span,
                    });
                    continue;
                }

                let current = *stack.last().unwrap();

                if n > current {
                    // Opening a new block — must be exactly one level deeper.
                    if n != current + 4 {
                        errors.push(LexError {
                            kind: LexErrorKind::UnexpectedIndent { found: n },
                            span,
                        });
                        continue;
                    }
                    stack.push(n);
                    tokens.push((Token::Indent, span));
                } else if n < current {
                    // Closing one or more blocks — dedent to the matching level.
                    while *stack.last().unwrap() > n {
                        stack.pop();
                        tokens.push((Token::Dedent, span.clone()));
                    }
                    // After popping, the top of the stack must match exactly.
                    if *stack.last().unwrap() != n {
                        errors.push(LexError {
                            kind: LexErrorKind::UnexpectedIndent { found: n },
                            span,
                        });
                    }
                }
                // n == current → same level, no Indent/Dedent needed.
            }

            Ok(RawToken::Tab) => {
                errors.push(LexError {
                    kind: LexErrorKind::InvalidTab,
                    span,
                });
            }

            Err(_) => {
                errors.push(LexError {
                    kind: LexErrorKind::UnknownCharacter,
                    span,
                });
            }

            Ok(raw_tok) => {
                let tok = convert(raw_tok);
                tokens.push((tok, span));
            }
        }
    }

    // At EOF, close any remaining open blocks.
    let eof = tokens.last().map_or(0..0, |(_, s)| s.end..s.end);
    while stack.len() > 1 {
        stack.pop();
        tokens.push((Token::Dedent, eof.clone()));
    }

    (tokens, errors)
}

/// Convert a `RawToken` (that is not `Newline`, `Tab`, or `Error`) to a `Token`.
fn convert(raw: RawToken) -> Token {
    match raw {
        RawToken::Metadata  => Token::Metadata,
        RawToken::Set       => Token::Set,
        RawToken::Init      => Token::Init,
        RawToken::New       => Token::New,
        RawToken::Group     => Token::Group,
        RawToken::Actor     => Token::Actor,
        RawToken::Link      => Token::Link,
        RawToken::Unlink    => Token::Unlink,
        RawToken::Deceased  => Token::Deceased,
        RawToken::Rename    => Token::Rename,
        RawToken::Alias     => Token::Alias,
        RawToken::Describe  => Token::Describe,
        RawToken::Colon     => Token::Colon,
        RawToken::LParen    => Token::LParen,
        RawToken::RParen    => Token::RParen,
        RawToken::Undirected => Token::Undirected,
        RawToken::Arrow     => Token::Arrow,
        RawToken::Equals    => Token::Equals,
        RawToken::StringLit(s) => Token::StringLit(s),
        RawToken::Ident(s)  => Token::Ident(s),
        // These variants are handled before `convert` is called.
        RawToken::Newline(_) | RawToken::Tab => unreachable!(),
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Strip spans from a lex result for easier assertion.
    fn tokens(src: &str) -> Vec<Token> {
        let (toks, _errs) = lex(src);
        toks.into_iter().map(|(t, _)| t).collect()
    }

    fn errors(src: &str) -> Vec<LexErrorKind> {
        let (_toks, errs) = lex(src);
        errs.into_iter().map(|e| e.kind).collect()
    }

    // ── Keywords ──────────────────────────────────────────────────────────

    #[test]
    fn lex_keywords() {
        assert_eq!(tokens("metadata"), vec![Token::Metadata]);
        assert_eq!(tokens("set"),      vec![Token::Set]);
        assert_eq!(tokens("init"),     vec![Token::Init]);
        assert_eq!(tokens("new"),      vec![Token::New]);
        assert_eq!(tokens("group"),    vec![Token::Group]);
        assert_eq!(tokens("actor"),    vec![Token::Actor]);
        assert_eq!(tokens("link"),     vec![Token::Link]);
        assert_eq!(tokens("unlink"),   vec![Token::Unlink]);
        assert_eq!(tokens("deceased"), vec![Token::Deceased]);
        assert_eq!(tokens("rename"),   vec![Token::Rename]);
        assert_eq!(tokens("alias"),    vec![Token::Alias]);
        assert_eq!(tokens("describe"), vec![Token::Describe]);
    }

    #[test]
    fn keyword_prefix_is_ident() {
        // "metadata_foo" should not be split into Metadata + Ident("_foo")
        assert_eq!(tokens("metadata_foo"), vec![Token::Ident("metadata_foo".to_string())]);
    }

    #[test]
    fn keyword_with_suffix_is_ident() {
        assert_eq!(tokens("initfoo"), vec![Token::Ident("initfoo".to_string())]);
        assert_eq!(tokens("linkage"), vec![Token::Ident("linkage".to_string())]);
    }

    // ── Non-keyword identifiers ────────────────────────────────────────────

    #[test]
    fn lex_plain_ident() {
        assert_eq!(tokens("chapter"), vec![Token::Ident("chapter".to_string())]);
        assert_eq!(tokens("season"),  vec![Token::Ident("season".to_string())]);
        assert_eq!(tokens("book"),    vec![Token::Ident("book".to_string())]);
        assert_eq!(tokens("show"),    vec![Token::Ident("show".to_string())]);
        assert_eq!(tokens("film"),    vec![Token::Ident("film".to_string())]);
    }

    #[test]
    fn ident_with_underscore() {
        assert_eq!(tokens("story_arc"), vec![Token::Ident("story_arc".to_string())]);
        assert_eq!(tokens("_private"),  vec![Token::Ident("_private".to_string())]);
        assert_eq!(tokens("my_char_1"), vec![Token::Ident("my_char_1".to_string())]);
    }

    // ── String literals ────────────────────────────────────────────────────

    #[test]
    fn lex_string_literal() {
        assert_eq!(
            tokens(r#""Wuthering Heights""#),
            vec![Token::StringLit("Wuthering Heights".to_string())]
        );
    }

    #[test]
    fn lex_empty_string() {
        assert_eq!(tokens(r#""""#), vec![Token::StringLit("".to_string())]);
    }

    #[test]
    fn lex_string_with_unicode() {
        assert_eq!(
            tokens(r#""Emily Brontë""#),
            vec![Token::StringLit("Emily Brontë".to_string())]
        );
    }

    // ── Punctuation ────────────────────────────────────────────────────────

    #[test]
    fn lex_punctuation() {
        assert_eq!(tokens(":"),  vec![Token::Colon]);
        assert_eq!(tokens("("),  vec![Token::LParen]);
        assert_eq!(tokens(")"),  vec![Token::RParen]);
        assert_eq!(tokens("--"), vec![Token::Undirected]);
        assert_eq!(tokens("->"), vec![Token::Arrow]);
        assert_eq!(tokens("="),  vec![Token::Equals]);
    }

    #[test]
    fn undirected_distinguished_from_arrow() {
        // `--` must not be lexed as two `-` tokens, and `->` is distinct from `--`
        assert_eq!(tokens("--"), vec![Token::Undirected]);
        assert_eq!(tokens("->"), vec![Token::Arrow]);
    }

    // ── Comments ───────────────────────────────────────────────────────────

    #[test]
    fn comment_is_skipped() {
        assert_eq!(tokens("# this is a comment"), vec![]);
    }

    #[test]
    fn comment_after_token_is_skipped() {
        assert_eq!(
            tokens("metadata # comment"),
            vec![Token::Metadata]
        );
    }

    #[test]
    fn comment_does_not_consume_newline() {
        // The newline after a comment should still be captured as Newline(n)
        // and drive indentation tracking.
        let src = "metadata\n# comment\nset";
        // After collapse: Metadata, Newline(0), Set  (two Newline(0)s collapse to one)
        assert_eq!(tokens(src), vec![Token::Metadata, Token::Set]);
    }

    // ── Inline whitespace ──────────────────────────────────────────────────

    #[test]
    fn multiple_spaces_between_tokens_are_skipped() {
        assert_eq!(
            tokens("metadata   title"),
            vec![Token::Metadata, Token::Ident("title".to_string())]
        );
    }

    // ── Indentation — valid cases ─────────────────────────────────────────

    #[test]
    fn no_indentation_change_emits_no_indent_dedent() {
        let src = "init\nset";
        assert_eq!(tokens(src), vec![Token::Init, Token::Set]);
    }

    #[test]
    fn four_spaces_emits_indent_then_dedent_at_eof() {
        let src = "init:\n    actor";
        assert_eq!(
            tokens(src),
            vec![Token::Init, Token::Colon, Token::Indent, Token::Actor, Token::Dedent]
        );
    }

    #[test]
    fn dedent_emitted_when_returning_to_top_level() {
        let src = "init:\n    actor\nset";
        assert_eq!(
            tokens(src),
            vec![
                Token::Init, Token::Colon,
                Token::Indent,
                    Token::Actor,
                Token::Dedent,
                Token::Set,
            ]
        );
    }

    #[test]
    fn multiple_statements_at_same_indent_level() {
        let src = "init:\n    actor\n    link";
        assert_eq!(
            tokens(src),
            vec![
                Token::Init, Token::Colon,
                Token::Indent,
                    Token::Actor,
                    Token::Link,
                Token::Dedent,
            ]
        );
    }

    #[test]
    fn two_levels_of_indentation() {
        // group body (level 4) then block body (level 8)
        let src = "group:\n    new:\n        actor";
        assert_eq!(
            tokens(src),
            vec![
                Token::Group, Token::Colon,
                Token::Indent,
                    Token::New, Token::Colon,
                    Token::Indent,
                        Token::Actor,
                    Token::Dedent,
                Token::Dedent,
            ]
        );
    }

    #[test]
    fn blank_lines_are_ignored() {
        let src = "init:\n\n    actor";
        // The blank line produces a Newline(0) immediately followed by Newline(4).
        // collapse_blank_lines keeps only the last → Newline(4) → Indent.
        assert_eq!(
            tokens(src),
            vec![
                Token::Init, Token::Colon,
                Token::Indent,
                    Token::Actor,
                Token::Dedent,
            ]
        );
    }

    #[test]
    fn comment_only_lines_ignored_for_indentation() {
        let src = "init:\n    # a comment\n    actor";
        // Comment is skipped by logos; its line becomes a bare Newline(4) with no following
        // non-newline token before the next Newline(4) → both collapse to one Newline(4).
        assert_eq!(
            tokens(src),
            vec![
                Token::Init, Token::Colon,
                Token::Indent,
                    Token::Actor,
                Token::Dedent,
            ]
        );
    }

    #[test]
    fn multiple_open_blocks_all_dedented_at_eof() {
        let src = "group:\n    new:\n        actor";
        let toks = tokens(src);
        // Should end with two Dedents
        assert_eq!(toks.last(), Some(&Token::Dedent));
        let dedent_count = toks.iter().filter(|t| **t == Token::Dedent).count();
        assert_eq!(dedent_count, 2);
    }

    // ── Indentation — error cases ─────────────────────────────────────────

    #[test]
    fn tab_character_produces_error() {
        let errs = errors("\t");
        assert!(errs.contains(&LexErrorKind::InvalidTab));
    }

    #[test]
    fn non_multiple_of_4_indent_produces_error() {
        let errs = errors("init:\n   actor"); // 3 spaces
        assert!(errs.iter().any(|e| matches!(e, LexErrorKind::InvalidIndentation { found: 3 })));
    }

    #[test]
    fn five_space_indent_produces_error() {
        let errs = errors("init:\n     actor"); // 5 spaces
        assert!(errs.iter().any(|e| matches!(e, LexErrorKind::InvalidIndentation { found: 5 })));
    }

    #[test]
    fn jump_of_two_levels_produces_error() {
        // 0 → 8 (skipping level 4) is invalid
        let errs = errors("init:\n        actor"); // 8 spaces from top level
        assert!(errs.iter().any(|e| matches!(e, LexErrorKind::UnexpectedIndent { found: 8 })));
    }

    #[test]
    fn tab_in_middle_of_line_produces_error_not_indent() {
        let errs = errors("metadata\ttitle");
        assert!(errs.contains(&LexErrorKind::InvalidTab));
        // The Tab should not affect indentation tracking
    }

    // ── Full statement sequences ───────────────────────────────────────────

    #[test]
    fn lex_metadata_line() {
        let src = r#"metadata title: "Wuthering Heights""#;
        assert_eq!(
            tokens(src),
            vec![
                Token::Metadata,
                Token::Ident("title".to_string()),
                Token::Colon,
                Token::StringLit("Wuthering Heights".to_string()),
            ]
        );
    }

    #[test]
    fn lex_set_block_line() {
        assert_eq!(
            tokens("set block: chapter"),
            vec![
                Token::Set,
                Token::Ident("block".to_string()),
                Token::Colon,
                Token::Ident("chapter".to_string()),
            ]
        );
    }

    #[test]
    fn lex_set_block_with_display_label() {
        assert_eq!(
            tokens(r#"set block: story_arc = "Story Arc""#),
            vec![
                Token::Set,
                Token::Ident("block".to_string()),
                Token::Colon,
                Token::Ident("story_arc".to_string()),
                Token::Equals,
                Token::StringLit("Story Arc".to_string()),
            ]
        );
    }

    #[test]
    fn lex_set_group_line() {
        // `group` is a keyword, so `set group: season` produces Set Group Colon Ident
        assert_eq!(
            tokens("set group: season"),
            vec![
                Token::Set,
                Token::Group,
                Token::Colon,
                Token::Ident("season".to_string()),
            ]
        );
    }

    #[test]
    fn lex_set_colour_line() {
        assert_eq!(
            tokens(r##"set colour: married = "#f472b6""##),
            vec![
                Token::Set,
                Token::Ident("colour".to_string()),
                Token::Colon,
                Token::Ident("married".to_string()),
                Token::Equals,
                Token::StringLit("#f472b6".to_string()),
            ]
        );
    }

    #[test]
    fn lex_actor_declaration() {
        assert_eq!(
            tokens(r#"actor heathcliff: "Heathcliff""#),
            vec![
                Token::Actor,
                Token::Ident("heathcliff".to_string()),
                Token::Colon,
                Token::StringLit("Heathcliff".to_string()),
            ]
        );
    }

    #[test]
    fn lex_link_undirected() {
        assert_eq!(
            tokens("link sibling(hindley -- catherine)"),
            vec![
                Token::Link,
                Token::Ident("sibling".to_string()),
                Token::LParen,
                Token::Ident("hindley".to_string()),
                Token::Undirected,
                Token::Ident("catherine".to_string()),
                Token::RParen,
            ]
        );
    }

    #[test]
    fn lex_link_directed() {
        assert_eq!(
            tokens("link father(earnshaw -> hindley)"),
            vec![
                Token::Link,
                Token::Ident("father".to_string()),
                Token::LParen,
                Token::Ident("earnshaw".to_string()),
                Token::Arrow,
                Token::Ident("hindley".to_string()),
                Token::RParen,
            ]
        );
    }

    #[test]
    fn lex_unlink() {
        assert_eq!(
            tokens("unlink romantic heathcliff catherine"),
            vec![
                Token::Unlink,
                Token::Ident("romantic".to_string()),
                Token::Ident("heathcliff".to_string()),
                Token::Ident("catherine".to_string()),
            ]
        );
    }

    #[test]
    fn lex_deceased() {
        assert_eq!(
            tokens("deceased earnshaw"),
            vec![Token::Deceased, Token::Ident("earnshaw".to_string())]
        );
    }

    #[test]
    fn lex_rename() {
        assert_eq!(
            tokens(r#"rename catherine: "Catherine Linton""#),
            vec![
                Token::Rename,
                Token::Ident("catherine".to_string()),
                Token::Colon,
                Token::StringLit("Catherine Linton".to_string()),
            ]
        );
    }

    #[test]
    fn lex_init_block_with_statements() {
        let src = "init:\n    actor a: \"A\"\n    link friend(a -- a)";
        let toks = tokens(src);
        assert_eq!(
            toks,
            vec![
                Token::Init, Token::Colon,
                Token::Indent,
                    Token::Actor, Token::Ident("a".to_string()), Token::Colon, Token::StringLit("A".to_string()),
                    Token::Link, Token::Ident("friend".to_string()), Token::LParen,
                        Token::Ident("a".to_string()), Token::Undirected, Token::Ident("a".to_string()),
                    Token::RParen,
                Token::Dedent,
            ]
        );
    }

    #[test]
    fn lex_new_block_with_optional_label() {
        assert_eq!(
            tokens(r#"new chapter: "The Storm""#),
            vec![
                Token::New,
                Token::Ident("chapter".to_string()),
                Token::Colon,
                Token::StringLit("The Storm".to_string()),
            ]
        );
        assert_eq!(
            tokens("new chapter:"),
            vec![Token::New, Token::Ident("chapter".to_string()), Token::Colon]
        );
    }

    #[test]
    fn lex_group_block_named_and_unnamed() {
        assert_eq!(
            tokens(r#"group "Season 1":"#),
            vec![
                Token::Group,
                Token::StringLit("Season 1".to_string()),
                Token::Colon,
            ]
        );
        assert_eq!(tokens("group:"), vec![Token::Group, Token::Colon]);
    }

    #[test]
    fn lex_unknown_char_produces_error() {
        let errs = errors("@");
        assert!(errs.contains(&LexErrorKind::UnknownCharacter));
    }

    // ── Additional indentation error cases ───────────────────────────────

    #[test]
    fn dedent_to_non_multiple_level_produces_error() {
        // Dedenting from 8 to 2 (not a multiple of 4) hits InvalidIndentation,
        // not UnexpectedIndent — the multiple-of-4 check runs first.
        let src = "group:\n    new:\n        actor\n  set";
        let errs = errors(src);
        assert!(
            errs.iter().any(|e| matches!(e, LexErrorKind::InvalidIndentation { found: 2 })),
            "expected InvalidIndentation {{ found: 2 }}, got {errs:?}"
        );
    }

    // ── Error recovery ────────────────────────────────────────────────────

    #[test]
    fn lex_recovers_after_unknown_char() {
        // After an unknown char `@` the lexer should still produce subsequent tokens.
        let (toks, _) = lex("@ metadata");
        let errs = errors("@ metadata");
        assert!(errs.contains(&LexErrorKind::UnknownCharacter));
        assert!(toks.iter().any(|(t, _)| *t == Token::Metadata), "tokens after error: {toks:?}");
    }

    #[test]
    fn lex_multiple_errors_accumulate() {
        // Two unknown chars → two errors.
        let errs = errors("@ $");
        let unknown_count = errs.iter().filter(|e| **e == LexErrorKind::UnknownCharacter).count();
        assert_eq!(unknown_count, 2, "expected 2 UnknownCharacter errors, got {errs:?}");
    }

    // ── Additional full-line sequences ────────────────────────────────────

    #[test]
    fn lex_metadata_media_line() {
        // `media` is not a keyword — it lexes as Ident. Values book/show/film are also Ident.
        assert_eq!(
            tokens("metadata media: book"),
            vec![
                Token::Metadata,
                Token::Ident("media".to_string()),
                Token::Colon,
                Token::Ident("book".to_string()),
            ]
        );
        assert_eq!(
            tokens("metadata media: show"),
            vec![
                Token::Metadata,
                Token::Ident("media".to_string()),
                Token::Colon,
                Token::Ident("show".to_string()),
            ]
        );
        assert_eq!(
            tokens("metadata media: film"),
            vec![
                Token::Metadata,
                Token::Ident("media".to_string()),
                Token::Colon,
                Token::Ident("film".to_string()),
            ]
        );
    }

    #[test]
    fn lex_link_with_underscore_label() {
        // `blood_oath` is a valid link label (from the spec example).
        assert_eq!(
            tokens("link blood_oath(edmond -- haydee)"),
            vec![
                Token::Link,
                Token::Ident("blood_oath".to_string()),
                Token::LParen,
                Token::Ident("edmond".to_string()),
                Token::Undirected,
                Token::Ident("haydee".to_string()),
                Token::RParen,
            ]
        );
    }

    #[test]
    fn lex_produces_no_errors_for_valid_snippet() {
        let src = r#"
metadata title: "Wuthering Heights"
metadata media: book

set block: chapter

init:
    actor heathcliff: "Heathcliff"
    link ally(heathcliff -- catherine)

new chapter:
new chapter: "Chapter 3"
    deceased heathcliff
"#;
        let (_toks, errs) = lex(src);
        assert!(errs.is_empty(), "unexpected errors: {errs:?}");
    }
}
