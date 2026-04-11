use chumsky::prelude::*;
use chumsky::Stream;

use crate::ast::*;
use crate::lexer::{Spanned, Token};

// ── Error type ────────────────────────────────────────────────────────────────

pub type ParseError = Simple<Token>;

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Match exactly one specific token, discarding it.
fn just_tok(tok: Token) -> impl Parser<Token, (), Error = Simple<Token>> + Clone {
    just(tok).ignored()
}

/// Match any `Ident` token and return its string value.
fn ident() -> impl Parser<Token, String, Error = Simple<Token>> + Clone {
    filter_map(|span, tok| match tok {
        Token::Ident(s) => Ok(s),
        other => Err(Simple::expected_input_found(span, None, Some(other))),
    })
}

/// Match any `StringLit` token and return its (unquoted) string value.
fn string_lit() -> impl Parser<Token, String, Error = Simple<Token>> + Clone {
    filter_map(|span, tok| match tok {
        Token::StringLit(s) => Ok(s),
        other => Err(Simple::expected_input_found(span, None, Some(other))),
    })
}

/// Parse a statement body: the INDENT … DEDENT region inside a block.
/// Returns an empty Vec when the block has no body (no INDENT follows).
fn block_body() -> impl Parser<Token, Vec<Spanned<Statement>>, Error = Simple<Token>> + Clone {
    just_tok(Token::Indent)
        .ignore_then(statement().map_with_span(|s, span| (s, span)).repeated())
        .then_ignore(just_tok(Token::Dedent))
        .or(empty().map(|_| vec![]))
}

// ── Statement parsers ─────────────────────────────────────────────────────────

/// `actor <ident>: "<display name>"`
fn actor_decl() -> impl Parser<Token, Statement, Error = Simple<Token>> + Clone {
    just_tok(Token::Actor)
        .ignore_then(ident())
        .then_ignore(just_tok(Token::Colon))
        .then(string_lit())
        .map(|(identifier, display_name)| {
            Statement::Actor(ActorDecl { identifier, display_name })
        })
}

/// `link <label>(<a> -- <b>)` or `link <label>(<from> -> <to>)`
fn link_stmt() -> impl Parser<Token, Statement, Error = Simple<Token>> + Clone {
    let undirected = ident()
        .then_ignore(just_tok(Token::Undirected))
        .then(ident())
        .map(|(a, b)| (a, b, false));

    let directed = ident()
        .then_ignore(just_tok(Token::Arrow))
        .then(ident())
        .map(|(from, to)| (from, to, true));

    just_tok(Token::Link)
        .ignore_then(ident()) // label
        .then_ignore(just_tok(Token::LParen))
        .then(undirected.or(directed))
        .then_ignore(just_tok(Token::RParen))
        .map(|(label, (from, to, directed))| {
            Statement::Link(LinkStmt { label, from, to, directed })
        })
}

/// `unlink <label> <a> <b>`
fn unlink_stmt() -> impl Parser<Token, Statement, Error = Simple<Token>> + Clone {
    just_tok(Token::Unlink)
        .ignore_then(ident()) // label
        .then(ident())        // a
        .then(ident())        // b
        .map(|((label, a), b)| Statement::Unlink(UnlinkStmt { label, a, b }))
}

/// `deceased <ident>`
fn deceased_stmt() -> impl Parser<Token, Statement, Error = Simple<Token>> + Clone {
    just_tok(Token::Deceased)
        .ignore_then(ident())
        .map(|actor| Statement::Deceased(DeceasedStmt { actor }))
}

/// `rename <ident>: "<new display name>"`
fn rename_stmt() -> impl Parser<Token, Statement, Error = Simple<Token>> + Clone {
    just_tok(Token::Rename)
        .ignore_then(ident())
        .then_ignore(just_tok(Token::Colon))
        .then(string_lit())
        .map(|(actor, new_name)| Statement::Rename(RenameStmt { actor, new_name }))
}

/// Any of the five statement types.
fn statement() -> impl Parser<Token, Statement, Error = Simple<Token>> + Clone {
    choice((
        actor_decl(),
        link_stmt(),
        unlink_stmt(),
        deceased_stmt(),
        rename_stmt(),
    ))
}

// ── Directive parsers ─────────────────────────────────────────────────────────

/// `metadata <key>: <value>`
///
/// The key is always an identifier. The value is either a string literal
/// (`title`, `author`) or an identifier (`media`).
fn metadata_directive() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    let value = string_lit()
        .map(MetadataValue::Str)
        .or(ident().map(|s: String| {
            match s.as_str() {
                "book" => MetadataValue::Media(MediaType::Book),
                "show" => MetadataValue::Media(MediaType::Show),
                "film" => MetadataValue::Media(MediaType::Film),
                _ => MetadataValue::Str(s),
            }
        }));

    just_tok(Token::Metadata)
        .ignore_then(ident()) // key
        .then_ignore(just_tok(Token::Colon))
        .then(value)
        .map(|(key, value)| TopLevelDecl::Metadata(MetadataDirective { key, value }))
}

/// `set block: <type>` or `set block: <type> = "<display>"`
fn set_block() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    let display = just_tok(Token::Equals).ignore_then(string_lit()).or_not();

    just_tok(Token::Set)
        .ignore_then(just(Token::Ident("block".to_string())).ignored())
        .ignore_then(just_tok(Token::Colon))
        .ignore_then(ident()) // type_name
        .then(display)
        .map(|(type_name, display_label)| {
            TopLevelDecl::SetBlock(BlockTypeDecl { type_name, display_label })
        })
}

/// `set group: <type>`  (the keyword `group` is a `Token::Group`)
fn set_group() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    just_tok(Token::Set)
        .ignore_then(just_tok(Token::Group))
        .ignore_then(just_tok(Token::Colon))
        .ignore_then(ident())
        .map(|type_name| TopLevelDecl::SetGroup(GroupTypeDecl { type_name }))
}

/// `set colour: <label> = "<hex>"`
fn set_colour() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    just_tok(Token::Set)
        .ignore_then(just(Token::Ident("colour".to_string())).ignored())
        .ignore_then(just_tok(Token::Colon))
        .ignore_then(ident()) // label
        .then_ignore(just_tok(Token::Equals))
        .then(string_lit()) // hex string (validation happens in the checker)
        .map(|(label, hex)| TopLevelDecl::SetColour(ColourOverride { label, hex }))
}

/// `init:` block with an optional indented body.
fn init_block() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    just_tok(Token::Init)
        .ignore_then(just_tok(Token::Colon))
        .ignore_then(block_body())
        .map(|statements| TopLevelDecl::Init(InitBlock { statements }))
}

/// `new <type>:` or `new <type>: "<label>"` with an optional indented body.
fn new_block() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    just_tok(Token::New)
        .ignore_then(ident())        // block_type
        .then_ignore(just_tok(Token::Colon))
        .then(string_lit().or_not()) // optional label
        .then(block_body())
        .map(|((block_type, label), statements)| {
            TopLevelDecl::NewBlock(EventBlock { block_type, label, statements })
        })
}

/// A `new <type>:` block that appears inside a group (same shape, different return type).
fn group_new_block() -> impl Parser<Token, Spanned<EventBlock>, Error = Simple<Token>> + Clone {
    just_tok(Token::New)
        .ignore_then(ident())
        .then_ignore(just_tok(Token::Colon))
        .then(string_lit().or_not())
        .then(block_body())
        .map_with_span(|((block_type, label), statements), span| {
            (EventBlock { block_type, label, statements }, span)
        })
}

/// `group:` or `group "<label>":` with an indented body of `new` blocks.
fn group_block() -> impl Parser<Token, TopLevelDecl, Error = Simple<Token>> + Clone {
    let blocks = just_tok(Token::Indent)
        .ignore_then(group_new_block().repeated().at_least(0))
        .then_ignore(just_tok(Token::Dedent))
        .or(empty().map(|_| vec![]));

    just_tok(Token::Group)
        .ignore_then(string_lit().or_not()) // optional label
        .then_ignore(just_tok(Token::Colon))
        .then(blocks)
        .map(|(label, blocks)| TopLevelDecl::Group(GroupBlock { label, blocks }))
}

// ── Top-level program parser ──────────────────────────────────────────────────

fn top_level_decl() -> impl Parser<Token, Spanned<TopLevelDecl>, Error = Simple<Token>> + Clone {
    choice((
        metadata_directive(),
        set_block(),
        set_group(),
        set_colour(),
        init_block(),
        new_block(),
        group_block(),
    ))
    .map_with_span(|t, span| (t, span))
}

/// Parse a full LTG program from a flat token stream.
pub fn program() -> impl Parser<Token, Program, Error = Simple<Token>> {
    top_level_decl()
        .repeated()
        .then_ignore(end())
        .map(|items| Program { items })
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Parse a token stream produced by `crate::lexer::lex` into a `Program`.
///
/// Returns `(Option<Program>, Vec<ParseError>)`. When parsing succeeds,
/// `Some(program)` is returned even in the presence of recoverable errors.
pub fn parse(tokens: Vec<Spanned<Token>>, src_len: usize) -> (Option<Program>, Vec<ParseError>) {
    let stream = Stream::from_iter(
        src_len..src_len + 1,
        tokens.into_iter().map(|(tok, span)| (tok, span)),
    );
    program().parse_recovery_verbose(stream)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::lex;

    /// Lex then parse `src`, asserting no lex or parse errors.
    /// Returns the resulting `Program`.
    fn parse_ok(src: &str) -> Program {
        let (tokens, lex_errors) = lex(src);
        assert!(lex_errors.is_empty(), "unexpected lex errors: {lex_errors:?}");
        let src_len = src.len();
        let (prog, parse_errors) = parse(tokens, src_len);
        assert!(parse_errors.is_empty(), "unexpected parse errors: {parse_errors:?}");
        prog.expect("parse returned None with no errors")
    }

    /// Lex then parse `src`, asserting at least one parse error.
    fn parse_fails(src: &str) {
        let (tokens, _lex_errors) = lex(src);
        let src_len = src.len();
        let (_, errors) = parse(tokens, src_len);
        assert!(!errors.is_empty(), "expected parse error but got none");
    }

    // Helper: extract the TopLevelDecl from an item (drops the span).
    fn decl(prog: &Program, idx: usize) -> &TopLevelDecl {
        &prog.items[idx].0
    }

    // ── Metadata ──────────────────────────────────────────────────────────

    #[test]
    fn parse_metadata_title() {
        let prog = parse_ok(r#"metadata title: "Wuthering Heights""#);
        assert_eq!(prog.items.len(), 1);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Metadata(MetadataDirective {
                key,
                value: MetadataValue::Str(v),
            }) if key == "title" && v == "Wuthering Heights"
        ));
    }

    #[test]
    fn parse_metadata_media_book() {
        let prog = parse_ok("metadata media: book");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Metadata(MetadataDirective {
                key,
                value: MetadataValue::Media(MediaType::Book),
            }) if key == "media"
        ));
    }

    #[test]
    fn parse_metadata_media_show() {
        let prog = parse_ok("metadata media: show");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Metadata(MetadataDirective {
                value: MetadataValue::Media(MediaType::Show),
                ..
            })
        ));
    }

    #[test]
    fn parse_metadata_media_film() {
        let prog = parse_ok("metadata media: film");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Metadata(MetadataDirective {
                value: MetadataValue::Media(MediaType::Film),
                ..
            })
        ));
    }

    #[test]
    fn parse_metadata_author() {
        let prog = parse_ok(r#"metadata author: "Emily Brontë""#);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Metadata(MetadataDirective { key, value: MetadataValue::Str(v) })
                if key == "author" && v == "Emily Brontë"
        ));
    }

    #[test]
    fn parse_multiple_metadata() {
        let src = "metadata title: \"WH\"\nmetadata media: book";
        let prog = parse_ok(src);
        assert_eq!(prog.items.len(), 2);
        assert!(matches!(decl(&prog, 0), TopLevelDecl::Metadata(_)));
        assert!(matches!(decl(&prog, 1), TopLevelDecl::Metadata(_)));
    }

    // ── Set directives ────────────────────────────────────────────────────

    #[test]
    fn parse_set_block_simple() {
        let prog = parse_ok("set block: chapter");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::SetBlock(BlockTypeDecl { type_name, display_label: None })
                if type_name == "chapter"
        ));
    }

    #[test]
    fn parse_set_block_with_display_label() {
        let prog = parse_ok(r#"set block: story_arc = "Story Arc""#);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::SetBlock(BlockTypeDecl {
                type_name,
                display_label: Some(label),
            }) if type_name == "story_arc" && label == "Story Arc"
        ));
    }

    #[test]
    fn parse_set_group() {
        let prog = parse_ok("set group: season");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::SetGroup(GroupTypeDecl { type_name }) if type_name == "season"
        ));
    }

    #[test]
    fn parse_set_colour() {
        // r##"..."## used because the hex string contains `"#` which would close r#"..."#.
        let prog = parse_ok(r##"set colour: married = "#f472b6""##);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::SetColour(ColourOverride { label, hex })
                if label == "married" && hex == "#f472b6"
        ));
    }

    // ── Init block ────────────────────────────────────────────────────────

    #[test]
    fn parse_empty_init_block() {
        let prog = parse_ok("init:");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Init(InitBlock { statements }) if statements.is_empty()
        ));
    }

    #[test]
    fn parse_init_with_actor() {
        let src = "init:\n    actor heathcliff: \"Heathcliff\"";
        let prog = parse_ok(src);
        let TopLevelDecl::Init(init) = decl(&prog, 0) else { panic!("expected init") };
        assert_eq!(init.statements.len(), 1);
        assert!(matches!(
            &init.statements[0].0,
            Statement::Actor(ActorDecl { identifier, display_name })
                if identifier == "heathcliff" && display_name == "Heathcliff"
        ));
    }

    #[test]
    fn parse_init_with_multiple_actors() {
        let src = "init:\n    actor a: \"A\"\n    actor b: \"B\"";
        let prog = parse_ok(src);
        let TopLevelDecl::Init(init) = decl(&prog, 0) else { panic!() };
        assert_eq!(init.statements.len(), 2);
    }

    #[test]
    fn parse_init_with_undirected_link() {
        let src = "init:\n    link ally(a -- b)";
        let prog = parse_ok(src);
        let TopLevelDecl::Init(init) = decl(&prog, 0) else { panic!() };
        assert!(matches!(
            &init.statements[0].0,
            Statement::Link(LinkStmt { label, from, to, directed: false })
                if label == "ally" && from == "a" && to == "b"
        ));
    }

    #[test]
    fn parse_init_with_directed_link() {
        let src = "init:\n    link father(earnshaw -> hindley)";
        let prog = parse_ok(src);
        let TopLevelDecl::Init(init) = decl(&prog, 0) else { panic!() };
        assert!(matches!(
            &init.statements[0].0,
            Statement::Link(LinkStmt { label, from, to, directed: true })
                if label == "father" && from == "earnshaw" && to == "hindley"
        ));
    }

    #[test]
    fn parse_init_with_mixed_statements() {
        let src = "init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)";
        let prog = parse_ok(src);
        let TopLevelDecl::Init(init) = decl(&prog, 0) else { panic!() };
        assert_eq!(init.statements.len(), 3);
        assert!(matches!(&init.statements[0].0, Statement::Actor(_)));
        assert!(matches!(&init.statements[1].0, Statement::Actor(_)));
        assert!(matches!(&init.statements[2].0, Statement::Link(_)));
    }

    // ── New block ─────────────────────────────────────────────────────────

    #[test]
    fn parse_empty_new_block() {
        let prog = parse_ok("new chapter:");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::NewBlock(EventBlock { block_type, label: None, statements })
                if block_type == "chapter" && statements.is_empty()
        ));
    }

    #[test]
    fn parse_new_block_with_label() {
        let prog = parse_ok(r#"new chapter: "The Storm""#);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::NewBlock(EventBlock { label: Some(l), .. })
                if l == "The Storm"
        ));
    }

    #[test]
    fn parse_new_block_with_statements() {
        let src = "new chapter:\n    deceased earnshaw\n    link enemy(hindley -> heathcliff)";
        let prog = parse_ok(src);
        let TopLevelDecl::NewBlock(blk) = decl(&prog, 0) else { panic!() };
        assert_eq!(blk.statements.len(), 2);
        assert!(matches!(&blk.statements[0].0, Statement::Deceased(_)));
        assert!(matches!(&blk.statements[1].0, Statement::Link(_)));
    }

    #[test]
    fn parse_new_block_with_actor_introduced_here() {
        let src = "new chapter:\n    actor linton: \"Edgar Linton\"";
        let prog = parse_ok(src);
        let TopLevelDecl::NewBlock(blk) = decl(&prog, 0) else { panic!() };
        assert_eq!(blk.statements.len(), 1);
        assert!(matches!(&blk.statements[0].0, Statement::Actor(_)));
    }

    #[test]
    fn parse_multiple_empty_new_blocks() {
        let src = "new chapter:\nnew chapter:\nnew chapter:";
        let prog = parse_ok(src);
        assert_eq!(prog.items.len(), 3);
        for item in &prog.items {
            assert!(matches!(&item.0, TopLevelDecl::NewBlock(b) if b.statements.is_empty()));
        }
    }

    // ── Statements ────────────────────────────────────────────────────────

    #[test]
    fn parse_unlink_statement() {
        let src = "new chapter:\n    unlink romantic heathcliff catherine";
        let prog = parse_ok(src);
        let TopLevelDecl::NewBlock(blk) = decl(&prog, 0) else { panic!() };
        assert!(matches!(
            &blk.statements[0].0,
            Statement::Unlink(UnlinkStmt { label, a, b })
                if label == "romantic" && a == "heathcliff" && b == "catherine"
        ));
    }

    #[test]
    fn parse_rename_statement() {
        let src = "new chapter:\n    rename catherine: \"Catherine Linton\"";
        let prog = parse_ok(src);
        let TopLevelDecl::NewBlock(blk) = decl(&prog, 0) else { panic!() };
        assert!(matches!(
            &blk.statements[0].0,
            Statement::Rename(RenameStmt { actor, new_name })
                if actor == "catherine" && new_name == "Catherine Linton"
        ));
    }

    #[test]
    fn parse_deceased_statement() {
        let src = "new chapter:\n    deceased earnshaw";
        let prog = parse_ok(src);
        let TopLevelDecl::NewBlock(blk) = decl(&prog, 0) else { panic!() };
        assert!(matches!(
            &blk.statements[0].0,
            Statement::Deceased(DeceasedStmt { actor }) if actor == "earnshaw"
        ));
    }

    // ── Group block ───────────────────────────────────────────────────────

    #[test]
    fn parse_named_group() {
        let src = "group \"Season 1\":\n    new episode:";
        let prog = parse_ok(src);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Group(GroupBlock { label: Some(l), .. }) if l == "Season 1"
        ));
    }

    #[test]
    fn parse_unnamed_group() {
        let src = "group:\n    new chapter:";
        let prog = parse_ok(src);
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Group(GroupBlock { label: None, .. })
        ));
    }

    #[test]
    fn parse_empty_group() {
        let prog = parse_ok("group:");
        assert!(matches!(
            decl(&prog, 0),
            TopLevelDecl::Group(GroupBlock { blocks, .. }) if blocks.is_empty()
        ));
    }

    #[test]
    fn parse_group_with_multiple_new_blocks() {
        let src = "group \"S1\":\n    new episode:\n    new episode:\n    new episode:";
        let prog = parse_ok(src);
        let TopLevelDecl::Group(grp) = decl(&prog, 0) else { panic!() };
        assert_eq!(grp.blocks.len(), 3);
    }

    #[test]
    fn parse_group_block_with_statements() {
        let src = "group \"S1\":\n    new episode:\n        actor watson: \"Dr. Watson\"";
        let prog = parse_ok(src);
        let TopLevelDecl::Group(grp) = decl(&prog, 0) else { panic!() };
        assert_eq!(grp.blocks.len(), 1);
        assert_eq!(grp.blocks[0].0.statements.len(), 1);
        assert!(matches!(&grp.blocks[0].0.statements[0].0, Statement::Actor(_)));
    }

    // ── Span tracking ─────────────────────────────────────────────────────

    #[test]
    fn items_carry_non_empty_spans() {
        let src = "metadata title: \"WH\"\nmetadata media: book";
        let prog = parse_ok(src);
        for item in &prog.items {
            assert!(!item.1.is_empty(), "item span should not be empty");
        }
    }

    #[test]
    fn statement_spans_are_tracked() {
        let src = "init:\n    actor a: \"A\"";
        let prog = parse_ok(src);
        let TopLevelDecl::Init(init) = decl(&prog, 0) else { panic!() };
        assert!(!init.statements[0].1.is_empty(), "statement span should not be empty");
    }

    // ── Full program ──────────────────────────────────────────────────────

    #[test]
    fn parse_minimal_valid_program() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit:";
        let prog = parse_ok(src);
        assert_eq!(prog.items.len(), 4);
    }

    #[test]
    fn parse_full_wuthering_heights_snippet() {
        // r##"..."## used because the hex colours contain `"#` which closes r#"..."#.
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

new chapter: "Chapter 3"
    link married(hindley -- frances)
    link rival(hindley -> heathcliff)

new chapter: "Chapter 9"
    deceased earnshaw

new chapter: "Chapter 14"
    rename catherine: "Catherine Linton"
    link married(catherine -- linton)
    unlink romantic heathcliff catherine
"##;
        let prog = parse_ok(src);
        // 3 metadata + 1 set block + 2 set colour + 1 init + 4 new blocks = 11
        assert_eq!(prog.items.len(), 11);
    }

    #[test]
    fn parse_grouped_show_snippet() {
        let src = r#"metadata title: "Sherlock"
metadata media: show

set block: episode
set group: season

init:
    actor holmes: "Sherlock Holmes"
    actor watson: "Dr. Watson"
    link ally(holmes -- watson)

group "Season 1":
    new episode: "A Study in Pink"
        actor lestrade: "Inspector Lestrade"
        link ally(holmes -- lestrade)
    new episode:
    new episode: "The Great Game"
        actor moriarty: "Jim Moriarty"
        link enemy(moriarty -> holmes)

group "Season 2":
    new episode:
"#;
        let prog = parse_ok(src);
        // 2 metadata + 1 set block + 1 set group + 1 init + 2 groups = 7
        assert_eq!(prog.items.len(), 7);

        let TopLevelDecl::Group(s1) = decl(&prog, 5) else { panic!("expected group") };
        assert_eq!(s1.label, Some("Season 1".to_string()));
        assert_eq!(s1.blocks.len(), 3);
        assert_eq!(s1.blocks[0].0.statements.len(), 2); // actor + link
    }

    // ── Error cases ───────────────────────────────────────────────────────

    #[test]
    fn parse_error_missing_colon_after_init() {
        parse_fails("init");
    }

    #[test]
    fn parse_error_actor_missing_display_name() {
        parse_fails("init:\n    actor heathcliff");
    }

    #[test]
    fn parse_error_link_missing_parens() {
        parse_fails("init:\n    link ally a -- b");
    }

    #[test]
    fn parse_error_link_missing_edge_operator() {
        parse_fails("init:\n    link ally(a b)");
    }

    #[test]
    fn parse_error_unlink_missing_second_actor() {
        parse_fails("new chapter:\n    unlink romantic heathcliff");
    }

    #[test]
    fn parse_error_rename_missing_colon() {
        parse_fails("new chapter:\n    rename catherine \"New Name\"");
    }
}
