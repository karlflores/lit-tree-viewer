//! HTTP companion server — `axum`-based.
//!
//! Endpoints:
//! - `GET  /health`  — liveness probe; always `200 {"status":"ok"}`
//! - `POST /compile` — one-shot compile; body is raw `.ltg` source text
//! - `GET  /ws`      — LSP over WebSocket; delegates to `lsp::serve_ws_session`

use axum::{
    extract::ws::WebSocketUpgrade,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;

use crate::lsp;
use crate::pipeline;

// ── Route handlers ────────────────────────────────────────────────────────────

async fn handle_health() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

async fn handle_compile(body: String) -> Response {
    let (status, value) = compile_response(&body);
    (status, Json(value)).into_response()
}

async fn handle_ws(ws: WebSocketUpgrade) -> impl IntoResponse {
    // Delegate entirely to the LSP layer — framing bridge lives in lsp.rs.
    ws.on_upgrade(lsp::serve_ws_session)
}

// ── Core compile logic (extracted for unit-testability) ───────────────────────

/// Run the LTG pipeline on `src` and return an HTTP status + JSON response body.
///
/// - Zero errors  → `200 OK` with a serialised `CompiledGraph`.
/// - Any error    → `422 Unprocessable Entity` with `{ "diagnostics": [...] }`.
///
/// Warnings do not affect the status code (graph is still returned on 200).
pub fn compile_response(src: &str) -> (StatusCode, serde_json::Value) {
    let result = pipeline::run(src);

    if result.has_errors() {
        let diagnostics: Vec<serde_json::Value> = result
            .diagnostics
            .iter()
            .map(|d| {
                json!({
                    "severity": d.severity,
                    "code":     d.code,
                    "message":  d.message,
                    "range": {
                        "start": { "line": d.start.line, "character": d.start.character },
                        "end":   { "line": d.end.line,   "character": d.end.character   },
                    }
                })
            })
            .collect();
        (StatusCode::UNPROCESSABLE_ENTITY, json!({ "diagnostics": diagnostics }))
    } else {
        let graph = result.graph.expect("graph must be Some when no errors");
        (
            StatusCode::OK,
            serde_json::to_value(&graph).expect("CompiledGraph must be serialisable"),
        )
    }
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Start the HTTP companion server on `addr`.
///
/// Runs indefinitely; intended to be spawned alongside `lsp::serve_stdio()`.
pub async fn serve(addr: SocketAddr) {
    let app = Router::new()
        .route("/health",  get(handle_health))
        .route("/compile", post(handle_compile))
        .route("/ws",      get(handle_ws));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("HTTP server error: {e}"));
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_SRC: &str =
        "metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit:";

    // ── compile_response — success path ───────────────────────────────────

    #[test]
    fn valid_program_returns_200() {
        let (status, body) = compile_response(VALID_SRC);
        assert_eq!(status, StatusCode::OK);
        // Top-level keys from CompiledGraph
        assert!(body.get("series").is_some(),        "missing series");
        assert!(body.get("characters").is_some(),    "missing characters");
        assert!(body.get("relationships").is_some(), "missing relationships");
        assert!(body.get("colours").is_some(),       "missing colours");
        assert!(body.get("blocks").is_some(),        "missing blocks");
    }

    #[test]
    fn warning_only_program_still_returns_200() {
        // UnusedColourOverride is a warning — must not produce 422.
        let src = "metadata title: \"T\"\nmetadata media: book\nset colour: unused = \"#ff0000\"\nset block: chapter\ninit:";
        let (status, body) = compile_response(src);
        assert_eq!(status, StatusCode::OK);
        assert!(body.get("series").is_some());
    }

    #[test]
    fn graph_fields_are_camel_case() {
        // Verify the JSON rename_all = "camelCase" is applied correctly.
        let (_, body) = compile_response(VALID_SRC);
        let series = &body["series"];
        assert!(series.get("totalUnits").is_some(), "expected totalUnits; got {series}");
        assert!(series.get("unitLabel").is_some(),  "expected unitLabel");
        assert!(series.get("mediaType").is_some(),  "expected mediaType");
    }

    #[test]
    fn media_type_serialises_lowercase() {
        let (_, body) = compile_response(VALID_SRC);
        assert_eq!(body["series"]["mediaType"].as_str(), Some("book"));
    }

    #[test]
    fn compiled_graph_total_units_correct() {
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit:\nnew chapter:\nnew chapter:";
        let (_, body) = compile_response(src);
        assert_eq!(body["series"]["totalUnits"].as_u64(), Some(3));
    }

    // ── compile_response — error path ─────────────────────────────────────

    #[test]
    fn empty_source_returns_422() {
        let (status, body) = compile_response("");
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(body.get("diagnostics").is_some());
        let diags = body["diagnostics"].as_array().unwrap();
        assert!(!diags.is_empty());
    }

    #[test]
    fn parse_error_returns_422() {
        // `init` without `:` is a parse error.
        let src = "metadata title: \"T\"\nmetadata media: book\nset block: chapter\ninit";
        let (status, _) = compile_response(src);
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn diagnostic_objects_have_required_fields() {
        let (_, body) = compile_response("");
        let d = &body["diagnostics"][0];
        assert!(d.get("severity").is_some(), "missing severity");
        assert!(d.get("code").is_some(),     "missing code");
        assert!(d.get("message").is_some(),  "missing message");
        assert!(d.get("range").is_some(),    "missing range");
        let range = &d["range"];
        assert!(range.get("start").is_some(), "missing range.start");
        assert!(range.get("end").is_some(),   "missing range.end");
        assert!(range["start"].get("line").is_some(),      "missing start.line");
        assert!(range["start"].get("character").is_some(), "missing start.character");
    }

    #[test]
    fn diagnostic_severity_values_are_integers() {
        let (_, body) = compile_response("");
        for d in body["diagnostics"].as_array().unwrap() {
            let sev = d["severity"].as_u64();
            assert!(sev.is_some(), "severity is not an integer: {}", d["severity"]);
            assert!(sev.unwrap() == 1 || sev.unwrap() == 2, "unexpected severity {sev:?}");
        }
    }

    #[test]
    fn missing_metadata_produces_422_with_missing_metadata_code() {
        let src = "set block: chapter\ninit:"; // missing title and media
        let (status, body) = compile_response(src);
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        let codes: Vec<_> = body["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["code"].as_str().unwrap_or(""))
            .collect();
        assert!(codes.contains(&"MissingMetadata"), "expected MissingMetadata in {codes:?}");
    }
}
