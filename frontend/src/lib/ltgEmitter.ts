import type { CompileSuccess } from './ltgLspClient'

// ---------------------------------------------------------------------------
// Raw shapes from CompileSuccess (matching openapi-langserver.yaml)
// ---------------------------------------------------------------------------

type RawSeries = {
  title:      string
  mediaType:  'book' | 'show' | 'film'
  unitLabel:  string
  totalUnits: number
  author:     string | null
  groupType:  string | null
}

type RawRename = {
  name:         string
  introducedAt: number
}

type RawCharacter = {
  identifier:   string
  name:         string
  aliases:      string[]
  renames:      RawRename[]
  introducedAt: number
  diedAt:       number | null
}

type RawRelationship = {
  fromIdentifier: string
  toIdentifier:   string
  label:          string
  directed:       boolean
  introducedAt:   number
  endedAt:        number | null
}

type RawBlock = {
  index:      number
  label:      string | null
  groupLabel: string | null
}

// ---------------------------------------------------------------------------
// LTG AST
//
// Two-phase approach: CompileSuccess → AST → string.
// The AST layer separates the diff-reconstruction logic from the text
// formatting logic, making each independently testable.
// ---------------------------------------------------------------------------

export type ActorNode    = { id: string; name: string }
export type LinkNode     = { label: string; from: string; to: string; directed: boolean }
export type UnlinkNode   = { label: string; a: string; b: string }
export type DeceasedNode = { id: string }
export type RenameNode   = { id: string; name: string }

export type BlockBodyNode = {
  actors:   ActorNode[]
  links:    LinkNode[]
  unlinks:  UnlinkNode[]
  deceased: DeceasedNode[]
  renames:  RenameNode[]
}

export type BlockNode = {
  kind:  'block'
  index: number
  label: string | null
  body:  BlockBodyNode
}

export type GroupNode = {
  kind:   'group'
  label:  string | null
  blocks: BlockNode[]
}

export type LtgAst = {
  series:  RawSeries
  colours: Record<string, string>
  init:    BlockBodyNode
  blocks:  (BlockNode | GroupNode)[]
}

// ---------------------------------------------------------------------------
// Phase 1 — CompileSuccess → LtgAst
//
// Core algorithm: temporal diff reconstruction.
// The compiled graph stores full history (state-based); LTG stores
// changes per block (event-sourced).  For each block N we ask:
// "what changed between N−1 and N?"
//
//   actors:   characters where introducedAt === N
//   links:    relationships where introducedAt === N
//   unlinks:  relationships where endedAt === N − 1
//             (unlink in block N sets endedAt = N − 1 per spec)
//   deceased: characters where diedAt === N
//   renames:  rename entries where introducedAt === N
// ---------------------------------------------------------------------------

export function compiledToAst(compiled: CompileSuccess): LtgAst {
  const series    = compiled.series        as RawSeries
  const chars     = compiled.characters    as RawCharacter[]
  const rels      = compiled.relationships as RawRelationship[]
  const rawBlocks = compiled.blocks        as RawBlock[]
  const colours   = compiled.colours

  function bodyForBlock(n: number, isInit: boolean): BlockBodyNode {
    const actors: ActorNode[] = chars
      .filter(c => c.introducedAt === n)
      .map(c => ({ id: c.identifier, name: c.name }))

    const links: LinkNode[] = rels
      .filter(r => r.introducedAt === n)
      .map(r => ({
        label:    r.label,
        from:     r.fromIdentifier,
        to:       r.toIdentifier,
        directed: r.directed,
      }))

    // unlink in block N sets endedAt = N − 1, so we find those relationships here.
    // Not valid in init (UnlinkInInit), so we skip for block 1.
    const unlinks: UnlinkNode[] = isInit ? [] : rels
      .filter(r => r.endedAt === n - 1)
      .map(r => ({ label: r.label, a: r.fromIdentifier, b: r.toIdentifier }))

    const deceased: DeceasedNode[] = isInit ? [] : chars
      .filter(c => c.diedAt === n)
      .map(c => ({ id: c.identifier }))

    // Flatten all characters' rename histories, keeping only renames at block N.
    const renames: RenameNode[] = isInit ? [] : chars.flatMap(c =>
      c.renames
        .filter(r => r.introducedAt === n)
        .map(r => ({ id: c.identifier, name: r.name })),
    )

    return { actors, links, unlinks, deceased, renames }
  }

  const init   = bodyForBlock(1, true)

  // Build a complete block list covering every index from 2 to totalUnits.
  // compiled.blocks may omit blocks that have no events; we synthesise
  // empty entries for those so every chapter gets a `new <type>:` header.
  const rawByIndex = new Map<number, RawBlock>()
  for (const b of rawBlocks) rawByIndex.set(b.index, b)

  const allRawBlocks: RawBlock[] = []
  for (let i = 2; i <= series.totalUnits; i++) {
    allRawBlocks.push(rawByIndex.get(i) ?? { index: i, label: null, groupLabel: null })
  }

  const blocks = buildBlocks(allRawBlocks, bodyForBlock)

  return { series, colours, init, blocks }
}

/** Group consecutive same-label blocks into GroupNodes. */
function buildBlocks(
  rawBlocks: RawBlock[],
  bodyForBlock: (n: number, isInit: boolean) => BlockBodyNode,
): (BlockNode | GroupNode)[] {
  const result: (BlockNode | GroupNode)[] = []
  let i = 0

  while (i < rawBlocks.length) {
    const raw = rawBlocks[i]!

    if (raw.groupLabel === null) {
      result.push({
        kind:  'block',
        index: raw.index,
        label: raw.label,
        body:  bodyForBlock(raw.index, false),
      })
      i++
    } else {
      const groupLabel = raw.groupLabel
      const groupBlocks: BlockNode[] = []

      while (i < rawBlocks.length && rawBlocks[i]!.groupLabel === groupLabel) {
        const b = rawBlocks[i]!
        groupBlocks.push({
          kind:  'block',
          index: b.index,
          label: b.label,
          body:  bodyForBlock(b.index, false),
        })
        i++
      }

      result.push({ kind: 'group', label: groupLabel, blocks: groupBlocks })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Phase 2 — LtgAst → string (pretty-printer)
//
// Indentation rules (from spec):
//   init: body                        →  4 spaces
//   new <type>: (standalone)          →  0 spaces, body at 4
//   group "...": / new <type>:        →  0 / 4 spaces, body at 8
// ---------------------------------------------------------------------------

export function astToLtg(ast: LtgAst): string {
  const { type: blockType, displayOverride } = deriveIdentifier(ast.series.unitLabel)
  const lines: string[] = []

  // ── Metadata ──────────────────────────────────────────────────────────────
  lines.push(`metadata title:  "${ast.series.title}"`)
  lines.push(`metadata media:  ${ast.series.mediaType}`)
  if (ast.series.author) lines.push(`metadata author: "${ast.series.author}"`)
  lines.push('')

  // ── Structural directives ─────────────────────────────────────────────────
  lines.push(
    displayOverride
      ? `set block: ${blockType} = "${displayOverride}"`
      : `set block: ${blockType}`,
  )
  if (ast.series.groupType) {
    const { type: groupType } = deriveIdentifier(ast.series.groupType)
    lines.push(`set group: ${groupType}`)
  }
  lines.push('')

  // ── Colour overrides ──────────────────────────────────────────────────────
  // Note: CompileSuccess.colours includes both explicit overrides and
  // hash-derived colours. We only emit explicit overrides to avoid noise.
  // Until the language server distinguishes them, we skip colours here and
  // rely on the deterministic hash for re-derived colours.
  // TODO: emit explicit colour overrides once the server marks them.

  // ── Init block ────────────────────────────────────────────────────────────
  lines.push('init:')
  for (const line of emitBody(ast.init, '    ')) lines.push(line)

  // ── Remaining blocks ──────────────────────────────────────────────────────
  for (const node of ast.blocks) {
    lines.push('')
    if (node.kind === 'group') {
      lines.push(node.label ? `group "${node.label}":` : 'group:')
      for (const block of node.blocks) {
        for (const line of emitBlock(block, blockType, '    ')) lines.push(line)
      }
    } else {
      for (const line of emitBlock(node, blockType, '')) lines.push(line)
    }
  }

  return lines.join('\n')
}

function emitBlock(block: BlockNode, blockType: string, indent: string): string[] {
  const header = block.label
    ? `${indent}new ${blockType}: "${block.label}"`
    : `${indent}new ${blockType}:`
  const bodyLines = emitBody(block.body, indent + '    ')
  return [header, ...bodyLines]
}

function emitBody(body: BlockBodyNode, indent: string): string[] {
  const lines: string[] = []

  for (const n of body.actors)
    lines.push(`${indent}actor ${n.id}: "${n.name}"`)

  for (const n of body.links) {
    const edge = n.directed ? `${n.from} -> ${n.to}` : `${n.from} -- ${n.to}`
    lines.push(`${indent}link ${n.label}(${edge})`)
  }

  for (const n of body.unlinks)
    lines.push(`${indent}unlink ${n.label} ${n.a} ${n.b}`)

  for (const n of body.deceased)
    lines.push(`${indent}deceased ${n.id}`)

  for (const n of body.renames)
    lines.push(`${indent}rename ${n.id}: "${n.name}"`)

  return lines
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** Compile a CompileSuccess directly to an LTG string. */
export function emitLtg(compiled: CompileSuccess): string {
  return astToLtg(compiledToAst(compiled))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the LTG identifier (e.g. "chapter") from a display label (e.g. "Chapter").
 * If the auto-derived title-case form doesn't match the original label a
 * `displayOverride` is included for the `set block: type = "..."` form.
 *
 * Examples:
 *   "Chapter"   → { type: "chapter" }
 *   "Story Arc" → { type: "story_arc" }
 *   "CHAPTER"   → { type: "chapter", displayOverride: "CHAPTER" }
 */
export function deriveIdentifier(
  displayLabel: string,
): { type: string; displayOverride?: string } {
  const type    = displayLabel.toLowerCase().replace(/ /g, '_')
  const derived = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return derived === displayLabel
    ? { type }
    : { type, displayOverride: displayLabel }
}
