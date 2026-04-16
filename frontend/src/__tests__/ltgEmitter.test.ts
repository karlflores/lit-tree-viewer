import { describe, it, expect } from 'vitest'
import type { CompileSuccess } from '../lib/ltgLspClient'
import {
  deriveIdentifier,
  compiledToAst,
  astToLtg,
  emitLtg,
  type LtgAst,
  type BlockBodyNode,
} from '../lib/ltgEmitter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeries(overrides: Partial<{
  title: string; mediaType: string; unitLabel: string
  totalUnits: number; author: string | null; groupType: string | null
}> = {}) {
  return {
    title:      'Test Series',
    mediaType:  'book',
    unitLabel:  'Chapter',
    totalUnits: 5,
    author:     null,
    groupType:  null,
    ...overrides,
  }
}

function makeCompiled(overrides: Partial<{
  series:        unknown
  characters:    unknown[]
  relationships: unknown[]
  colours:       Record<string, string>
  blocks:        unknown[]
}> = {}): CompileSuccess {
  return {
    series:        makeSeries(),
    characters:    [],
    relationships: [],
    colours:       {},
    blocks:        [{ index: 1, label: null, groupLabel: null }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// deriveIdentifier
// ---------------------------------------------------------------------------

describe('deriveIdentifier', () => {
  it('lowercases single words with no override', () => {
    expect(deriveIdentifier('Chapter')).toEqual({ type: 'chapter' })
  })

  it('converts spaces to underscores', () => {
    expect(deriveIdentifier('Story Arc')).toEqual({ type: 'story_arc' })
  })

  it('includes displayOverride when derived title-case does not match', () => {
    expect(deriveIdentifier('CHAPTER')).toEqual({ type: 'chapter', displayOverride: 'CHAPTER' })
  })

  it('includes displayOverride for mixed case that does not round-trip', () => {
    expect(deriveIdentifier('aCt')).toEqual({ type: 'act', displayOverride: 'aCt' })
  })

  it('handles multi-word label that does round-trip', () => {
    expect(deriveIdentifier('Story Arc')).toEqual({ type: 'story_arc' })
    // Verify derived form: "story_arc" → "Story Arc" ✓
  })

  it('includes displayOverride for multi-word that does not round-trip', () => {
    expect(deriveIdentifier('STORY ARC')).toEqual({ type: 'story_arc', displayOverride: 'STORY ARC' })
  })

  it('handles Episode', () => {
    expect(deriveIdentifier('Episode')).toEqual({ type: 'episode' })
  })
})

// ---------------------------------------------------------------------------
// compiledToAst — init block (block 1)
// ---------------------------------------------------------------------------

describe('compiledToAst — init block', () => {
  it('collects actors introduced at block 1', () => {
    const compiled = makeCompiled({
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [], introducedAt: 1, diedAt: null },
        { identifier: 'bob',   name: 'Bob',   aliases: [], renames: [], introducedAt: 2, diedAt: null },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.init.actors).toEqual([{ id: 'alice', name: 'Alice' }])
  })

  it('collects links introduced at block 1', () => {
    const compiled = makeCompiled({
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [], introducedAt: 1, diedAt: null },
        { identifier: 'bob',   name: 'Bob',   aliases: [], renames: [], introducedAt: 1, diedAt: null },
      ],
      relationships: [
        { fromIdentifier: 'alice', toIdentifier: 'bob', label: 'friend', directed: false, introducedAt: 1, endedAt: null },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.init.links).toEqual([
      { label: 'friend', from: 'alice', to: 'bob', directed: false },
    ])
  })

  it('emits no unlinks in init (UnlinkInInit not allowed)', () => {
    const compiled = makeCompiled({
      relationships: [
        // endedAt: 0 would be N-1 for block 1, but init should ignore it
        { fromIdentifier: 'a', toIdentifier: 'b', label: 'x', directed: false, introducedAt: 1, endedAt: 0 },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.init.unlinks).toEqual([])
  })

  it('emits no deceased in init', () => {
    const compiled = makeCompiled({
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [], introducedAt: 1, diedAt: 1 },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.init.deceased).toEqual([])
  })

  it('emits no renames in init', () => {
    const compiled = makeCompiled({
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [{ name: 'Ally', introducedAt: 1 }], introducedAt: 1, diedAt: null },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.init.renames).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// compiledToAst — later blocks
// ---------------------------------------------------------------------------

describe('compiledToAst — later blocks', () => {
  it('places a new actor in the block matching their introducedAt', () => {
    const compiled = makeCompiled({
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [], introducedAt: 1, diedAt: null },
        { identifier: 'carol', name: 'Carol', aliases: [], renames: [], introducedAt: 2, diedAt: null },
      ],
      blocks: [
        { index: 1, label: null,      groupLabel: null },
        { index: 2, label: 'Two',     groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    const block2 = ast.blocks[0]!
    expect(block2.kind).toBe('block')
    if (block2.kind === 'block') {
      expect(block2.body.actors).toEqual([{ id: 'carol', name: 'Carol' }])
    }
  })

  it('places a new link in the block matching introducedAt', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 3 }),
      relationships: [
        { fromIdentifier: 'alice', toIdentifier: 'bob', label: 'rivals', directed: true, introducedAt: 3, endedAt: null },
      ],
      blocks: [
        { index: 1, label: null, groupLabel: null },
        { index: 3, label: null, groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    // block 2 is synthesised (empty) at index 0; block 3 is at index 1
    const block3 = ast.blocks[1]!
    if (block3.kind === 'block') {
      expect(block3.body.links).toEqual([
        { label: 'rivals', from: 'alice', to: 'bob', directed: true },
      ])
    }
  })

  it('places an unlink in block N when endedAt === N − 1', () => {
    // unlink in block 3 sets endedAt = 2 (N-1)
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 3 }),
      relationships: [
        { fromIdentifier: 'alice', toIdentifier: 'bob', label: 'friend', directed: false, introducedAt: 1, endedAt: 2 },
      ],
      blocks: [
        { index: 1, label: null, groupLabel: null },
        { index: 3, label: null, groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    // block 2 is synthesised (empty) at index 0; block 3 is at index 1
    const block3 = ast.blocks[1]!
    if (block3.kind === 'block') {
      expect(block3.body.unlinks).toEqual([
        { label: 'friend', a: 'alice', b: 'bob' },
      ])
    }
  })

  it('places a deceased event in the block matching diedAt', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 4 }),
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [], introducedAt: 1, diedAt: 4 },
      ],
      blocks: [
        { index: 1, label: null, groupLabel: null },
        { index: 4, label: null, groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    // blocks 2, 3 are synthesised; block 4 is at index 2
    const block4 = ast.blocks[2]!
    if (block4.kind === 'block') {
      expect(block4.body.deceased).toEqual([{ id: 'alice' }])
    }
  })

  it('places a rename in the block matching introducedAt', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 5 }),
      characters: [
        {
          identifier: 'alice', name: 'Alice', aliases: [], introducedAt: 1, diedAt: null,
          renames: [{ name: 'Alicia', introducedAt: 5 }],
        },
      ],
      blocks: [
        { index: 1, label: null, groupLabel: null },
        { index: 5, label: null, groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    // blocks 2, 3, 4 are synthesised; block 5 is at index 3
    const block5 = ast.blocks[3]!
    if (block5.kind === 'block') {
      expect(block5.body.renames).toEqual([{ id: 'alice', name: 'Alicia' }])
    }
  })

  it('does not include an unlink in the same block as its introducedAt', () => {
    // A relationship introduced and ended in the same "window" should only appear as link in block N,
    // not as unlink in block N+1 unless endedAt is specifically N.
    // Here endedAt:1 → unlink appears in block 2 (N=2, N-1=1)
    const compiled = makeCompiled({
      relationships: [
        { fromIdentifier: 'a', toIdentifier: 'b', label: 'x', directed: false, introducedAt: 1, endedAt: 1 },
      ],
      blocks: [
        { index: 1, label: null, groupLabel: null },
        { index: 2, label: null, groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.init.unlinks).toEqual([])
    const block2 = ast.blocks[0]!
    if (block2.kind === 'block') {
      expect(block2.body.unlinks).toEqual([{ label: 'x', a: 'a', b: 'b' }])
    }
  })
})

// ---------------------------------------------------------------------------
// compiledToAst — group reconstruction
// ---------------------------------------------------------------------------

describe('compiledToAst — group reconstruction (buildBlocks)', () => {
  it('emits a standalone BlockNode when groupLabel is null', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 2 }),
      blocks: [
        { index: 1, label: null,  groupLabel: null },
        { index: 2, label: 'Two', groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.blocks).toHaveLength(1)
    expect(ast.blocks[0]!.kind).toBe('block')
  })

  it('groups consecutive same-groupLabel blocks into a GroupNode', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 4 }),
      blocks: [
        { index: 1, label: null,   groupLabel: null },
        { index: 2, label: 'Ch 2', groupLabel: 'Volume I' },
        { index: 3, label: 'Ch 3', groupLabel: 'Volume I' },
        { index: 4, label: 'Ch 4', groupLabel: 'Volume I' },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.blocks).toHaveLength(1)
    const group = ast.blocks[0]!
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.label).toBe('Volume I')
      expect(group.blocks).toHaveLength(3)
      expect(group.blocks.map(b => b.index)).toEqual([2, 3, 4])
    }
  })

  it('splits into separate GroupNodes when groupLabel changes', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 3 }),
      blocks: [
        { index: 1, label: null,   groupLabel: null },
        { index: 2, label: 'Ch 2', groupLabel: 'Vol I' },
        { index: 3, label: 'Ch 3', groupLabel: 'Vol II' },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.blocks).toHaveLength(2)
    expect(ast.blocks[0]!.kind).toBe('group')
    expect(ast.blocks[1]!.kind).toBe('group')
    if (ast.blocks[0]!.kind === 'group') expect(ast.blocks[0]!.label).toBe('Vol I')
    if (ast.blocks[1]!.kind === 'group') expect(ast.blocks[1]!.label).toBe('Vol II')
  })

  it('interleaves standalone and group nodes correctly', () => {
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 4 }),
      blocks: [
        { index: 1, label: null,   groupLabel: null },
        { index: 2, label: 'Ch 2', groupLabel: 'Vol I' },
        { index: 3, label: 'Ch 3', groupLabel: 'Vol I' },
        { index: 4, label: 'Ch 4', groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    expect(ast.blocks).toHaveLength(2)
    expect(ast.blocks[0]!.kind).toBe('group')
    expect(ast.blocks[1]!.kind).toBe('block')
    if (ast.blocks[1]!.kind === 'block') expect(ast.blocks[1]!.index).toBe(4)
  })

  it('synthesises empty blocks for indices missing from compiled.blocks', () => {
    // Series has 5 units but only blocks 1 and 5 appear in compiled.blocks.
    // Blocks 2, 3, 4 should be synthesised as empty standalone blocks.
    const compiled = makeCompiled({
      series: makeSeries({ totalUnits: 5 }),
      blocks: [
        { index: 1, label: null,      groupLabel: null },
        { index: 5, label: 'Finale',  groupLabel: null },
      ],
    })
    const ast = compiledToAst(compiled)
    // Expect blocks for indices 2, 3, 4 (empty) and 5 (labelled) = 4 total
    expect(ast.blocks).toHaveLength(4)
    const indices = ast.blocks.map(b => b.kind === 'block' ? b.index : null)
    expect(indices).toEqual([2, 3, 4, 5])
    // Empty blocks have no events
    const block3 = ast.blocks[1]!
    if (block3.kind === 'block') {
      expect(block3.body).toEqual({ actors: [], links: [], unlinks: [], deceased: [], renames: [] })
    }
    // Block 5 retains its label
    const block5 = ast.blocks[3]!
    if (block5.kind === 'block') {
      expect(block5.label).toBe('Finale')
    }
  })
})

// ---------------------------------------------------------------------------
// astToLtg — metadata section
// ---------------------------------------------------------------------------

describe('astToLtg — metadata', () => {
  function minimalAst(overrides: Partial<LtgAst> = {}): LtgAst {
    return {
      series: {
        title:      'My Book',
        mediaType:  'book',
        unitLabel:  'Chapter',
        totalUnits: 1,
        author:     null,
        groupType:  null,
      },
      colours: {},
      init:   { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [],
      ...overrides,
    }
  }

  it('emits title metadata', () => {
    const ltg = astToLtg(minimalAst())
    expect(ltg).toContain('metadata title:  "My Book"')
  })

  it('emits media type', () => {
    const ltg = astToLtg(minimalAst())
    expect(ltg).toContain('metadata media:  book')
  })

  it('omits author line when author is null', () => {
    const ltg = astToLtg(minimalAst())
    expect(ltg).not.toContain('metadata author')
  })

  it('emits author when present', () => {
    const ltg = astToLtg(minimalAst({ series: { title: 'My Book', mediaType: 'book', unitLabel: 'Chapter', totalUnits: 1, author: 'Jane Austen', groupType: null } }))
    expect(ltg).toContain('metadata author: "Jane Austen"')
  })

  it('emits set block directive', () => {
    const ltg = astToLtg(minimalAst())
    expect(ltg).toContain('set block: chapter')
  })

  it('emits set block with display override', () => {
    const ltg = astToLtg(minimalAst({ series: { title: 'My Book', mediaType: 'book', unitLabel: 'CHAPTER', totalUnits: 1, author: null, groupType: null } }))
    expect(ltg).toContain('set block: chapter = "CHAPTER"')
  })

  it('emits set group when groupType is set', () => {
    const ltg = astToLtg(minimalAst({ series: { title: 'My Book', mediaType: 'book', unitLabel: 'Chapter', totalUnits: 1, author: null, groupType: 'Volume' } }))
    expect(ltg).toContain('set group: volume')
  })

  it('omits set group when groupType is null', () => {
    const ltg = astToLtg(minimalAst())
    expect(ltg).not.toContain('set group')
  })
})

// ---------------------------------------------------------------------------
// astToLtg — body emission
// ---------------------------------------------------------------------------

describe('astToLtg — body events', () => {
  function astWithInit(body: Partial<BlockBodyNode>): LtgAst {
    return {
      series: { title: 'T', mediaType: 'book', unitLabel: 'Chapter', totalUnits: 1, author: null, groupType: null },
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [], ...body },
      blocks: [],
    }
  }

  it('emits actor lines', () => {
    const ltg = astToLtg(astWithInit({ actors: [{ id: 'alice', name: 'Alice Liddell' }] }))
    expect(ltg).toContain('    actor alice: "Alice Liddell"')
  })

  it('emits undirected link', () => {
    const ltg = astToLtg(astWithInit({ links: [{ label: 'friend', from: 'a', to: 'b', directed: false }] }))
    expect(ltg).toContain('    link friend(a -- b)')
  })

  it('emits directed link with arrow', () => {
    const ltg = astToLtg(astWithInit({ links: [{ label: 'mentor', from: 'a', to: 'b', directed: true }] }))
    expect(ltg).toContain('    link mentor(a -> b)')
  })

  it('emits unlink line', () => {
    const ast: LtgAst = {
      series: { title: 'T', mediaType: 'book', unitLabel: 'Chapter', totalUnits: 2, author: null, groupType: null },
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'block', index: 2, label: null,
        body: { actors: [], links: [], unlinks: [{ label: 'friend', a: 'a', b: 'b' }], deceased: [], renames: [] },
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('    unlink friend a b')
  })

  it('emits deceased line', () => {
    const ast: LtgAst = {
      series: { title: 'T', mediaType: 'book', unitLabel: 'Chapter', totalUnits: 2, author: null, groupType: null },
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'block', index: 2, label: null,
        body: { actors: [], links: [], unlinks: [], deceased: [{ id: 'alice' }], renames: [] },
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('    deceased alice')
  })

  it('emits rename line', () => {
    const ast: LtgAst = {
      series: { title: 'T', mediaType: 'book', unitLabel: 'Chapter', totalUnits: 2, author: null, groupType: null },
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'block', index: 2, label: null,
        body: { actors: [], links: [], unlinks: [], deceased: [], renames: [{ id: 'alice', name: 'Alicia' }] },
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('    rename alice: "Alicia"')
  })
})

// ---------------------------------------------------------------------------
// astToLtg — indentation / structure
// ---------------------------------------------------------------------------

describe('astToLtg — block and group structure', () => {
  const baseSeries = { title: 'T', mediaType: 'book' as const, unitLabel: 'Chapter', totalUnits: 3, author: null, groupType: 'Volume' }

  it('emits standalone block header with label', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{ kind: 'block', index: 2, label: 'The Beginning', body: { actors: [], links: [], unlinks: [], deceased: [], renames: [] } }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('new chapter: "The Beginning"')
  })

  it('emits standalone block header without label', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{ kind: 'block', index: 2, label: null, body: { actors: [], links: [], unlinks: [], deceased: [], renames: [] } }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('new chapter:')
    expect(ltg).not.toContain('new chapter: "')
  })

  it('emits group header with label', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'group', label: 'Volume I',
        blocks: [
          { kind: 'block', index: 2, label: 'Ch 2', body: { actors: [], links: [], unlinks: [], deceased: [], renames: [] } },
        ],
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('group "Volume I":')
  })

  it('indents group block header at 4 spaces', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'group', label: 'Vol I',
        blocks: [
          { kind: 'block', index: 2, label: 'Ch 2', body: { actors: [], links: [], unlinks: [], deceased: [], renames: [] } },
        ],
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('    new chapter: "Ch 2"')
  })

  it('indents group block body at 8 spaces', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'group', label: 'Vol I',
        blocks: [{
          kind: 'block', index: 2, label: null,
          body: { actors: [{ id: 'carol', name: 'Carol' }], links: [], unlinks: [], deceased: [], renames: [] },
        }],
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('        actor carol: "Carol"')
  })

  it('indents standalone block body at 4 spaces', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [{
        kind: 'block', index: 2, label: null,
        body: { actors: [{ id: 'alice', name: 'Alice' }], links: [], unlinks: [], deceased: [], renames: [] },
      }],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('    actor alice: "Alice"')
  })

  it('indents init body at 4 spaces', () => {
    const ast: LtgAst = {
      series: baseSeries,
      colours: {},
      init: { actors: [{ id: 'alice', name: 'Alice' }], links: [], unlinks: [], deceased: [], renames: [] },
      blocks: [],
    }
    const ltg = astToLtg(ast)
    expect(ltg).toContain('init:')
    expect(ltg).toContain('    actor alice: "Alice"')
  })
})

// ---------------------------------------------------------------------------
// emitLtg — full round-trip fixture
// ---------------------------------------------------------------------------

describe('emitLtg — structural round-trip', () => {
  it('produces correct top-level structure for a two-block series', () => {
    const compiled = makeCompiled({
      series: makeSeries({ title: 'Round Trip', author: 'Test Author', groupType: null }),
      characters: [
        { identifier: 'alice', name: 'Alice', aliases: [], renames: [], introducedAt: 1, diedAt: null },
        { identifier: 'bob',   name: 'Bob',   aliases: [], renames: [], introducedAt: 2, diedAt: null },
      ],
      relationships: [
        { fromIdentifier: 'alice', toIdentifier: 'bob', label: 'friends', directed: false, introducedAt: 2, endedAt: null },
      ],
      blocks: [
        { index: 1, label: 'Opening', groupLabel: null },
        { index: 2, label: 'Rising',  groupLabel: null },
      ],
    })

    const ltg = emitLtg(compiled)

    expect(ltg).toContain('metadata title:  "Round Trip"')
    expect(ltg).toContain('metadata author: "Test Author"')
    expect(ltg).toContain('set block: chapter')
    expect(ltg).toContain('init:')
    expect(ltg).toContain('    actor alice: "Alice"')
    expect(ltg).toContain('new chapter: "Rising"')
    expect(ltg).toContain('    actor bob: "Bob"')
    expect(ltg).toContain('    link friends(alice -- bob)')
  })

  it('groups blocks into volumes correctly', () => {
    const compiled = makeCompiled({
      series: makeSeries({ groupType: 'Volume' }),
      blocks: [
        { index: 1, label: null,   groupLabel: null },
        { index: 2, label: 'Ch 2', groupLabel: 'Volume I' },
        { index: 3, label: 'Ch 3', groupLabel: 'Volume I' },
      ],
    })

    const ltg = emitLtg(compiled)

    expect(ltg).toContain('set group: volume')
    expect(ltg).toContain('group "Volume I":')
    expect(ltg).toContain('    new chapter: "Ch 2"')
    expect(ltg).toContain('    new chapter: "Ch 3"')
  })
})
