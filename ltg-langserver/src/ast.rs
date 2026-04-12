/// Source span — byte-offset range from the original input.
pub type Span = std::ops::Range<usize>;

/// A node paired with its source location.  Using a tuple alias matches chumsky's
/// natural `map_with_span` output, so no conversion is needed in the parser.
/// Access as `spanned.0` (node) and `spanned.1` (span).
pub type Spanned<T> = (T, Span);

// ── Metadata ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Book,
    Show,
    Film,
}

/// A single `metadata <key>: <value>` directive.
#[derive(Debug, Clone, PartialEq)]
pub struct MetadataDirective {
    pub key: String,
    pub value: MetadataValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MetadataValue {
    Str(String),
    Media(MediaType),
}

// ── Structural declarations ───────────────────────────────────────────────────

/// `set block: chapter` or `set block: story_arc = "Story Arc"`
#[derive(Debug, Clone, PartialEq)]
pub struct BlockTypeDecl {
    pub type_name: String,
    pub display_label: Option<String>,
}

impl BlockTypeDecl {
    /// Resolved `unitLabel`: explicit display override, or the type_name title-cased
    /// with underscores replaced by spaces (`story_arc` → `"Story Arc"`).
    pub fn unit_label(&self) -> String {
        self.display_label.clone().unwrap_or_else(|| {
            self.type_name
                .split('_')
                .map(|w| {
                    let mut chars = w.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
    }
}

/// `set group: season`
#[derive(Debug, Clone, PartialEq)]
pub struct GroupTypeDecl {
    pub type_name: String,
}

/// `set colour: married = "#f472b6"`
#[derive(Debug, Clone, PartialEq)]
pub struct ColourOverride {
    pub label: String,
    pub hex: String,
}

// ── Statements ────────────────────────────────────────────────────────────────

/// `actor heathcliff: "Heathcliff"`
#[derive(Debug, Clone, PartialEq)]
pub struct ActorDecl {
    pub identifier: String,
    pub display_name: String,
}

/// `link ally(a -- b)` or `link father(earnshaw -> hindley)`
#[derive(Debug, Clone, PartialEq)]
pub struct LinkStmt {
    pub label: String,
    pub from: String,
    pub to: String,
    pub directed: bool,
}

/// `unlink romantic heathcliff catherine`
#[derive(Debug, Clone, PartialEq)]
pub struct UnlinkStmt {
    pub label: String,
    pub a: String,
    pub b: String,
}

/// `deceased earnshaw`
#[derive(Debug, Clone, PartialEq)]
pub struct DeceasedStmt {
    pub actor: String,
}

/// `rename catherine: "Catherine Linton"`
#[derive(Debug, Clone, PartialEq)]
pub struct RenameStmt {
    pub actor: String,
    pub new_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    Actor(ActorDecl),
    Link(LinkStmt),
    Unlink(UnlinkStmt),
    Deceased(DeceasedStmt),
    Rename(RenameStmt),
}

// ── Blocks ────────────────────────────────────────────────────────────────────

/// The `init:` block. Always block index 1.
#[derive(Debug, Clone, PartialEq)]
pub struct InitBlock {
    pub statements: Vec<Spanned<Statement>>,
}

/// A `new <type>:` or `new <type>: "<label>"` block.
/// Empty `statements` = valid empty block (graph unchanged).
#[derive(Debug, Clone, PartialEq)]
pub struct EventBlock {
    /// The block type identifier (e.g. `"chapter"`, `"episode"`).
    pub block_type: String,
    /// The optional display label (e.g. `"The Storm"`).
    pub label: Option<String>,
    pub statements: Vec<Spanned<Statement>>,
}

/// A `group:` or `group "<label>":` container holding `EventBlock`s.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupBlock {
    pub label: Option<String>,
    pub blocks: Vec<Spanned<EventBlock>>,
}

// ── Top-level program ─────────────────────────────────────────────────────────

/// Everything that can appear at the top level of an LTG file, in order.
/// The checker validates completeness and ordering — the parser is permissive.
#[derive(Debug, Clone, PartialEq)]
pub enum TopLevelDecl {
    Metadata(MetadataDirective),
    SetBlock(BlockTypeDecl),
    SetGroup(GroupTypeDecl),
    SetColour(ColourOverride),
    Init(InitBlock),
    NewBlock(EventBlock),
    Group(GroupBlock),
}

/// The raw parsed program — a flat ordered list of top-level declarations.
#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub items: Vec<Spanned<TopLevelDecl>>,
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_type_decl_unit_label_simple() {
        let decl = BlockTypeDecl {
            type_name: "chapter".to_string(),
            display_label: None,
        };
        assert_eq!(decl.unit_label(), "Chapter");
    }

    #[test]
    fn block_type_decl_unit_label_underscore() {
        let decl = BlockTypeDecl {
            type_name: "story_arc".to_string(),
            display_label: None,
        };
        assert_eq!(decl.unit_label(), "Story Arc");
    }

    #[test]
    fn block_type_decl_unit_label_multi_word() {
        let decl = BlockTypeDecl {
            type_name: "book_part".to_string(),
            display_label: None,
        };
        assert_eq!(decl.unit_label(), "Book Part");
    }

    #[test]
    fn block_type_decl_unit_label_explicit_override() {
        let decl = BlockTypeDecl {
            type_name: "story_arc".to_string(),
            display_label: Some("Story Arc".to_string()),
        };
        assert_eq!(decl.unit_label(), "Story Arc");
    }

    #[test]
    fn block_type_decl_unit_label_override_beats_auto() {
        let decl = BlockTypeDecl {
            type_name: "chapter".to_string(),
            display_label: Some("Book Part".to_string()),
        };
        assert_eq!(decl.unit_label(), "Book Part");
    }
}
