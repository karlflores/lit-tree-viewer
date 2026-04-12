# ── Stage 1: Build ───────────────────────────────────────────────────────────
# rust:alpine uses the musl toolchain → fully static binary, no libc dependency.
FROM docker.io/library/rust:alpine AS builder

# musl-dev provides the C headers that some proc-macro crates need at compile time.
RUN apk add --no-cache musl-dev

WORKDIR /build

# Copy workspace root first so Cargo can resolve the workspace manifest.
COPY Cargo.toml Cargo.lock* ./

# Copy the crate source.
COPY ltg-langserver/ ltg-langserver/

# Build the release binary.  `-p ltg-langserver` targets just this crate in
# the workspace.  The musl toolchain produces a fully static binary.
RUN cargo build --release -p ltg-langserver

# ── Stage 2: Minimal runtime image ───────────────────────────────────────────
# scratch has no OS layer at all.  This works because the binary is statically
# linked and needs no shared libraries, shell, or other runtime support.
FROM scratch

COPY --from=builder /build/target/release/ltg-langserver /ltg-langserver

# HTTP companion + WebSocket LSP transport port.
# The stdio LSP transport is not accessible in a container; clients should use
# the WebSocket endpoint at ws://<host>:4000/ws instead.
EXPOSE 4000

ENV LTG_HTTP_ADDR=0.0.0.0:4000

ENTRYPOINT ["/ltg-langserver"]
