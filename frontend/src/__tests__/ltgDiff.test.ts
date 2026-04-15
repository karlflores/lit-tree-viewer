import { describe, it, expect } from 'vitest'
import { computeLtgChanges } from '../lib/ltgDiff'

type SimpleChange = { from: number; to: number; insert: string }

// Apply a ChangeSpec[] to a string — mirrors what CodeMirror does internally.
// computeLtgChanges always returns the simple {from,to,insert} variant of ChangeSpec.
function applyChanges(text: string, changes: ReturnType<typeof computeLtgChanges>): string {
  const simple = changes as SimpleChange[]
  // Sort in reverse order so offsets remain valid as we apply each change.
  const sorted = [...simple].sort((a, b) => b.from - a.from)
  let result = text
  for (const { from, to, insert } of sorted) {
    result = result.slice(0, from) + insert + result.slice(to)
  }
  return result
}

describe('computeLtgChanges', () => {
  it('returns empty array when texts are identical', () => {
    expect(computeLtgChanges('a\nb\nc', 'a\nb\nc')).toEqual([])
  })

  it('replaces a single changed line', () => {
    const old = 'a\nb\nc'
    const neu = 'a\nx\nc'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('inserts a new line in the middle', () => {
    const old = 'a\nc'
    const neu = 'a\nb\nc'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('deletes a line from the middle', () => {
    const old = 'a\nb\nc'
    const neu = 'a\nc'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('appends a new line at the end', () => {
    const old = 'a\nb'
    const neu = 'a\nb\nc'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('deletes the last line', () => {
    const old = 'a\nb\nc'
    const neu = 'a\nb'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('changes the first line', () => {
    const old = 'a\nb\nc'
    const neu = 'x\nb\nc'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('changes the last line', () => {
    const old = 'a\nb\nc'
    const neu = 'a\nb\nz'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('handles non-contiguous changes in two separate hunks', () => {
    const old = 'a\nb\nc\nd\ne'
    const neu = 'a\nX\nc\nd\nY'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('replaces all lines', () => {
    const old = 'a\nb\nc'
    const neu = 'x\ny\nz'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('handles empty old text', () => {
    const old = ''
    const neu = 'a\nb'
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('handles empty new text', () => {
    const old = 'a\nb'
    const neu = ''
    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
  })

  it('realistic LTG: adds an actor to the init block', () => {
    const old = [
      'metadata title: "Test"',
      'metadata media: book',
      '',
      'set block: chapter',
      '',
      'init:',
      '    actor alice: "Alice"',
      '',
      'new chapter:',
    ].join('\n')

    const neu = [
      'metadata title: "Test"',
      'metadata media: book',
      '',
      'set block: chapter',
      '',
      'init:',
      '    actor alice: "Alice"',
      '    actor bob: "Bob"',
      '',
      'new chapter:',
    ].join('\n')

    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
    // Only one hunk — the new actor line
    expect(changes).toHaveLength(1)
  })

  it('realistic LTG: adds a link in chapter 2, leaving chapter 1 unchanged', () => {
    const old = [
      'init:',
      '    actor alice: "Alice"',
      '    actor bob: "Bob"',
      '',
      'new chapter:',
      '',
      'new chapter:',
    ].join('\n')

    const neu = [
      'init:',
      '    actor alice: "Alice"',
      '    actor bob: "Bob"',
      '',
      'new chapter:',
      '',
      'new chapter:',
      '    link ally(alice -- bob)',
    ].join('\n')

    const changes = computeLtgChanges(old, neu)
    expect(applyChanges(old, changes)).toBe(neu)
    expect(changes).toHaveLength(1)
  })
})
