use std::collections::{HashMap, HashSet};

use crate::ast::*;

// ── Compiled output types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledSeries {
    pub title:       String,
    pub media_type:  MediaType,
    /// Resolved from `BlockTypeDecl::unit_label()`: explicit override or auto-derived.
    pub unit_label:  String,
    /// Total block count — `init:` (block 1) plus every `new <type>:` block.
    pub total_units: usize,
    pub author:      Option<String>,
    /// From `set group: <type>`, if present.
    pub group_type:  Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledRename {
    /// The new display name.
    pub name:          String,
    /// Block index where the rename takes effect (≥ 2 — never valid in `init:`).
    pub introduced_at: usize,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledCharacter {
    /// The unquoted LTG identifier (e.g. `heathcliff`). Stable across renames.
    pub identifier:    String,
    /// Display name at declaration time (from the `actor` statement). Never mutated.
    pub name:          String,
    /// All names the character has been known by via `rename` — added so that
    /// search can find the character by any of their names.  The initial `name`
    /// is not repeated here (it is already in `name`).
    pub aliases:       Vec<String>,
    /// Chronological list of name changes.  The effective name at block `i` is the
    /// `name` of the last entry whose `introduced_at` ≤ `i`, or `self.name` if none.
    pub renames:       Vec<CompiledRename>,
    pub introduced_at: usize,
    pub died_at:       Option<usize>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledRelationship {
    pub from_identifier: String,
    pub to_identifier:   String,
    pub label:           String,
    pub directed:        bool,
    pub introduced_at:   usize,
    /// `Some(n)` when ended by an `unlink` in block `n + 1` (i.e. active through block `n`).
    pub ended_at:        Option<usize>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledBlock {
    /// 1-based sequential index across the whole file (group boundaries are transparent).
    pub index:       usize,
    /// Optional display label from `new <type>: "<label>"`.
    pub label:       Option<String>,
    /// Label of the enclosing `group` block, or `None` for top-level blocks.
    pub group_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledGraph {
    pub series:        CompiledSeries,
    /// Characters in declaration order (init: actors first, then introduced in each block).
    pub characters:    Vec<CompiledCharacter>,
    /// One entry per `link` invocation; relinks produce a second entry with a new temporal window.
    pub relationships: Vec<CompiledRelationship>,
    /// `label → hex` — hash defaults for every link label seen, overridden by `set colour:`.
    pub colours:       HashMap<String, String>,
    /// One entry per block including `init:` (index 1).  Empty blocks are included.
    pub blocks:        Vec<CompiledBlock>,
}

// ── Colour palette ────────────────────────────────────────────────────────────

/// Curated palette for dark-background viewers; drawn from Tailwind CSS 400-level colours.
/// 12 entries chosen for visual distinctness and legibility.
const PALETTE: &[&str] = &[
    "#f87171", // red-400
    "#fb923c", // orange-400
    "#fbbf24", // amber-400
    "#a3e635", // lime-400
    "#34d399", // emerald-400
    "#22d3ee", // cyan-400
    "#60a5fa", // blue-400
    "#818cf8", // indigo-400
    "#a78bfa", // violet-400
    "#f472b6", // pink-400
    "#e879f9", // fuchsia-400
    "#94a3b8", // slate-400
];

/// FNV-1a hash of `label` → a colour from `PALETTE`.
/// Deterministic: same label always produces the same colour across files and sessions.
fn hash_colour(label: &str) -> String {
    let mut h: u32 = 2_166_136_261;
    for b in label.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16_777_619);
    }
    PALETTE[h as usize % PALETTE.len()].to_string()
}

// ── Internal compilation state ────────────────────────────────────────────────

struct State {
    /// identifier → index in `characters` vec.
    char_idx: HashMap<String, usize>,
    characters: Vec<CompiledCharacter>,

    /// Canonical key `(label, min(a,b), max(a,b))` → index of the *active* relationship in `relationships`.
    /// Removed on `unlink`; re-inserted on a subsequent `link` with the same label.
    active_rel_idx: HashMap<(String, String, String), usize>,
    relationships: Vec<CompiledRelationship>,

    /// Every label that appeared in any `link` statement — used to seed the colour map.
    link_labels: HashSet<String>,
}

impl State {
    fn new() -> Self {
        Self {
            char_idx: HashMap::new(),
            characters: Vec::new(),
            active_rel_idx: HashMap::new(),
            relationships: Vec::new(),
            link_labels: HashSet::new(),
        }
    }
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Convert a semantically-validated `Program` into a `CompiledGraph`.
///
/// **Precondition:** `crate::checker::check(program)` returned no errors.
/// Calling this on an invalid program may produce incorrect output.
pub fn compile(program: &Program) -> CompiledGraph {
    // ── Pass 1: structural metadata ───────────────────────────────────────────
    let mut title = String::new();
    let mut media_type = MediaType::Book;
    let mut author: Option<String> = None;
    let mut unit_label = String::new();
    let mut group_type: Option<String> = None;
    let mut colour_overrides: HashMap<String, String> = HashMap::new();

    for (decl, _) in &program.items {
        match decl {
            TopLevelDecl::Metadata(dir) => match dir.key.as_str() {
                "title"  => if let MetadataValue::Str(s)   = &dir.value { title  = s.clone(); }
                "media"  => if let MetadataValue::Media(m) = &dir.value { media_type = m.clone(); }
                "author" => if let MetadataValue::Str(s)   = &dir.value { author = Some(s.clone()); }
                _        => {}
            },
            TopLevelDecl::SetBlock(decl)  => unit_label = decl.unit_label(),
            TopLevelDecl::SetGroup(decl)  => group_type = Some(decl.type_name.clone()),
            TopLevelDecl::SetColour(col)  => {
                colour_overrides.insert(col.label.clone(), col.hex.clone());
            }
            _ => {}
        }
    }

    // ── Pass 2: walk blocks in declaration order ───────────────────────────────
    let mut state = State::new();
    let mut block_counter: usize = 0;
    let mut blocks: Vec<CompiledBlock> = Vec::new();

    for (decl, _) in &program.items {
        match decl {
            TopLevelDecl::Init(init_block) => {
                block_counter += 1;
                blocks.push(CompiledBlock { index: block_counter, label: None, group_label: None });
                for (stmt, _) in &init_block.statements {
                    process_statement(stmt, block_counter, &mut state);
                }
            }

            TopLevelDecl::NewBlock(event_block) => {
                block_counter += 1;
                blocks.push(CompiledBlock {
                    index:       block_counter,
                    label:       event_block.label.clone(),
                    group_label: None,
                });
                for (stmt, _) in &event_block.statements {
                    process_statement(stmt, block_counter, &mut state);
                }
            }

            TopLevelDecl::Group(group_block) => {
                // Groups are purely organisational — block numbering is continuous.
                let group_label = group_block.label.clone();
                for (event_block, _) in &group_block.blocks {
                    block_counter += 1;
                    blocks.push(CompiledBlock {
                        index:       block_counter,
                        label:       event_block.label.clone(),
                        group_label: group_label.clone(),
                    });
                    for (stmt, _) in &event_block.statements {
                        process_statement(stmt, block_counter, &mut state);
                    }
                }
            }

            _ => {} // Metadata / set directives already handled above.
        }
    }

    let total_units = block_counter;

    // ── Build colour map ───────────────────────────────────────────────────────
    // Seed with hash defaults for every label seen in a `link` statement, then
    // let `set colour:` overrides win unconditionally.
    let mut colours: HashMap<String, String> = state
        .link_labels
        .iter()
        .map(|label| (label.clone(), hash_colour(label)))
        .collect();
    for (label, hex) in colour_overrides {
        colours.insert(label, hex);
    }

    CompiledGraph {
        series: CompiledSeries { title, media_type, unit_label, total_units, author, group_type },
        characters:    state.characters,
        relationships: state.relationships,
        colours,
        blocks,
    }
}

// ── Statement processor ───────────────────────────────────────────────────────

fn process_statement(stmt: &Statement, block_index: usize, state: &mut State) {
    match stmt {
        Statement::Actor(decl) => {
            let idx = state.characters.len();
            state.char_idx.insert(decl.identifier.clone(), idx);
            state.characters.push(CompiledCharacter {
                identifier:    decl.identifier.clone(),
                name:          decl.display_name.clone(),
                aliases:       Vec::new(),
                renames:       Vec::new(),
                introduced_at: block_index,
                died_at:       None,
            });
        }

        Statement::Link(link) => {
            state.link_labels.insert(link.label.clone());
            let key = rel_key(&link.label, &link.from, &link.to);
            let idx = state.relationships.len();
            state.active_rel_idx.insert(key, idx);
            state.relationships.push(CompiledRelationship {
                from_identifier: link.from.clone(),
                to_identifier:   link.to.clone(),
                label:           link.label.clone(),
                directed:        link.directed,
                introduced_at:   block_index,
                ended_at:        None,
            });
        }

        Statement::Unlink(unlink) => {
            let key = rel_key(&unlink.label, &unlink.a, &unlink.b);
            if let Some(idx) = state.active_rel_idx.remove(&key) {
                // Relationship was active through the block before this one.
                state.relationships[idx].ended_at = Some(block_index - 1);
            }
        }

        Statement::Deceased(dec) => {
            if let Some(&idx) = state.char_idx.get(&dec.actor) {
                state.characters[idx].died_at = Some(block_index);
            }
        }

        Statement::Rename(rename) => {
            if let Some(&idx) = state.char_idx.get(&rename.actor) {
                // The new name is added to aliases so the character is searchable by it.
                // The original `name` field (the initial display name) never changes.
                state.characters[idx].aliases.push(rename.new_name.clone());
                state.characters[idx].renames.push(CompiledRename {
                    name:          rename.new_name.clone(),
                    introduced_at: block_index,
                });
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Canonical relationship key — direction is ignored (matches checker and `unlink` semantics).
fn rel_key(label: &str, a: &str, b: &str) -> (String, String, String) {
    let (ca, cb) = if a <= b { (a, b) } else { (b, a) };
    (label.to_string(), ca.to_string(), cb.to_string())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::lex;
    use crate::parser::parse;

    // ── Test helpers ──────────────────────────────────────────────────────

    fn compile_src(src: &str) -> CompiledGraph {
        let (tokens, lex_errs) = lex(src);
        assert!(lex_errs.is_empty(), "lex errors: {lex_errs:?}");
        let (prog, parse_errs) = parse(tokens, src.len());
        assert!(parse_errs.is_empty(), "parse errors: {parse_errs:?}");
        compile(&prog.unwrap())
    }

    /// Minimal valid header (title + media + block decl).
    const HEADER: &str = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\n";

    fn char_by_id<'a>(graph: &'a CompiledGraph, id: &str) -> &'a CompiledCharacter {
        graph.characters.iter().find(|c| c.identifier == id)
            .unwrap_or_else(|| panic!("character `{id}` not found"))
    }

    fn rel_by_label<'a>(graph: &'a CompiledGraph, label: &str) -> &'a CompiledRelationship {
        graph.relationships.iter().find(|r| r.label == label)
            .unwrap_or_else(|| panic!("relationship `{label}` not found"))
    }

    // ── Series ────────────────────────────────────────────────────────────

    #[test]
    fn compile_series_title_and_media_book() {
        let src = format!("{HEADER}init:");
        let g = compile_src(&src);
        assert_eq!(g.series.title, "T");
        assert_eq!(g.series.media_type, MediaType::Book);
    }

    #[test]
    fn compile_series_media_show() {
        let src = "metadata title: \"S\"\nmetadata media: show\nset block: episode\ninit:";
        let g = compile_src(src);
        assert_eq!(g.series.media_type, MediaType::Show);
    }

    #[test]
    fn compile_series_media_film() {
        let src = "metadata title: \"F\"\nmetadata media: film\nset block: part\ninit:";
        let g = compile_src(src);
        assert_eq!(g.series.media_type, MediaType::Film);
    }

    #[test]
    fn compile_series_unit_label_auto_derived() {
        // `chapter` → "Chapter"; `story_arc` → "Story Arc"
        let src = format!("{HEADER}init:");
        assert_eq!(compile_src(&src).series.unit_label, "Chapter");

        let src2 = "metadata title: \"T\"\nmetadata media: book\nset block: story_arc\ninit:";
        assert_eq!(compile_src(src2).series.unit_label, "Story Arc");
    }

    #[test]
    fn compile_series_unit_label_explicit() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: part = \"Book Part\"\ninit:";
        assert_eq!(compile_src(src).series.unit_label, "Book Part");
    }

    #[test]
    fn compile_series_total_units_init_only() {
        let src = format!("{HEADER}init:");
        assert_eq!(compile_src(&src).series.total_units, 1);
    }

    #[test]
    fn compile_series_total_units_with_new_blocks() {
        let src = format!("{HEADER}init:\nnew chapter:\nnew chapter:\nnew chapter:");
        assert_eq!(compile_src(&src).series.total_units, 4);
    }

    #[test]
    fn compile_series_total_units_counts_through_groups() {
        // Groups are organisational — blocks inside them still count sequentially.
        let src = format!(
            "{HEADER}init:\ngroup \"S1\":\n    new chapter:\n    new chapter:\ngroup \"S2\":\n    new chapter:"
        );
        assert_eq!(compile_src(&src).series.total_units, 4);
    }

    #[test]
    fn compile_series_author_optional() {
        let src = format!("{HEADER}init:");
        assert_eq!(compile_src(&src).series.author, None);

        let src2 = "metadata title: \"T\"\nmetadata media: book\nmetadata author: \"Emily Brontë\"\nset block: chapter\ninit:";
        assert_eq!(compile_src(src2).series.author, Some("Emily Brontë".to_string()));
    }

    #[test]
    fn compile_series_group_type_optional() {
        let src = format!("{HEADER}init:");
        assert_eq!(compile_src(&src).series.group_type, None);

        let src2 = format!("{HEADER}set group: season\ninit:");
        assert_eq!(compile_src(&src2).series.group_type, Some("season".to_string()));
    }

    // ── Blocks ────────────────────────────────────────────────────────────

    #[test]
    fn compile_init_is_block_1() {
        let src = format!("{HEADER}init:");
        let g = compile_src(&src);
        assert_eq!(g.blocks.len(), 1);
        assert_eq!(g.blocks[0], CompiledBlock { index: 1, label: None, group_label: None });
    }

    #[test]
    fn compile_blocks_sequential_numbering() {
        let src = format!("{HEADER}init:\nnew chapter:\nnew chapter: \"Chapter 3\"");
        let g = compile_src(&src);
        assert_eq!(g.blocks.len(), 3);
        assert_eq!(g.blocks[0].index, 1);
        assert_eq!(g.blocks[1].index, 2);
        assert_eq!(g.blocks[2].index, 3);
    }

    #[test]
    fn compile_block_label_preserved() {
        let src = format!("{HEADER}init:\nnew chapter:\nnew chapter: \"The Storm\"");
        let g = compile_src(&src);
        assert_eq!(g.blocks[1].label, None);
        assert_eq!(g.blocks[2].label, Some("The Storm".to_string()));
    }

    #[test]
    fn compile_blocks_sequential_through_groups() {
        let src = format!(
            "{HEADER}init:\ngroup \"S1\":\n    new chapter: \"Pilot\"\n    new chapter:\ngroup \"S2\":\n    new chapter: \"Finale\""
        );
        let g = compile_src(&src);
        // init + 3 new blocks = 4 total
        assert_eq!(g.blocks.len(), 4);
        assert_eq!(g.blocks[1].index, 2);
        assert_eq!(g.blocks[3].index, 4);
    }

    #[test]
    fn compile_block_group_label_set() {
        let src = format!(
            "{HEADER}init:\ngroup \"Season 1\":\n    new chapter:\n    new chapter:"
        );
        let g = compile_src(&src);
        assert_eq!(g.blocks[0].group_label, None); // init
        assert_eq!(g.blocks[1].group_label, Some("Season 1".to_string()));
        assert_eq!(g.blocks[2].group_label, Some("Season 1".to_string()));
    }

    #[test]
    fn compile_block_unnamed_group_has_none_group_label() {
        let src = format!("{HEADER}init:\ngroup:\n    new chapter:");
        let g = compile_src(&src);
        assert_eq!(g.blocks[1].group_label, None);
    }

    // ── Characters ───────────────────────────────────────────────────────

    #[test]
    fn compile_character_introduced_at_init() {
        let src = format!("{HEADER}init:\n    actor heathcliff: \"Heathcliff\"");
        let g = compile_src(&src);
        let c = char_by_id(&g, "heathcliff");
        assert_eq!(c.name, "Heathcliff");
        assert_eq!(c.introduced_at, 1);
        assert_eq!(c.died_at, None);
        assert!(c.aliases.is_empty());
        assert!(c.renames.is_empty());
    }

    #[test]
    fn compile_character_introduced_at_new_block() {
        let src = format!(
            "{HEADER}init:\nnew chapter:\nnew chapter:\n    actor linton: \"Edgar Linton\""
        );
        let g = compile_src(&src);
        assert_eq!(char_by_id(&g, "linton").introduced_at, 3);
    }

    #[test]
    fn compile_character_introduced_at_inside_group() {
        let src = format!(
            "{HEADER}init:\ngroup \"S1\":\n    new chapter:\n    new chapter:\n        actor lestrade: \"Inspector Lestrade\""
        );
        let g = compile_src(&src);
        assert_eq!(char_by_id(&g, "lestrade").introduced_at, 3);
    }

    #[test]
    fn compile_character_order_preserved() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    actor c: \"C\""
        );
        let g = compile_src(&src);
        assert_eq!(g.characters.len(), 3);
        assert_eq!(g.characters[0].identifier, "a");
        assert_eq!(g.characters[1].identifier, "b");
        assert_eq!(g.characters[2].identifier, "c");
    }

    #[test]
    fn compile_character_died_at() {
        let src = format!(
            "{HEADER}init:\n    actor earnshaw: \"Mr. Earnshaw\"\nnew chapter:\nnew chapter:\n    deceased earnshaw"
        );
        let g = compile_src(&src);
        assert_eq!(char_by_id(&g, "earnshaw").died_at, Some(3));
    }

    #[test]
    fn compile_character_rename_adds_alias_and_rename_entry() {
        let src = format!(
            "{HEADER}init:\n    actor catherine: \"Catherine Earnshaw\"\nnew chapter:\n    rename catherine: \"Catherine Linton\""
        );
        let g = compile_src(&src);
        let c = char_by_id(&g, "catherine");
        // Initial name never changes.
        assert_eq!(c.name, "Catherine Earnshaw");
        // New name is added to aliases for searchability.
        assert_eq!(c.aliases, vec!["Catherine Linton".to_string()]);
        // Rename record records the block index.
        assert_eq!(c.renames.len(), 1);
        assert_eq!(c.renames[0].name, "Catherine Linton");
        assert_eq!(c.renames[0].introduced_at, 2);
    }

    #[test]
    fn compile_character_multiple_renames() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"Name A\"\nnew chapter:\n    rename a: \"Name B\"\nnew chapter:\n    rename a: \"Name C\""
        );
        let g = compile_src(&src);
        let c = char_by_id(&g, "a");
        assert_eq!(c.name, "Name A");
        assert_eq!(c.aliases, vec!["Name B".to_string(), "Name C".to_string()]);
        assert_eq!(c.renames.len(), 2);
        assert_eq!(c.renames[0].introduced_at, 2);
        assert_eq!(c.renames[1].introduced_at, 3);
    }

    // ── Relationships ─────────────────────────────────────────────────────

    #[test]
    fn compile_relationship_undirected() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)"
        );
        let g = compile_src(&src);
        let r = rel_by_label(&g, "ally");
        assert_eq!(r.from_identifier, "a");
        assert_eq!(r.to_identifier, "b");
        assert!(!r.directed);
        assert_eq!(r.introduced_at, 1);
        assert_eq!(r.ended_at, None);
    }

    #[test]
    fn compile_relationship_directed() {
        let src = format!(
            "{HEADER}init:\n    actor earnshaw: \"Earnshaw\"\n    actor hindley: \"Hindley\"\n    link father(earnshaw -> hindley)"
        );
        let g = compile_src(&src);
        let r = rel_by_label(&g, "father");
        assert_eq!(r.from_identifier, "earnshaw");
        assert_eq!(r.to_identifier, "hindley");
        assert!(r.directed);
    }

    #[test]
    fn compile_relationship_ended_at_is_block_before_unlink() {
        // link at block 1, unlink at block 3 → ended_at = 2
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\nnew chapter:\nnew chapter:\n    unlink ally a b"
        );
        let g = compile_src(&src);
        let r = rel_by_label(&g, "ally");
        assert_eq!(r.introduced_at, 1);
        assert_eq!(r.ended_at, Some(2));
    }

    #[test]
    fn compile_relationship_relink_produces_two_entries() {
        // link(1) → unlink(2) → link(3): two separate CompiledRelationship rows.
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\nnew chapter:\n    unlink ally a b\nnew chapter:\n    link ally(a -- b)"
        );
        let g = compile_src(&src);
        let rels: Vec<_> = g.relationships.iter().filter(|r| r.label == "ally").collect();
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].introduced_at, 1);
        assert_eq!(rels[0].ended_at, Some(1));
        assert_eq!(rels[1].introduced_at, 3);
        assert_eq!(rels[1].ended_at, None);
    }

    #[test]
    fn compile_multiple_relationships_same_actors_different_labels() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)\n    link rival(a -- b)"
        );
        let g = compile_src(&src);
        assert_eq!(g.relationships.len(), 2);
    }

    // ── Colours ───────────────────────────────────────────────────────────

    #[test]
    fn compile_colours_hash_default_from_palette() {
        let src = format!(
            "{HEADER}init:\n    actor a: \"A\"\n    actor b: \"B\"\n    link ally(a -- b)"
        );
        let g = compile_src(&src);
        let colour = g.colours.get("ally").expect("ally should have a colour");
        // Hash default must be one of the palette entries.
        assert!(PALETTE.contains(&colour.as_str()), "unexpected colour `{colour}`");
    }

    #[test]
    fn compile_colours_hash_is_deterministic() {
        // Same label always maps to the same colour.
        assert_eq!(hash_colour("ally"), hash_colour("ally"));
        assert_eq!(hash_colour("enemy"), hash_colour("enemy"));
        // Different labels can differ (just assert they're both valid palette entries).
        assert!(PALETTE.contains(&hash_colour("ally").as_str()));
        assert!(PALETTE.contains(&hash_colour("enemy").as_str()));
    }

    #[test]
    fn compile_colours_override_beats_hash() {
        let src = format!(
            r##"{HEADER}set colour: ally = "#ffffff"
init:
    actor a: "A"
    actor b: "B"
    link ally(a -- b)"##
        );
        let g = compile_src(&src);
        assert_eq!(g.colours.get("ally").map(String::as_str), Some("#ffffff"));
    }

    #[test]
    fn compile_colours_only_seen_link_labels_get_defaults() {
        // `enemy` has an override but is never used in a link → still in the map (override wins).
        // `unused_override` appears only in set colour, never in a link.
        let src = format!(
            r##"{HEADER}set colour: ally = "#a78bfa"
init:
    actor a: "A"
    actor b: "B"
    link ally(a -- b)"##
        );
        let g = compile_src(&src);
        assert!(g.colours.contains_key("ally"));
        // Labels that were never linked and have no override are absent.
        assert!(!g.colours.contains_key("enemy"));
    }

    #[test]
    fn compile_colours_override_present_even_if_label_never_linked() {
        // A `set colour:` override for a label that never appears in a `link`
        // is still included in the output (checker warns, compiler includes).
        let src = format!(r##"{HEADER}set colour: never_used = "#ff0000"
init:"##);
        let g = compile_src(&src);
        assert_eq!(g.colours.get("never_used").map(String::as_str), Some("#ff0000"));
    }

    // ── Full program ──────────────────────────────────────────────────────

    #[test]
    fn compile_full_wuthering_heights_snippet() {
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
    link father(earnshaw -> catherine)
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
        let g = compile_src(src);

        // Series
        assert_eq!(g.series.title, "Wuthering Heights");
        assert_eq!(g.series.media_type, MediaType::Book);
        assert_eq!(g.series.unit_label, "Chapter");
        assert_eq!(g.series.total_units, 4); // init + 3 new
        assert_eq!(g.series.author, Some("Emily Brontë".to_string()));

        // Blocks
        assert_eq!(g.blocks.len(), 4);
        assert_eq!(g.blocks[0].index, 1);
        assert_eq!(g.blocks[2].label, Some("Chapter 9".to_string()));
        assert_eq!(g.blocks[3].label, Some("Chapter 14".to_string()));

        // Characters
        assert_eq!(char_by_id(&g, "earnshaw").introduced_at, 1);
        assert_eq!(char_by_id(&g, "earnshaw").died_at, Some(3));
        assert_eq!(char_by_id(&g, "linton").introduced_at, 4);

        let catherine = char_by_id(&g, "catherine");
        assert_eq!(catherine.name, "Catherine Earnshaw");
        assert_eq!(catherine.aliases, vec!["Catherine Linton".to_string()]);
        assert_eq!(catherine.renames[0].introduced_at, 4);

        // Relationships
        // Two father links, one sibling link, one married link = at least 4
        assert_eq!(g.relationships.len(), 4);
        let sibling = g.relationships.iter().find(|r| r.label == "sibling").unwrap();
        assert_eq!(sibling.ended_at, Some(3)); // unlinked at block 4 → ended_at = 3

        // Colours — overrides applied
        assert_eq!(g.colours.get("father").map(String::as_str), Some("#34d399"));
        assert_eq!(g.colours.get("sibling").map(String::as_str), Some("#60a5fa"));
        // `married` gets a hash default
        assert!(PALETTE.contains(&g.colours["married"].as_str()));
    }
}
