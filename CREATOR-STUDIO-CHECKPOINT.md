# Creator Studio local development checkpoint

Baseline: 8704c410353a03ccbb5a9cf92f8369d15ad62e8c.
No push, deployment, release or external inference performed.

## Implemented
- Safe GFM Markdown with no active HTML, unsafe URLs or auto-loaded image pixels.
- Copy, quote, reuse, search and per-project persisted composer drafts.
- Saved manual brief queue, explicit discussion/edit/production mode, slide and
  asset context, locked slides with executor-side mode/slide enforcement.
- Editable/pinnable/deletable project memory with source fields; bounded,
  relevance-ranked memory selection and advertised-model context budgeting.
- SQLite run/tool journal, atomic user-turn insertion, duplicate tool-ID refusal,
  single per-project writer lease, incomplete history pair reconciliation.
- Interrupted run view prepares a new reviewed continuation, never blind replay.
- Production desk prepares read-only narrative/source/visual review briefs.
- Export bundle includes project manifest, memory, asset provenance and caption,
  without credentials or hidden conversations.
- Reproducible standalone core-test crate under scripts/core-tests.

## Verification
126 pre-existing browser fixture scenarios passed in bounded batches.
New creator-chat and creator-contracts scenarios passed.
TypeScript, editor contracts and Vite build passed (bundle-size warning remains).
Actual source core Rust harness: 121 passed, 11 ignored.
Full native cargo blocked at missing glib development libraries before app code.
Commands syntax parsed using rustfmt, not fully compiled with Tauri.
Actual UI screenshots inspected at 1600x1000.

## Added in continuation run 4
- Object-level locks: any canvas element can be locked from agent edits ("Kunci objek"
  in the object panel). Locks are selector-identified per slide, persist in the Creator
  workspace (native mirror + project-file transfer with slide-ID remap), ride in the
  request scope, and are enforced executor-side: patch ops touching the locked element,
  its descendants, or (destructively) its ancestors are refused; full-slide rewrites must
  keep every locked element present and byte-identical; deleting a slide with locks and
  global template/meta changes are refused while any lock exists. Stale locks (element
  removed by hand) do not block. Appending siblings next to a locked element stays allowed.
- Rust harness: 138 passed / 11 ignored. UI regression: 133 scenarios including
  object-lock-test. tsc clean. Native Tauri commands still not Tauri-compiled.

## Added in continuation run
- Conversation branches: fork at a user turn, sibling switcher, active-path-only history
  to the agent (native Db::active_history), SQLite persistence, UI + UI test.
- Native SQLite mirror of the Creator workspace (draft/queue/memory) with write-through
  and validated hydrate when the WebView copy is missing. Import of that mirror from a
  transferred project file is NOT done. Native commands are not Tauri-compiled.
- Standalone Rust harness: 123 passed / 11 ignored. UI regression: 129 + workspace-mirror test.

## Added in continuation run 5
- Token accounting, budgeting and compaction: new native tokens module with
  content-aware calibrated estimates (CJK ~1 token/char, dense markup ~3
  chars/token, prose ~4, per-message overhead). History fitting is now
  token-budgeted (default 15k tokens; capability-window budget uses
  window minus output reserve, ceiling 60k) instead of character heuristics.
  Dropped turns are compacted into a deterministic local summary (user asks,
  assistant tool names, bounded to 400 estimated tokens, remainder noted) and
  injected with the truncation note; no extra inference call. A perf test
  covers fitting a 5,000-turn history.
- Rust harness: 145 passed / 11 ignored. No UI change; the 133-scenario UI
  regression is unaffected and was not re-run. Native Tauri compile still
  blocked on glib; tokens.rs compiled via the harness.

## Added in continuation run 5 (second half)
- Platform variants: changing the project format now offers "Buat varian
  terskala" alongside canvas-only. The variant wraps each slide's body content
  in a stage scaled uniformly to fit and centered on the new canvas; nothing
  is cropped, the original document (head styles, body inline style, classes)
  is preserved inside the stage, the body background moves to the canvas so
  margins match, and undo restores the original slides and format. Slides
  without a usable <body> keep their original html. Honest copy: it is a
  scaled starting variant for review, not a redesign.
- New UI scenario aspect-reflow-test (dialog option, stage wrap, scale and
  centering asserted in the rendered iframe, original preserved, undo).
- Verification: tsc clean; aspect-reflow-test and aspect-change-test pass;
  Rust harness 145 passed / 11 ignored. UI regression IN PROGRESS at handoff:
  84 of 134 scenarios passed, no failures, 50 not yet run this run
  (environmental note: orphan vite/chrome from killed batches must be
  pkilled before resuming). Native Tauri compile still blocked on glib.

## Added in continuation run 6
- Platform-variant packaging in export: the export dialog offers "Varian
  platform", which writes one editable .desel.json project file per other
  format under variants/ in the export output. Each variant's slides are the
  safe scale-to-fit reflow (original document preserved in the stage), the
  aspect and title are switched, and slide IDs/comments/assets/workspace carry
  over so the native importer treats it as a normal portable project. The file
  is built in the UI with a canonical writer that is byte-identical to
  serde_json's ProjectFile serialization (struct field order, BTreeMap-sorted
  free-form values, ryu-style floats), verified by harness fixtures: import of
  the TS-written file succeeds, tamper fails the checksum, and a native
  re-export of the imported payload reproduces the exact TS checksum.
  export-summary.txt names the variants; variants-only export skips rendering.
- New UI scenario variants-export-test (option, variants-only enablement,
  filenames, checksum verify in-page, aspect switch, stage wrap, no render
  output, summary note). Rust harness: 148 passed / 11 ignored.
- Verification: tsc clean; variants-export, preflight, export-mutation,
  export-submit, export-capture-cleanup and backup-path scenarios pass. Full
  135-scenario UI regression: PASSED in full (135/135, zero failures).
  Native Tauri compile still blocked on glib.

## Not complete (reconciled current state)
- Visual before/after branches and historical canvas snapshots. Chat branches
  and retry lineage are implemented and executor-tested, not canvas branches.
- Exact run resume at safe durable boundaries. Recovery is an explicit reviewed
  new continuation with durable finished/uncertain receipts, not exactly-once
  external replay. Duplicate IDs are refused within the same run.
- Large-project UI/render performance. Token accounting/compaction has a
  5,000-turn native fitting test; this is not a large-canvas rendering benchmark.
- Demonstrated premium autonomous carousel quality against original references.
- Real provider/plugin release/login lifecycle and native Windows execution.
- Original local git lineage reconciliation before an eventual approved push.

This is a substantial development slice, not the completed full upgrade or release.

## Added in continuation run 7 (executor verification)
- Three new tests drive the actual SSE streaming loop, tools and SQLite, not
  tool_allowed alone: branch switch/reopen excludes inactive transcript turns;
  cancellation after committed write persists its receipt, same-run completed
  and uncertain IDs cannot replay, a reviewed new continuation appends only its
  new slide; an object lock is refused through the real executor path.
- Fixed native recovery-copy's missing ProjectPayload workspace initializer by
  extracting a core-tested recovery_copy function. Its regression test proves
  draft and remapped slide/object locks survive without mutating the source.
- Harness build.rs now sets desel_harness, so the documented bare cargo test
  command works including doctests. Fresh full harness: 152 passed / 11 ignored.
  tsc and editor contracts clean; branch and resume UI scenarios re-run and pass.
- No new UI in this slice. Screenshots re-captured for branch and resume flows.
- Branches are historical CHAT paths, not historical canvas snapshots. Recovery
  is an explicit new user continuation, not exactly-once external replay.

## Added in continuation run 7 (quality/provider verification)
- Offline rendered benchmark gate + CLI + eleven boundary assertions. Measures
  loaded/broken visible media, clipped union of image/vector boxes, text and
  geometry, with explicit reviewer roles/source evidence. 12% box coverage is
  a local triage heuristic, not the user's measured ratio or an aesthetic score.
  Structural clearance NEVER sets qualityApproval/parity to approved.
- Shipped typography sample is a negative control: FAILS product-carousel gate
  with five findings and 0 media coverage despite clean geometry. It is not
  autonomous provider output. See scripts/benchmark/README.md and saved report.
  Original 44 reference images/approved RustDesk deck are absent. Image-to-image
  parity and premium autonomous generation remain unverified; originals can be
  supplied later. No new provider generation/spend was made.
- Actual production chatgpt_auth + credential_storage modules added to harness:
  20 local auth tests now run (PKCE/state/nonce/callback/JWT/store/refresh/lock).
  Full harness: 172 passed / 11 ignored. This is not real OAuth login, inference
  permission, Windows DPAPI execution or a compiled native account wrapper.
- Prepared both pinned Magpie runtime binaries with checksum validation. Actual
  Linux runtime isolated tests: 15 provider/gateway/account/error/restart checks,
  7 folder-plugin lifecycle checks, 6 inert local-registry version-policy checks,
  all passed. No real provider account, real plugin release update or login.
- Fresh native cargo check still stops at missing glib-2.0 before app code.
  TypeScript, editor contracts and Vite build pass (bundle warning remains).
- Final verification of continuation run 7: full 136/136 UI regression passed
  in eight bounded batches, zero failures (includes the new quality gate).
  Quality gate re-run after its final revision-marker guard: 11/11 boundary
  assertions pass. Rust/auth harness re-run 172 passed / 11 ignored. Vite build,
  TypeScript and editor contracts pass. No Tauri/Windows pass is claimed.
