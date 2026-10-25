# Desel — AI Carousel Studio

Desktop app for designing carousel posts (TikTok / Instagram / LinkedIn) with an
AI agent instead of a template gallery. Tauri 2 + Rust backend, React 19
frontend.

The model does not fill slots. It **writes real HTML/CSS/SVG for every slide**,
can research the web before writing, can ask clarifying questions, and can save
a finished deck as a reusable design system.


## How it works

1. **You chat.** The left panel is a conversation, not a form. Briefs, revisions
   and criticism all happen there.
2. **The agent works.** It calls tools over a streaming loop: research the web,
   read the current deck, set the art direction, write slides one by one, ask a
   question when the brief is genuinely ambiguous.
3. **You review and edit.** The canvas behaves like a design tool: scroll to
   zoom (anchored on the cursor), space-drag or drag the empty space to pan,
   `0` fits, `1` is 100%, double-click empty canvas to fit again. Click any
   element in the slide and it is selected, with its selector and box shown;
   double-click text to edit it in place — the change is written back to the
   slide's HTML, saved, and kept as a restorable version. Comments are pinned to
   a point *and* to the element under it, so "this headline is too small" sticks
   to the actual spot and reaches the agent with its selector.
   Every slide is also checked mechanically against the anti-slop rules —
   palette, texture, focal point, forbidden gradients and emoji — and the
   findings appear on the thumbnail and in the inspector. The agent receives
   the same findings as tool output and fixes them in the same turn.
   Any rewrite keeps the previous wording: the inspector lists recent versions
   per slide and can restore one, so prior wording remains available within the retained history. The same
   applies to edits the agent makes — they are saved through the same path.
   Each finished turn keeps its receipts: a collapsed "n langkah" line under the
   reply lists every tool the agent used, with the exact result it received.
   Revisions read before they write (`read_deck` with `index`), so the agent
   changes the real design instead of guessing at it.
4. **You export.** PNG per slide, PDF of the deck, and a caption file, rendered
   from exactly the same HTML you were looking at.

Templates are optional and one-directional: saving a deck stores its slides and
style guide as a starting point, but nothing in the generator depends on it.

A hand-written example deck ships with the app (**Proyek → Contoh**). It is not
generated, it uses the same HTML/CSS pipeline, and it is expected to pass the
same automated design review with zero findings — a concrete answer to "what
does good output look like here?" before you have configured a model.

## Canvas

The artboard is not a screenshot — it is a transformed layer with the live slide
inside, so what you click is the real DOM:

| gesture | result |
| --- | --- |
| scroll / pinch | zoom, anchored on the pointer |
| space + drag, middle drag, drag empty space | pan |
| `0` / `1` / `+` / `-` | fit · 100% · step zoom |
| click | select the element (outline + selector + size) |
| double-click text | edit in place, `Ctrl+Enter` or `Esc` commits |
| `C`, or the note tool | arm comments, click anywhere to drop a pin |
| `Esc` | leave the tool |

Pins are stored as a fraction of the artboard plus the element path, so they stay
on the right spot at any zoom, any aspect, and after the slide is rewritten.

## Visual references

Attach covers you like from the chat panel: pick files from disk, or press
**Link** and paste an image URL (a Pinterest pin's image address, a Dribbble
shot, anything that resolves to an image). Each one is analysed on import:

- **Every model** receives a text descriptor — dominant palette, brightness,
  contrast, dimensions — so a text-only model can still respect the look.
- **Vision models** (`Model bisa melihat gambar` in settings) additionally
  receive the image bytes themselves.

The prompt tells the model to copy the *grammar* of a reference (type scale,
density, grid logic, texture treatment, colour discipline), never its text or
artwork.

Project menu actions include whole-project undo/redo, local recovery copies,
portable `.desel.json` backup/restore, and a best-effort restart draft prompt.
Recovery never silently replaces the newer database version. History is bounded;
portable files intentionally exclude settings/API keys/accounts/chat/history.
See [project history](docs/PROJECT-HISTORY.md), [portable format](docs/PROJECT-FORMAT.md)
and [static slide safety](docs/STATIC-SLIDES.md) for limits and test status.
The canvas/export supports4:5,1:1,9:16 and16:9. Native Windows verification is
still pending; browser export checks do not prove Windows behavior.

## Persistence

Saved project content lives in a local SQLite database. Unsaved changes still
need a successful save; storage failures are shown persistently:

```
%APPDATA%\com.desel.carousel\desel.db
```

Tables: `settings`, `decks`, `messages`, `templates`, `comments`, `assets`.
That includes the provider API key, so the app reopens configured.

## Architecture

| Layer | Where | Responsibility |
|---|---|---|
| Agent loop | `src-tauri/src/agent.rs` | SSE streaming, tool calls, prompt assembly |
| Tools | `src-tauri/src/tools.rs` | `write_slide`, `set_deck_meta`, `search_web`, `fetch_url`, `ask_user`, templates |
| Research | `src-tauri/src/research.rs` | DuckDuckGo search, page text extraction |
| Reference analysis | `src-tauri/src/palette.rs` | Palette / luminance / contrast descriptors |
| Storage | `src-tauri/src/db.rs` | SQLite schema and queries |
| Commands | `src-tauri/src/commands.rs` | Command surface exposed to React |
| UI | `src/App.tsx`, `src/state/studio.ts` | Chat, canvas, rail, inspector, annotations |

A slide is a self-contained HTML document rendered in a sandboxed iframe, which
is why preview and export cannot drift apart.

## Running it

```bash
npm install
npm run prepare:runtime # developer build: download pinned, hash-verified bundled runtime
npm run dev      # Tauri desktop app (Rust + Vite)
npm run build    # production bundle
```

Frontend only, in a browser (uses a localStorage shim — useful for UI work):

```bash
npm run dev:vite
```

Then open **Pengaturan** (Ctrl+,) and pick a provider chip — it fills the base
URL and a sensible default model. Paste an API key, done. Any OpenAI-compatible
endpoint works; settings are written to SQLite immediately.

| Provider | Base URL | Default model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` |

## Keyboard shortcuts

| shortcut | action |
| --- | --- |
| `Ctrl + S` | save project |
| `Ctrl + E` | export |
| `Ctrl + ,` | settings |
| `Enter` | send message (`Shift+Enter` for a new line) |
| `Esc` | close modal / cancel comment pin |

## Development

Requirements: Node 20+, Rust (stable, MSVC toolchain), and Windows for the
WebView2 desktop shell. The frontend also runs in a plain browser against a
localStorage shim, which is how most UI work here is done.

```bash
npm install
npm run dev        # Tauri window + Vite (auto-reloads on Rust changes)
npm run dev:vite   # browser only, http://localhost:1420
```

Test harness (no API key needed — a scripted OpenAI-compatible server stands in):

```bash
node scripts/mock-provider.mjs                    # port 9001, streams slides
node scripts/e2e-canvas.mjs                       # zoom/pan/pick/pin/inline edit
node scripts/e2e-first-run.mjs                    # boot state + panels
node scripts/e2e-generate.mjs                     # agent loop end to end
node scripts/e2e-export.mjs                       # PNG/PDF export
```

The `e2e-*` scripts drive the real app over CDP (`--remote-debugging-port=9222`),
so start the app first. `scripts/mock-edge.mjs` covers the awkward paths: a model
that asks a question first (9002) and one whose key is rejected (9003).

Working in this repo: branch per change, keep `npm run typecheck` and
`cargo test --lib` green, and prefer the design rules in `docs/DESIGN.md` over
adding a dependency.

## Checks

```bash
npm run typecheck                                        # frontend types
cargo test --manifest-path src-tauri/Cargo.toml --lib     # backend
 # Ignored live tests require separate explicit review and may call paid providers.
npm run build:vite                                       # production bundle
```

The suite covers the persistence round trip, the database upgrade path from
older installs, reference-image analysis against the real covers in
`referensi/`, prompt assembly with and without vision, the anti-slop rules
(applied to a crafted editorial slide and to a deliberately generic one), the
worked example inside the system prompt (it has to score zero findings, since it
is what the model imitates), conversation trimming, the full agent loop against
a throwaway SSE server, and the agent's write path from an empty deck to a saved
template. Ignored tests may use real network services or paid providers. Do not run the ignored suite without reviewing its scope and supplying your own test configuration.

## Limits worth knowing

- Slides are static HTML: no JavaScript, no external images. All artwork is CSS
  or inline SVG, which is what keeps export pixel-identical.
- Fonts are Windows system fonts (the app runs in WebView2).
- Reference images are capped at 8 MB each; vision sends at most four.
- Long conversations are trimmed to the newest turns that fit roughly 15k tokens.
  When that happens the model is told so and can re-read the deck with a tool
  instead of guessing what was cut.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the reasoning behind these choices.

## Provider checkpoint status

Desel includes the provider runtime in its packaged application. Developers run `npm run prepare:runtime` before direct Cargo commands; Tauri dev/build also runs this step. Official Linux x86_64 and Windows x86_64 binaries are downloaded at build preparation, checked against pinned SHA-256 values and copied into the app resources. End users do not need a separate Magpie installation. ARM/macOS are not bundled by this checkpoint.

Native provider/API/account/plugin management is available in Desel Connect. Plugin code needs explicit trust consent; auto-update is opt-in per supported community plugin. No third-party login plugin is preinstalled.

Official ChatGPT local/open-source account code is in progress. Only secret-free status reads are registered; start/cancel/signout source is not exposed. Responses remains a test-only agent route. Claude Code agent integration is not implemented. This is a development checkpoint, not a release-ready claim. Native Windows launch, real account sign-in/inference, native IPC and automatic new-version arrival remain unverified.

See [provider behavior](docs/PROVIDERS.md) and [account routes](docs/ACCOUNT-ROUTES.md).

Local asset reuse and separate source/credit/rights/alt-text notes are described
in [ASSET-LIBRARY](docs/ASSET-LIBRARY.md). Export checks exact rendered revisions
and requires explicit warning acknowledgement: [EXPORT-PREFLIGHT](docs/EXPORT-PREFLIGHT.md).
Selected HTML objects can be listed and edited without changing flow layouts into
free-positioned objects: [OBJECT-EDITOR](docs/OBJECT-EDITOR.md).

Local browser regressions (no account/network inference): `npm ci`, then
`CHROME_PATH=/path/to/chrome npm run test:ui`. Artifacts go to the OS temp
`desel-ui-regressions` directory; set `DESEL_QA_OUTPUT` to choose another folder.
The runner uses port1422; keep that port free. `npm run test:editor` checks merge
and draft contracts without a browser. Native Rust tests remain a separate step.
