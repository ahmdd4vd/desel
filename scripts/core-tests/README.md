# Standalone core regression tests

Run `cargo test --manifest-path scripts/core-tests/Cargo.toml`.

The package build script supplies the harness cfg, including for doctests.
Includes the actual production agent, tools, SQLite database, model, research,
protocol and policy modules by path. A minimal IPC sink is used instead of a
native desktop webview. The Creator executor fixtures drive local HTTP SSE
through the actual agent loop, verify branch-filtered model requests, durable
interruption receipts, duplicate-ID refusal and a reviewed new continuation.
The production auth/storage modules also run local PKCE/state/nonce/JWT,
callback, token rotation and account-file tests. No real user login is attempted.
These tests do not establish a Tauri build, Windows behavior, real account
login, network provider correctness or autonomous output quality.
Tests marked ignored remain unverified. Test fixtures use local HTTP servers.
