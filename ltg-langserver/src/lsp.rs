//! LSP server implementation using `tower-lsp`.
//!
//! Responsibilities:
//! - Track open documents in an in-memory store.
//! - Run the full LTG pipeline on every open/change event and push
//!   `textDocument/publishDiagnostics` to the client.
//! - Handle `workspace/executeCommand: ltg.compile` by returning the
//!   `CompiledGraph` as a JSON value (only when the file has no errors).
//! - Export `serve_stdio()` for the VSCode extension / CLI transport.
//! - Export `serve_ws_session()` for the WebSocket transport used by the
//!   browser Monaco editor (called from `http.rs`'s `GET /ws` handler).
//!
//! WebSocket framing:
//! The browser sends and receives bare JSON text frames (no Content-Length
//! header), as expected by `monaco-languageclient`.  This module bridges those
//! frames to the Content-Length-delimited byte stream that `tower-lsp`'s
//! `Server` requires, using a `tokio::io::duplex` pipe pair and two bridge
//! tasks running alongside the server.

use axum::extract::ws::{Message, WebSocket};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower_lsp::jsonrpc::{Error as RpcError, Result as RpcResult};
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

use crate::pipeline::{self, Diagnostic as PipelineDiagnostic};

// ── Backend ───────────────────────────────────────────────────────────────────

/// The LSP backend.  One instance is shared across all requests.
pub struct Backend {
    client: Client,
    /// Document URI → current source text.
    docs: DashMap<Url, String>,
}

impl Backend {
    pub fn new(client: Client) -> Self {
        Self { client, docs: DashMap::new() }
    }

    /// Run the pipeline on `src` and push diagnostics for `uri`.
    async fn recheck(&self, uri: Url, src: String) {
        let result = pipeline::run(&src);
        let lsp_diags: Vec<tower_lsp::lsp_types::Diagnostic> =
            result.diagnostics.iter().map(|d| lsp_diagnostic(d, &src)).collect();
        self.client.publish_diagnostics(uri, lsp_diags, None).await;
    }
}

// ── LanguageServer impl ───────────────────────────────────────────────────────

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _params: InitializeParams) -> RpcResult<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                execute_command_provider: Some(ExecuteCommandOptions {
                    commands: vec!["ltg.compile".to_string()],
                    work_done_progress_options: Default::default(),
                }),
                ..Default::default()
            },
            server_info: Some(ServerInfo {
                name:    "ltg-langserver".to_string(),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
            }),
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, "ltg-langserver initialized")
            .await;
    }

    async fn shutdown(&self) -> RpcResult<()> {
        Ok(())
    }

    // ── Text document synchronisation ─────────────────────────────────────

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let uri = params.text_document.uri;
        let text = params.text_document.text;
        self.docs.insert(uri.clone(), text.clone());
        self.recheck(uri, text).await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        // FULL sync — the single element in `content_changes` is the whole file.
        if let Some(change) = params.content_changes.into_iter().next() {
            let text = change.text;
            self.docs.insert(uri.clone(), text.clone());
            self.recheck(uri, text).await;
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        let uri = params.text_document.uri;
        self.docs.remove(&uri);
        // Clear any stale diagnostics so the editor shows a clean slate.
        self.client.publish_diagnostics(uri, vec![], None).await;
    }

    // ── Commands ──────────────────────────────────────────────────────────

    async fn execute_command(
        &self,
        params: ExecuteCommandParams,
    ) -> RpcResult<Option<serde_json::Value>> {
        if params.command != "ltg.compile" {
            return Err(RpcError::method_not_found());
        }

        // Expect a single string argument: the document URI.
        let uri_str = params
            .arguments
            .into_iter()
            .next()
            .and_then(|v| v.as_str().map(str::to_string))
            .ok_or_else(|| RpcError::invalid_params("expected a document URI as first argument"))?;

        let uri = uri_str
            .parse::<Url>()
            .map_err(|_| RpcError::invalid_params("argument is not a valid URI"))?;

        let src = self
            .docs
            .get(&uri)
            .map(|r| r.clone())
            .ok_or_else(|| RpcError::invalid_params("document not open in this session"))?;

        let result = pipeline::run(&src);

        if result.has_errors() {
            // Return the diagnostics so the caller knows why compilation failed.
            let diags: Vec<serde_json::Value> = result
                .diagnostics
                .iter()
                .map(|d| {
                    serde_json::json!({
                        "severity": d.severity,
                        "code":     d.code,
                        "message":  d.message,
                    })
                })
                .collect();
            return Ok(Some(serde_json::json!({ "errors": diags })));
        }

        // graph is Some because has_errors() was false and the pipeline compiled.
        let graph = result.graph.expect("graph must be Some when no errors");
        Ok(Some(serde_json::to_value(&graph).map_err(|_| RpcError::internal_error())?))
    }
}

// ── Diagnostic conversion ─────────────────────────────────────────────────────

/// Convert a pipeline `Diagnostic` to an LSP `Diagnostic`.
///
/// Both types use 0-based line/character coordinates; no adjustment needed.
pub fn lsp_diagnostic(
    d: &PipelineDiagnostic,
    _src: &str,
) -> tower_lsp::lsp_types::Diagnostic {
    let severity = match d.severity {
        1 => DiagnosticSeverity::ERROR,
        2 => DiagnosticSeverity::WARNING,
        _ => DiagnosticSeverity::INFORMATION,
    };

    tower_lsp::lsp_types::Diagnostic {
        range: Range {
            start: lsp_position(&d.start),
            end:   lsp_position(&d.end),
        },
        severity: Some(severity),
        code: Some(NumberOrString::String(d.code.clone())),
        source: Some("ltg-langserver".to_string()),
        message: d.message.clone(),
        ..Default::default()
    }
}

fn lsp_position(p: &pipeline::Position) -> tower_lsp::lsp_types::Position {
    tower_lsp::lsp_types::Position {
        line:      p.line as u32,
        character: p.character as u32,
    }
}

// ── Public entry points ───────────────────────────────────────────────────────

/// Start the LSP server on stdin/stdout (VSCode extension and CLI transport).
pub async fn serve_stdio() {
    let stdin  = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let (service, socket) = LspService::new(Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}

/// Run a single LSP session over an already-upgraded WebSocket connection.
///
/// Called from the `GET /ws` axum handler in `http.rs`.  Each connection gets
/// its own `Backend` instance with an isolated document store.
///
/// Bridge architecture:
/// ```text
///   WS frames (bare JSON)
///       ↕
///   inbound / outbound tasks (add / strip Content-Length headers)
///       ↕
///   tokio::io::duplex pipe
///       ↕
///   tower-lsp Server (Content-Length framing)
/// ```
pub async fn serve_ws_session(socket: WebSocket) {
    // `tokio::io::duplex` creates two connected halves:
    //   write to bridge_half  →  server_half reads it  (WS → LSP)
    //   write to server_half  →  bridge_half reads it  (LSP → WS)
    let (bridge_half, server_half) = tokio::io::duplex(65_536);
    let (server_read, server_write) = tokio::io::split(server_half);
    let (mut bridge_read, mut bridge_write) = tokio::io::split(bridge_half);

    let (mut ws_tx, mut ws_rx) = socket.split();

    // Task 1: WS text/binary frames → LSP byte stream
    // Each frame becomes one JSON-RPC message preceded by a Content-Length header.
    let inbound = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            let data: Vec<u8> = match msg {
                Message::Text(t)   => t.as_bytes().to_vec(),
                Message::Binary(b) => b.to_vec(),
                Message::Close(_)  => break,
                _                  => continue, // ping/pong — ignore
            };
            let header = format!("Content-Length: {}\r\n\r\n", data.len());
            if bridge_write.write_all(header.as_bytes()).await.is_err() { break; }
            if bridge_write.write_all(&data).await.is_err() { break; }
        }
    });

    // Task 2: LSP byte stream → WS text frames
    // Each Content-Length-framed response is stripped of its header and sent as
    // a single bare JSON text frame.
    let outbound = tokio::spawn(async move {
        'outer: loop {
            // Accumulate header bytes until \r\n\r\n.
            let mut header_bytes: Vec<u8> = Vec::new();
            loop {
                let mut byte = [0u8; 1];
                if bridge_read.read_exact(&mut byte).await.is_err() { break 'outer; }
                header_bytes.push(byte[0]);
                if header_bytes.ends_with(b"\r\n\r\n") { break; }
            }

            // Parse Content-Length value.
            let header_str = match std::str::from_utf8(&header_bytes) {
                Ok(s)  => s.to_string(),
                Err(_) => break,
            };
            let content_length: usize = header_str
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|v| v.trim().parse().ok())
                })
                .unwrap_or(0);

            if content_length == 0 { continue; }

            // Read the JSON body and forward as a WS text frame.
            let mut body = vec![0u8; content_length];
            if bridge_read.read_exact(&mut body).await.is_err() { break; }
            let text = match String::from_utf8(body) {
                Ok(s)  => s,
                Err(_) => break,
            };
            if ws_tx.send(Message::Text(text.into())).await.is_err() { break; }
        }
    });

    // Run the LSP server for this connection.
    let (lsp_service, messages) = LspService::new(Backend::new);
    Server::new(server_read, server_write, messages)
        .serve(lsp_service)
        .await;

    inbound.abort();
    outbound.abort();
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::{Diagnostic as PD, Position as PP};

    fn make_diag(severity: u8, code: &str, message: &str, sl: usize, sc: usize, el: usize, ec: usize) -> PD {
        PD {
            severity,
            code:    code.to_string(),
            message: message.to_string(),
            start:   PP { line: sl, character: sc },
            end:     PP { line: el, character: ec },
        }
    }

    // ── lsp_diagnostic conversion ─────────────────────────────────────────

    #[test]
    fn error_severity_maps_to_lsp_error() {
        let d = make_diag(1, "SyntaxError", "oops", 0, 0, 0, 3);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.severity, Some(DiagnosticSeverity::ERROR));
    }

    #[test]
    fn warning_severity_maps_to_lsp_warning() {
        let d = make_diag(2, "UnusedColourOverride", "unused", 3, 5, 3, 20);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.severity, Some(DiagnosticSeverity::WARNING));
    }

    #[test]
    fn unknown_severity_maps_to_lsp_information() {
        let d = make_diag(9, "Unknown", "hmm", 0, 0, 0, 1);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.severity, Some(DiagnosticSeverity::INFORMATION));
    }

    #[test]
    fn code_preserved_as_string_variant() {
        let d = make_diag(1, "MissingMetadata", "msg", 0, 0, 0, 5);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.code, Some(NumberOrString::String("MissingMetadata".to_string())));
    }

    #[test]
    fn source_is_ltg_langserver() {
        let d = make_diag(1, "X", "y", 0, 0, 0, 1);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.source, Some("ltg-langserver".to_string()));
    }

    #[test]
    fn range_positions_converted() {
        let d = make_diag(1, "X", "y", 2, 4, 2, 9);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.range.start.line,      2);
        assert_eq!(lsp.range.start.character, 4);
        assert_eq!(lsp.range.end.line,        2);
        assert_eq!(lsp.range.end.character,   9);
    }

    #[test]
    fn message_preserved() {
        let d = make_diag(1, "X", "tab character is not allowed", 0, 0, 0, 1);
        let lsp = lsp_diagnostic(&d, "");
        assert_eq!(lsp.message, "tab character is not allowed");
    }

    // ── lsp_position ──────────────────────────────────────────────────────

    #[test]
    fn lsp_position_converts_usize_to_u32() {
        let p = PP { line: 10, character: 42 };
        let lsp = lsp_position(&p);
        assert_eq!(lsp.line,      10_u32);
        assert_eq!(lsp.character, 42_u32);
    }

    #[test]
    fn lsp_position_origin() {
        let p = PP { line: 0, character: 0 };
        let lsp = lsp_position(&p);
        assert_eq!(lsp.line,      0);
        assert_eq!(lsp.character, 0);
    }
}
