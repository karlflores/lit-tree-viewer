import { memo, useEffect, useRef, useState } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { ltgLanguageSupport } from '../lib/ltgLanguage'

// ---------------------------------------------------------------------------
// Editor theme — matches the app's dark palette
// ---------------------------------------------------------------------------

const ltgTheme = EditorView.theme(
  {
    '&': {
      height:     '100%',
      fontSize:   '13px',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
      backgroundColor: '#1a1d27',
      color:           '#eeffff',
    },
    '.cm-content': {
      caretColor: '#4ade80',
      padding:    '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#4ade80' },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: '#2e3250',
    },
    '.cm-selectionBackground': { backgroundColor: '#2e3250' },
    '.cm-activeLine':       { backgroundColor: '#1f2235' },
    '.cm-activeLineGutter': { backgroundColor: '#1f2235' },
    '.cm-gutters': {
      backgroundColor: '#1a1d27',
      color:           '#4a5568',
      border:          'none',
      borderRight:     '1px solid #2a2d3a',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-matchingBracket': {
      backgroundColor: 'transparent',
      outline:         '1px solid rgba(74,222,128,0.5)',
      borderRadius:    '2px',
    },
    '.cm-searchMatch':                        { backgroundColor: '#2a3040', outline: '1px solid #82aaff' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#3a4060' },
    '.cm-tooltip': {
      border:          '1px solid #2a2d3a',
      backgroundColor: '#1a1d27',
      borderRadius:    '6px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#2a2d3a',
      color:           '#eeffff',
    },
  },
  { dark: true },
)

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const SAMPLE_DOC = `# Example LTG file — replace with your own content

metadata title:  "My Series"
metadata media:  book

set block: chapter

init:
    actor alice: "Alice"
    actor bob:   "Bob"
    link ally(alice -- bob)

new chapter:
    actor carol: "Carol"
    link rival(carol -> alice)
`

type Props = {
  isOpen: boolean
  onClose: () => void
}

const CodeEditorPanel = memo(({ isOpen, onClose }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef      = useRef<EditorView | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: SAMPLE_DOC,
        extensions: [
          basicSetup,
          ltgTheme,
          ltgLanguageSupport,
          // Prevent the default Ctrl+F browser find so CM's search panel handles it.
          EditorView.domEventHandlers({
            keydown(e) {
              if ((e.ctrlKey || e.metaKey) && e.key === 'f') e.preventDefault()
            },
          }),
        ],
      }),
      parent: containerRef.current,
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Position classes: half-screen (left half) or full-canvas.
  // Only transform is transitioned — keeps the slide animation clean.
  // Expand/collapse snaps the size instantly; the slide handles open/close.
  const positionClasses = expanded
    ? 'inset-4'
    : 'left-4 top-4 bottom-4 right-[calc(50%+8px)]'

  return (
    <aside
      className={[
        'absolute bg-panel border border-border rounded-3xl shadow-xl flex flex-col overflow-hidden',
        'transition-transform duration-[250ms] ease-in-out',
        positionClasses,
        isOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)]',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">LTG Editor</span>
          <span className="text-[10px] uppercase tracking-wider text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
            beta
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Expand / collapse */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
            aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
            aria-label="Close editor"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Editor surface */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden" />
    </aside>
  )
})

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      {/* top-left arrow */}
      <path d="M1 5V1H5"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* bottom-right arrow */}
      <path d="M12 8V12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* diagonal lines */}
      <path d="M1 1L5.5 5.5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12L7.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      {/* top-left arrow pointing inward */}
      <path d="M5 1V5H1"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* bottom-right arrow pointing inward */}
      <path d="M8 12V8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* diagonal lines */}
      <path d="M5 5L1 1"    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 8L12 12"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

CodeEditorPanel.displayName = 'CodeEditorPanel'
export default CodeEditorPanel
