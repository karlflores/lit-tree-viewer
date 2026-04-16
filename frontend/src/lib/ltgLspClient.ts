// ---------------------------------------------------------------------------
// LTG Language Server — WebSocket LSP client
//
// Transport: bare JSON text frames over WebSocket (no Content-Length header).
// Protocol:  JSON-RPC 2.0, LSP subset (initialize, textDocument/*, workspace/executeCommand).
// ---------------------------------------------------------------------------

export const SYNTHETIC_URI = 'file:///untitled.ltg'
const WS_URL               = 'ws://localhost:4000/ws'

// ---------------------------------------------------------------------------
// LSP types (only the subset we consume)
// ---------------------------------------------------------------------------

export type LspPosition = {
  line:      number   // 0-based
  character: number   // 0-based
}

export type LspRange = {
  start: LspPosition
  end:   LspPosition
}

export type LspDiagnostic = {
  range:    LspRange
  severity: number    // 1=error 2=warning 3=info
  code:     string
  source:   string
  message:  string
}

// Result of workspace/executeCommand { command: "ltg.compile" }
export type CompileSuccess = {
  series:        unknown
  characters:    unknown[]
  relationships: unknown[]
  colours:       Record<string, string>
  blocks:        unknown[]
}

export type CompileFailure = {
  errors: Array<{ severity: number; code: string; message: string }>
}

export type CompileResult =
  | { ok: true;  graph:  CompileSuccess }
  | { ok: false; errors: CompileFailure['errors'] }

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type PendingRequest = {
  resolve: (value: unknown) => void
  reject:  (reason: unknown) => void
}

export type DiagnosticsHandler    = (diagnostics: LspDiagnostic[]) => void
export type ConnectionHandler     = (connected: boolean) => void

export class LtgLspClient {
  private ws:          WebSocket | null = null
  private nextId:      number           = 1
  private pending:     Map<number, PendingRequest> = new Map()
  private ready:       boolean          = false

  private readonly onDiagnostics:    DiagnosticsHandler
  private readonly onConnectionChange: ConnectionHandler

  constructor(
    onDiagnostics:     DiagnosticsHandler,
    onConnectionChange: ConnectionHandler,
  ) {
    this.onDiagnostics     = onDiagnostics
    this.onConnectionChange = onConnectionChange
  }

  // ── Public lifecycle ────────────────────────────────────────────────────

  connect(): void {
    if (this.ws) return

    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL)
    } catch {
      // WebSocket constructor throws in environments where WS is blocked.
      this.onConnectionChange(false)
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.sendHandshake()
        .then(() => {
          this.ready = true
          this.onConnectionChange(true)
        })
        .catch(() => {
          // Handshake failed — close and report disconnected.
          ws.close()
        })
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      this.handleFrame(event.data)
    }

    ws.onclose = () => {
      this.ws    = null
      this.ready = false
      this.pending.forEach(({ reject }) => reject(new Error('WebSocket closed')))
      this.pending.clear()
      this.onConnectionChange(false)
    }

    ws.onerror = () => {
      // onclose fires after onerror; we report disconnected there.
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  // ── Document sync ────────────────────────────────────────────────────────

  didOpen(text: string): void {
    if (!this.ready) return
    this.notify('textDocument/didOpen', {
      textDocument: { uri: SYNTHETIC_URI, languageId: 'ltg', version: 1, text },
    })
  }

  didChange(text: string, version: number): void {
    if (!this.ready) return
    this.notify('textDocument/didChange', {
      textDocument:   { uri: SYNTHETIC_URI, version },
      contentChanges: [{ text }],
    })
  }

  didClose(): void {
    if (!this.ready) return
    this.notify('textDocument/didClose', {
      textDocument: { uri: SYNTHETIC_URI },
    })
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  async compile(): Promise<CompileResult> {
    const result = await this.request('workspace/executeCommand', {
      command:   'ltg.compile',
      arguments: [SYNTHETIC_URI],
    })

    // The server returns CompiledGraph on success, { errors: [...] } on failure.
    const r = result as Record<string, unknown>
    if (Array.isArray(r?.errors)) {
      return { ok: false, errors: r.errors as CompileFailure['errors'] }
    }
    return { ok: true, graph: result as CompileSuccess }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private handleFrame(data: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }

    // Response to a pending request (has id, no method).
    if ('id' in msg && !('method' in msg)) {
      const handler = this.pending.get(msg.id as number)
      if (!handler) return
      this.pending.delete(msg.id as number)
      if ('error' in msg) {
        handler.reject(msg.error)
      } else {
        handler.resolve(msg.result)
      }
      return
    }

    // Server-initiated notification.
    if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params as { diagnostics?: LspDiagnostic[] }
      this.onDiagnostics(params.diagnostics ?? [])
    }
  }

  private async sendHandshake(): Promise<void> {
    await this.request('initialize', {
      processId:  null,
      clientInfo: { name: 'ltg-web-editor', version: '0.1.0' },
      rootUri:    null,
      capabilities: {
        textDocument: {
          synchronization:   { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: {
          executeCommand: { dynamicRegistration: false },
        },
      },
    })
    this.notify('initialized', {})
  }
}
