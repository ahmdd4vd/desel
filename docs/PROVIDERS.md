# Built-in providers and Store

Desel bundles pinned official Magpie v0.1.1404 for Linux/Windows x86_64. No separate Magpie installation needed. Open Settings > Provider & Plugin Store for Desel-native catalog, API providers, account controls, installed plugins and updates. Model/workspace settings are separate. Runtime starts automatically; loopback details are advanced diagnostics.

Catalog is community data, not a security audit or vendor approval. Choose exact plugin version and confirm executable-code trust. Plugin install may obtain Bun and has access to process/files/accounts. Automatic updates require separate per-installed-community-plugin consent, switching package to @latest; disable locks actual installed semver. Paused plugins do not auto-update until enabled. Runtime application updates are disabled separately. No catalog plugin preinstalled or executed in qualification.

API keys live in local runtime config, not OS-encrypted by Desel. Manager auth stays Rust-side. Response projections remove secrets and expose only masked key/account fingerprints. Local account/key removal is not vendor-session revocation.

Local qualification covers28isolated runtime checks using inert authored fixtures plus browser response-replay UI checks. Native IPC/desktop/Windows and real vendor auth remain unverified. Official own-client SIWC account code and Responses integration are incomplete and disabled for production selection; Claude Code agent integration is absent. See ACCOUNT-ROUTES.md. No third-party subscription token routing is offered.
