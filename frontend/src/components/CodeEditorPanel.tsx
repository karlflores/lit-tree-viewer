import { memo, useEffect, useRef, useState } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { computeLtgChanges } from '../lib/ltgDiff'
import { lintGutter, setDiagnostics, type Diagnostic as CMDiagnostic } from '@codemirror/lint'
import { ltgLanguageSupport } from '../lib/ltgLanguage'
import { LtgLspClient, type LspDiagnostic, type CompileSuccess } from '../lib/ltgLspClient'
import { useNotificationStore } from '../lib/notificationStore'

// ---------------------------------------------------------------------------
// Editor theme
// ---------------------------------------------------------------------------

const ltgTheme = EditorView.theme(
  {
    '&': {
      height:          '100%',
      fontSize:        '15px',
      fontFamily:      "'JetBrains Mono', ui-monospace, monospace",
      backgroundColor: '#1a1d27',
      color:           '#eeffff',
    },
    '.cm-content': { caretColor: '#4ade80', padding: '12px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#4ade80' },
    '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#2e3250' },
    '.cm-selectionBackground':  { backgroundColor: '#2e3250' },
    '.cm-activeLine':           { backgroundColor: '#1f2235' },
    '.cm-activeLineGutter':     { backgroundColor: '#1f2235' },
    '.cm-gutters': {
      backgroundColor: '#1a1d27',
      color:           '#4a5568',
      border:          'none',
      borderRight:     '1px solid #2a2d3a',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 8px' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-matchingBracket': {
      backgroundColor: 'transparent',
      outline:         '1px solid rgba(74,222,128,0.5)',
      borderRadius:    '2px',
    },
    '.cm-searchMatch':                         { backgroundColor: '#2a3040', outline: '1px solid #82aaff' },
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
    // Lint gutter
    '.cm-gutter-lint': { width: '20px' },
    '.cm-lint-marker': { display: 'block', margin: '0 auto' },
    // Squiggles use solid coloured underlines instead of the default wavy image
    '.cm-lintRange-error':   { backgroundImage: 'none', borderBottom: '2px solid rgba(248,113,113,0.8)' },
    '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '2px solid rgba(251,191,36,0.8)'  },
    // Diagnostic tooltip panel
    '.cm-diagnostic':       { padding: '4px 8px' },
    '.cm-diagnosticText':   { color: '#eeffff', fontSize: '12px' },
    '.cm-diagnosticSource': { color: '#82aaff', fontSize: '11px', fontStyle: 'normal', marginRight: '6px' },

    // ── Search / find-replace panel ──────────────────────────────────────────
    '.cm-panel': {
      backgroundColor: '#1a1d27',
      borderTop:       '1px solid #2a2d3a',
      padding:         '8px 12px',
      fontFamily:      "'JetBrains Mono', ui-monospace, monospace",
      fontSize:        '12px',
    },
    '.cm-panel.cm-search': {
      display:    'flex',
      alignItems: 'center',
      flexWrap:   'wrap',
      gap:        '6px',
    },
    // Force JetBrains Mono on every descendant — browsers don't inherit font-family
    // into form elements (inputs, buttons) from an ancestor, so we catch all at once.
    '.cm-panel *': {
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    },
    // Text inputs
    '.cm-panel input[type="text"], .cm-textfield': {
      backgroundColor: '#12141e',
      border:          '1px solid #2a2d3a',
      borderRadius:    '6px',
      color:           '#eeffff',
      padding:         '4px 8px',
      fontSize:        '12px',
      fontFamily:      "'JetBrains Mono', ui-monospace, monospace",
      outline:         'none',
      minWidth:        '140px',
    },
    '.cm-panel input[type="text"]:focus, .cm-textfield:focus': {
      borderColor: 'rgba(74,222,128,0.5)',
      boxShadow:   '0 0 0 2px rgba(74,222,128,0.12)',
    },
    // Buttons — match the header ghost buttons (no border, no gradient)
    '.cm-panel button, .cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'transparent',
      border:          'none',
      borderRadius:    '8px',
      color:           'rgba(255,255,255,0.6)',
      padding:         '4px 10px',
      height:          '30px',
      fontSize:        '11px',
      fontFamily:      "'JetBrains Mono', ui-monospace, monospace",
      fontWeight:      '500',
      cursor:          'pointer',
      transition:      'color 150ms ease, background-color 150ms ease',
    },
    '.cm-panel button:hover, .cm-button:hover': {
      backgroundImage: 'none',
      backgroundColor: 'rgba(255,255,255,0.1)',
      color:           '#ffffff',
    },
    '.cm-panel button:active, .cm-button:active': {
      backgroundImage: 'none',
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    // Close button — 32×32 square, matches the editor panel's close button.
    // text-indent pushes the native × off-screen; ::after renders our sized version.
    '.cm-panel button[name="close"]': {
      backgroundImage:  'none',
      width:            '32px',
      height:           '32px',
      padding:          '0',
      position:         'relative',
      overflow:         'hidden',
      textIndent:       '-9999px',
      alignSelf:        'center',
      borderRadius:     '8px',
      color:            'rgba(255,255,255,0.4)',
    },
    '.cm-panel button[name="close"]::after': {
      content:   '"×"',
      position:  'absolute',
      inset:     '0',
      display:   'flex',
      alignItems:    'center',
      justifyContent: 'center',
      textIndent: '0',
      fontSize:   '22px',
      lineHeight: '1',
      color:      'inherit',
    },
    '.cm-panel button[name="close"]:hover': {
      backgroundImage: 'none',
      backgroundColor: 'rgba(255,255,255,0.1)',
      color:           '#ffffff',
    },
    // Labels
    '.cm-panel label': {
      color:      'rgba(255,255,255,0.4)',
      fontSize:   '11px',
      display:    'flex',
      alignItems: 'center',
      gap:        '6px',
      cursor:     'pointer',
      userSelect: 'none',
      transition: 'color 150ms ease',
    },
    '.cm-panel label:hover': {
      color: 'rgba(255,255,255,0.75)',
    },
    // Circular checkboxes
    '.cm-panel input[type="checkbox"]': {
      appearance:      'none',
      WebkitAppearance: 'none',
      width:           '13px',
      height:          '13px',
      borderRadius:    '50%',
      border:          '1.5px solid rgba(255,255,255,0.2)',
      backgroundColor: 'transparent',
      cursor:          'pointer',
      flexShrink:      '0',
      transition:      'background-color 150ms ease, border-color 150ms ease',
      position:        'relative',
      top:             '0',
    },
    '.cm-panel input[type="checkbox"]:checked': {
      backgroundColor: '#4ade80',
      borderColor:     '#4ade80',
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 10 10' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 5l2.5 2.5L8 3' stroke='%231a1d27' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E\")",
      backgroundSize:  '10px 10px',
      backgroundPosition: 'center',
      backgroundRepeat:   'no-repeat',
    },
    '.cm-panel input[type="checkbox"]:hover:not(:checked)': {
      borderColor: 'rgba(255,255,255,0.4)',
    },
  },
  { dark: true },
)

// ---------------------------------------------------------------------------
// LSP → CodeMirror diagnostic conversion
// ---------------------------------------------------------------------------

function lspToCm(d: LspDiagnostic, view: EditorView): CMDiagnostic | null {
  const doc = view.state.doc
  if (d.range.start.line >= doc.lines) return null

  const startLine = doc.line(Math.min(d.range.start.line + 1, doc.lines))
  const endLine   = doc.line(Math.min(d.range.end.line   + 1, doc.lines))
  const from      = Math.min(startLine.from + d.range.start.character, startLine.to)
  const to        = Math.min(endLine.from   + d.range.end.character,   endLine.to)

  return {
    from,
    to:       Math.max(from + 1, to),
    severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
    message:  d.message,
    source:   d.code,
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ltg-editor-content'

function loadDoc(): string {
  return localStorage.getItem(STORAGE_KEY) ?? SAMPLE_DOC
}

function saveDoc(text: string): void {
  localStorage.setItem(STORAGE_KEY, text)
}

// ---------------------------------------------------------------------------
// Sample document
// ---------------------------------------------------------------------------

const SAMPLE_DOC = `# Wuthering Heights by Emily Brontë
# A graph of the major characters and relationships, told in the order
# events unfold rather than the novel's frame-narrative chapter order.

metadata title:  "Wuthering Heights"
metadata media:  book
metadata author: "Emily Brontë"

set block: chapter
set group: volume

set colour: parent_child = "#818cf8"
set colour: siblings     = "#60a5fa"
set colour: guardian     = "#a78bfa"
set colour: friends      = "#4ade80"
set colour: romantic     = "#e879f9"
set colour: married      = "#f472b6"
set colour: rival        = "#fb923c"
set colour: enemy        = "#f87171"
set colour: tenant       = "#94a3b8"

# ── Block 1: The Earnshaw household at Wuthering Heights ─────────────────────
init:
    actor earnshaw:  "Mr. Earnshaw"
    actor hindley:   "Hindley Earnshaw"
    actor catherine: "Catherine Earnshaw"
    actor nelly:     "Nelly Dean"
    actor joseph:    "Joseph"
    link parent_child(earnshaw -> hindley)
    link parent_child(earnshaw -> catherine)
    link siblings(hindley -- catherine)

group "Volume I":
    # Block 2
    new chapter: "Heathcliff Arrives"
        actor heathcliff: "Heathcliff"
        link guardian(earnshaw -> heathcliff)
        link friends(catherine -- heathcliff)
        link rival(hindley -> heathcliff)

    # Block 3
    new chapter: "Hindley Goes to College"

    # Block 4
    new chapter: "Hindley Returns as Master"
        actor frances: "Frances Earnshaw"
        deceased earnshaw
        link married(hindley -- frances)
        link enemy(hindley -> heathcliff)

    # Block 5
    new chapter: "Cathy and Heathcliff at Thrushcross Grange"
        actor edgar:    "Edgar Linton"
        actor isabella: "Isabella Linton"
        link siblings(edgar -- isabella)
        link romantic(catherine -- edgar)

    # Block 6
    new chapter: "Frances Dies, Hareton Born"
        actor hareton: "Hareton Earnshaw"
        deceased frances
        link parent_child(hindley -> hareton)

    # Block 7
    new chapter: "Heathcliff Overhears and Departs"

    # Block 8
    new chapter: "Catherine and Edgar Wed"
        rename catherine: "Catherine Linton"
        link married(edgar -- catherine)
        unlink romantic catherine edgar

    # Block 9
    new chapter: "Heathcliff Returns, Wealthy and Changed"
        link romantic(heathcliff -> catherine)
        link enemy(heathcliff -> edgar)

    # Block 10
    new chapter: "Isabella Falls for Heathcliff"
        link romantic(isabella -> heathcliff)

    # Block 11
    new chapter: "Heathcliff Elopes with Isabella"
        link married(heathcliff -- isabella)
        unlink romantic isabella heathcliff

    # Block 12
    new chapter: "Catherine Dies in Childbirth"
        actor cathy: "Cathy Linton"
        deceased catherine
        link parent_child(edgar -> cathy)

group "Volume II":
    # Block 13
    new chapter: "Hindley Dies, Heathcliff Takes Wuthering Heights"
        actor linton: "Linton Heathcliff"
        deceased hindley
        link parent_child(heathcliff -> linton)
        link guardian(heathcliff -> hareton)

    # Block 14
    new chapter: "Isabella Dies in Exile"
        deceased isabella

    # Block 15
    new chapter: "Cathy Meets Her Cousins"
        link friends(cathy -- hareton)
        link friends(cathy -- linton)

    # Block 16
    new chapter: "Cathy and Linton Correspond"
        link romantic(cathy -- linton)

    # Block 17
    new chapter: "Edgar Is Failing"

    # Block 18
    new chapter: "Heathcliff Forces the Marriage"
        rename cathy: "Catherine Heathcliff"
        link married(cathy -- linton)
        unlink romantic cathy linton

    # Block 19
    new chapter: "Edgar and Linton Die"
        deceased edgar
        deceased linton
        link guardian(heathcliff -> cathy)

    # Block 20
    new chapter: "Lockwood's Visit"
        actor lockwood: "Mr. Lockwood"
        link tenant(lockwood -> heathcliff)

    # Block 21
    new chapter: "Hareton and Cathy Grow Close"
        link romantic(hareton -- cathy)

    # Block 22
    new chapter: "Heathcliff Dies"
        deceased heathcliff
`

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

type Props = {
  isOpen:              boolean
  onClose:             () => void
  onCompileAndRender:  (graph: CompileSuccess) => void
  /** One-shot: replaces the document and resets the cursor to the top. */
  externalContent?:    string | null
  /**
   * Live sync: replaces the document while preserving cursor position.
   * Used for canvas → code auto-sync in edit mode.
   */
  syncContent?:        string | null
}

const CodeEditorPanel = memo(({ isOpen, onClose, onCompileAndRender, externalContent, syncContent }: Props) => {
  const containerRef  = useRef<HTMLDivElement>(null)
  const viewRef       = useRef<EditorView | null>(null)
  const lspRef        = useRef<LtgLspClient | null>(null)
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const docVersionRef = useRef(1)

  const [expanded,    setExpanded]    = useState(false)
  const [connected,   setConnected]   = useState(false)
  const [compiling,   setCompiling]   = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [synced,      setSynced]      = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs for auto-render on newline — kept current without stale closure issues.
  const onCompileAndRenderRef    = useRef(onCompileAndRender)
  onCompileAndRenderRef.current  = onCompileAndRender
  const connectedRef             = useRef(false)
  const autoRenderDebounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoRenderInProgressRef  = useRef(false)

  const { addToast, setDiagnosticSummary } = useNotificationStore()

  // ── Editor + LSP setup ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    // Update listener — persists to localStorage immediately and debounces didChange.
    // Also triggers a silent auto-render whenever a newline is inserted, so the canvas
    // stays in sync with the code without the user needing to press Render.
    const updateListener = EditorView.updateListener.of(update => {
      if (!update.docChanged) return
      const text = update.state.doc.toString()
      saveDoc(text)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        docVersionRef.current++
        lspRef.current?.didChange(text, docVersionRef.current)
      }, 400)

      // Detect newline insertion.
      let hasNewline = false
      update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (!hasNewline && inserted.toString().includes('\n')) hasNewline = true
      })
      if (hasNewline) {
        if (autoRenderDebounceRef.current) clearTimeout(autoRenderDebounceRef.current)
        autoRenderDebounceRef.current = setTimeout(async () => {
          autoRenderDebounceRef.current = null
          if (!lspRef.current || !connectedRef.current || autoRenderInProgressRef.current) return
          autoRenderInProgressRef.current = true
          try {
            const result = await lspRef.current.compile()
            if (result?.ok) onCompileAndRenderRef.current(result.graph)
          } catch {
            // best-effort — silently ignore auto-render failures
          } finally {
            autoRenderInProgressRef.current = false
          }
        }, 600)
      }
    })

    const view = new EditorView({
      state: EditorState.create({
        doc: loadDoc(),
        extensions: [
          basicSetup,
          ltgTheme,
          ltgLanguageSupport,
          lintGutter(),
          updateListener,
          EditorView.domEventHandlers({
            keydown(e) {
              // Let CodeMirror's search panel handle Ctrl/Cmd+F.
              if ((e.ctrlKey || e.metaKey) && e.key === 'f') e.preventDefault()
            },
          }),
        ],
      }),
      parent: containerRef.current,
    })
    viewRef.current = view

    // ── LSP client ────────────────────────────────────────────────────────
    const lsp = new LtgLspClient(
      // onDiagnostics — push into CodeMirror and update notification store
      (diagnostics: LspDiagnostic[]) => {
        const v = viewRef.current
        if (!v) return

        const cmDiags = diagnostics
          .map(d => lspToCm(d, v))
          .filter((d): d is CMDiagnostic => d !== null)

        v.dispatch(setDiagnostics(v.state, cmDiags))

        const errors   = diagnostics.filter(d => d.severity === 1).length
        const warnings = diagnostics.filter(d => d.severity === 2).length
        setDiagnosticSummary(errors + warnings > 0 ? { errors, warnings } : null)
      },
      // onConnectionChange
      (isConnected: boolean) => {
        setConnected(isConnected)
        connectedRef.current = isConnected
        if (isConnected) {
          // Send the current document to the server immediately.
          lspRef.current?.didOpen(viewRef.current?.state.doc.toString() ?? SAMPLE_DOC)
          addToast({ kind: 'success', title: 'Language server connected' }, 3000)
        } else {
          setDiagnosticSummary(null)
          addToast({ kind: 'warning', title: 'Language server offline', detail: 'Run ltg-langserver to enable diagnostics' })
        }
      },
    )
    lspRef.current = lsp
    lsp.connect()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (autoRenderDebounceRef.current) clearTimeout(autoRenderDebounceRef.current)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      lsp.didClose()
      lsp.disconnect()
      lspRef.current = null
      view.destroy()
      viewRef.current = null
      setDiagnosticSummary(null)
    }
  }, [addToast, setDiagnosticSummary])

  // ── External content injection ───────────────────────────────────────────
  // When the parent pushes new content (e.g. from the "Open in Editor" toolbar
  // button), replace the editor document and persist it to localStorage.
  useEffect(() => {
    const view = viewRef.current
    if (!view || externalContent == null) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: externalContent },
    })
    saveDoc(externalContent)
    // Notify the LSP of the new document.
    if (lspRef.current) {
      docVersionRef.current++
      lspRef.current.didChange(externalContent, docVersionRef.current)
    }
  }, [externalContent])

  // ── Live sync (canvas → code) ────────────────────────────────────────────
  // Applies a surgical line-level diff so only changed lines are rewritten.
  // Unchanged lines (user comments, manual block labels, custom formatting)
  // are left untouched. CodeMirror automatically adjusts the cursor for
  // regions outside the changed hunks — no explicit selection remapping needed.
  useEffect(() => {
    const view = viewRef.current
    if (!view || syncContent == null) return

    const currentContent = view.state.doc.toString()
    const changes = computeLtgChanges(currentContent, syncContent)

    if (changes.length === 0) return

    view.dispatch({ changes })
    saveDoc(syncContent)
    if (lspRef.current) {
      docVersionRef.current++
      lspRef.current.didChange(syncContent, docVersionRef.current)
    }

    // Flash the "↻ synced" indicator for 1.5 s.
    setSynced(true)
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => setSynced(false), 1500)
  }, [syncContent])

  // ── Explicit save ─────────────────────────────────────────────────────────
  const handleSave = () => {
    const text = viewRef.current?.state.doc.toString()
    if (text === undefined) return
    saveDoc(text)
    setSaved(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaved(false), 1500)
  }

  // ── Shared compile helper ────────────────────────────────────────────────
  const runCompile = async () => {
    if (!lspRef.current || !connected || compiling) return null
    setCompiling(true)
    try {
      return await lspRef.current.compile()
    } catch {
      addToast({ kind: 'error', title: 'Compile request failed' })
      return null
    } finally {
      setCompiling(false)
    }
  }

  // ── Compile only — validates and surfaces diagnostics ────────────────────
  const handleCompile = async () => {
    const result = await runCompile()
    if (!result) return
    if (result.ok) {
      const chars = (result.graph.characters as unknown[]).length
      const rels  = (result.graph.relationships as unknown[]).length
      addToast({
        kind:   'success',
        title:  'Compiled successfully',
        detail: `${chars} character${chars !== 1 ? 's' : ''}, ${rels} relationship${rels !== 1 ? 's' : ''}`,
      }, 5000)
    } else {
      const n = result.errors.length
      addToast({
        kind:   'error',
        title:  `Compile failed — ${n} error${n !== 1 ? 's' : ''}`,
        detail: result.errors[0]?.message,
      })
    }
  }

  // ── Compile & Render — compiles then pushes the graph to the canvas ───────
  const handleRender = async () => {
    const result = await runCompile()
    if (!result) return
    if (result.ok) {
      onCompileAndRender(result.graph)
      const chars = (result.graph.characters as unknown[]).length
      const rels  = (result.graph.relationships as unknown[]).length
      addToast({
        kind:   'success',
        title:  'Graph rendered',
        detail: `${chars} character${chars !== 1 ? 's' : ''}, ${rels} relationship${rels !== 1 ? 's' : ''}`,
      }, 5000)
    } else {
      const n = result.errors.length
      addToast({
        kind:   'error',
        title:  `Compile failed — ${n} error${n !== 1 ? 's' : ''}`,
        detail: result.errors[0]?.message,
      })
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────────
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 gap-3">

        {/* Left — title + connection dot */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-white shrink-0">LTG Editor</span>
          <span
            className={[
              'w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500',
              connected ? 'bg-green-400' : 'bg-white/20',
            ].join(' ')}
            title={connected ? 'Language server connected' : 'Language server offline'}
          />
        </div>

        {/* Right — save + compile + expand + close */}
        <div className="flex items-center gap-1 shrink-0">
          {synced && (
            <span className="text-[11px] text-white/40 px-1 select-none">↻ synced</span>
          )}

          <button
            onClick={handleSave}
            className="h-8 px-3 rounded-lg text-[11px] font-medium transition-colors
                       text-white/60 hover:text-white hover:bg-white/10 active:bg-white/20"
            aria-label="Save document"
          >
            {saved ? 'Saved ✓' : 'Save'}
          </button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          <button
            onClick={handleCompile}
            disabled={!connected || compiling}
            className="h-8 px-3 rounded-lg text-[11px] font-medium transition-colors
                       text-white/60 hover:text-white hover:bg-white/10 active:bg-white/20
                       disabled:text-white/20 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            aria-label="Compile document"
          >
            {compiling ? 'Compiling…' : 'Compile'}
          </button>

          <button
            onClick={handleRender}
            disabled={!connected || compiling}
            className="h-8 px-3 rounded-lg text-[11px] font-medium transition-colors
                       bg-white/8 text-white/80 hover:text-white hover:bg-white/15 active:bg-white/20
                       disabled:text-white/20 disabled:bg-transparent disabled:cursor-not-allowed"
            aria-label="Compile and render to canvas"
          >
            {compiling ? 'Compiling…' : 'Render'}
          </button>

          <button
            onClick={() => setExpanded(e => !e)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
            aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>

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
      <path d="M1 5V1H5"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8V12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 1L5.5 5.5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12L7.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M5 1V5H1"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 12V8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 5L1 1"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 8L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

CodeEditorPanel.displayName = 'CodeEditorPanel'
export default CodeEditorPanel
