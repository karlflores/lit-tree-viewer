import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

// ---------------------------------------------------------------------------
// Keywords / reserved identifiers
// ---------------------------------------------------------------------------

const KEYWORDS    = new Set(['metadata', 'set', 'actor', 'init', 'new', 'group', 'link', 'unlink', 'deceased'])
const META_PROPS  = new Set(['title', 'media', 'author'])
const SET_PROPS   = new Set(['block', 'colour'])
const MEDIA_TYPES = new Set(['book', 'show', 'film'])

// ---------------------------------------------------------------------------
// StreamLanguage tokenizer
// ---------------------------------------------------------------------------

const ltgStreamLanguage = StreamLanguage.define<null>({
  // No stateful parse state needed for a single-pass tokenizer.
  startState: () => null,

  token(stream) {
    if (stream.eatSpace()) return null

    // Line comments
    if (stream.match(/^#.*/)) return 'comment'

    // Quoted strings (single-line only — LTG has no multi-line strings)
    if (stream.peek() === '"') {
      stream.next()
      while (!stream.eol() && stream.peek() !== '"') stream.next()
      if (!stream.eol()) stream.next()
      return 'string'
    }

    // Hex colour literals (#rrggbb / #rgb) — must come before bare # comment check,
    // but they only appear after = so we match them as strings for a consistent colour.
    // (Already handled: the tokenizer only reaches here when peek() !== '#'.)

    // Relationship operators
    if (stream.match('->') || stream.match('--')) return 'operator'
    // Assignment / structural punctuation
    if (stream.match('=') || stream.match(':') || stream.match('(') || stream.match(')')) return 'operator'

    // Identifiers, keywords, property names, media types
    const m = stream.match(/^[a-zA-Z_]\w*/)
    if (m) {
      const w = (m as RegExpMatchArray)[0]
      if (KEYWORDS.has(w))    return 'keyword'
      if (META_PROPS.has(w))  return 'propertyName'
      if (SET_PROPS.has(w))   return 'propertyName'
      if (MEDIA_TYPES.has(w)) return 'typeName'
      // Everything else is an actor identifier or a relationship label.
      return 'variableName'
    }

    stream.next()
    return null
  },

  tokenTable: {
    keyword:      tags.keyword,
    string:       tags.string,
    comment:      tags.lineComment,
    operator:     tags.operator,
    propertyName: tags.propertyName,
    typeName:     tags.typeName,
    variableName: tags.variableName,
  },
})

// ---------------------------------------------------------------------------
// Syntax highlighting colours
// ---------------------------------------------------------------------------

export const ltgHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword,      color: '#82aaff', fontWeight: '600' },
  { tag: tags.string,       color: '#c3e88d' },
  { tag: tags.lineComment,  color: '#4a5568', fontStyle: 'italic' },
  { tag: tags.operator,     color: '#89ddff' },
  { tag: tags.propertyName, color: '#f78c6c' },
  { tag: tags.typeName,     color: '#ffcb6b' },
  { tag: tags.variableName, color: '#c792ea' },
])

// ---------------------------------------------------------------------------
// Composed extension — import this in the editor component
// ---------------------------------------------------------------------------

export const ltgLanguageSupport: Extension = [
  ltgStreamLanguage,
  syntaxHighlighting(ltgHighlightStyle),
]
