use ltg_langserver::{http, lsp};
use std::net::SocketAddr;

/// Run the LSP stdio server and the HTTP companion server concurrently on the
/// same Tokio runtime.
///
/// The HTTP address defaults to `0.0.0.0:4000` and can be overridden with the
/// `LTG_HTTP_ADDR` environment variable.
#[tokio::main]
async fn main() {
    let http_addr: SocketAddr = std::env::var("LTG_HTTP_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:4000".into())
        .parse()
        .expect("LTG_HTTP_ADDR must be a valid socket address (e.g. 0.0.0.0:4000)");

    tokio::join!(
        lsp::serve_stdio(),
        http::serve(http_addr),
    );
}
