# Account routes and implementation status

Development checkpoint,24October2026. No real account sign-in or vendor inference is qualified by the local tests.

## Available provider management
- Built-in runtime, API presets and custom Chat/Anthropic endpoints.
- Native Store search, exact-version plugin installation with executable-code consent, installed enable/remove and confirmed update controls.
- Community-plugin auto-update is opt-in; disabling pins the runtime-reported installed version. Controlled local package/version transitions were tested. Automatic arrival of a newly published version is unverified.
- Masked account/key rows support priority, pause/resume and local removal. Local removal is not vendor-session revocation.
- Plugin prompt/browser/callback/status/cancel APIs exist, but provider-specific permission and real-account qualification remain necessary.

## Official ChatGPT local/open-source route
Own public-client registration uses the app name, stable per-host ID, fresh PKCE/state/nonce and an owned loopback callback. Issued client identity, signed ID-token issuer/audience/expiry/nonce/subject and granted plan scope are checked separately. A valid identity-only account does not authorize inference.

Unix credential writes are atomic with owner-only files. Windows credential records use current-user DPAPI with UI forbidden and atomic encrypted replacement. A session file lock serializes rotating refresh operations across processes. Refresh validates any returned replacement identity before replacing the full token set. Account list projections contain labels/readiness only, never tokens. Signout source preserves non-secret registration mapping and reports whether remote revocation was confirmed.

Only account status/list is registered in the native command handler. Start/cancel/signout code is not registered and no login button is exposed. Real sign-in must remain disabled until the complete selected-account lifecycle, cancellation, storage and inference route are reviewed. DPAPI bindings and test contracts cross-compile; they have not run on Windows. Full Windows auth cross-compilation additionally requires an available Windows C compiler for cryptography dependencies.

The Responses adapter preserves supported completed output, encrypted reasoning and tool-call order across scoped history. It fails closed on incomplete or unsupported output and uses the existing reviewed executor in tests. Production selection is disabled. Capability mapping, progressive UI, durable resume end-to-end and authorized live inference remain pending.

Do not borrow another application's client registration or silently import CLI credentials. Keep API-key billing and ChatGPT plan usage distinct. Direct plan use can consume shared plan limits or credits.

## Claude Code
An official unmodified binary or supported SDK agent adapter needs its own native authentication handoff, process cancellation, isolated workspace, permission UI and narrowly scoped Desel tool bridge. Subscription credentials must not become Desel gateway keys. A terminal window is not a replacement for reviewed slide-tool execution. This adapter is not implemented; Claude API is the separate available route.

Sources:
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://auth.openai.com/.well-known/openid-configuration
- https://developers.openai.com/api/docs/guides/streaming-responses
- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/headless
