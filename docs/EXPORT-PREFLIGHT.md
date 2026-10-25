# Export preflight

The export dialog requires a check of the current visible-slide revision before
PNG/PDF export. It checks exact render-revision readiness, failed images, blank
slides, unresolved asset tokens and measured layout findings. No visible slides,
unready images or unresolved assets block export. External asset references and
mechanical layout findings are warnings. Each finding opens its slide for review.

Warnings need explicit acknowledgement for that exact revision. Changing slide
content, visibility or aspect invalidates the check and acknowledgement. Clean
checks are not visual/content/rights approval. Remote images and CORS may still
fail after checking; existing partial-export warnings remain, never called full
success. Export uses the checked HTML but external resources can change.

Local tests cover missing assets, no visible slides, stale checks, warning
acknowledgement, current clean landscape PNG/PDF download and block-button state.
Native Windows export remains for final verification. This is mechanical
preflight, not a promise of premium design or correct facts.

A running agent cannot export. Export rechecks the exact project snapshot and
render revision while capturing each slide, then again before writing files.
A change during capture aborts without writing the prepared file batch. File
names/caption metadata are included in the snapshot. Fonts have bounded waits.
The action footer stays reachable on narrow/short windows; finding lists scroll.

## Native file batches

Native export validates every filename/encoding/decoded size before creating the
output batch, stages all files together, syncs each file, then renames the staging
folder into a fresh destination. An existing deck export folder is left unchanged;
subsequent exports use `deck-2`, `deck-3`, and so on. A parent-folder lock serializes
Desel exports. Invalid later base64 and forced mid-write failure tests leave old
exports untouched and clean temporary staging folders. Path separators, reserved
Windows names, duplicate case-insensitive filenames and unsupported encodings are
rejected. Batch limit256MB,205files. Browser preview still uses individual browser
downloads, not the native folder writer. This is not a claim of power-loss atomicity
on every filesystem or protection against another program racing destination paths.

The integrated browser journey now downloads actual PNGs and PDF after
edit/template/reload. It checks visible-slide filenames (01 and03,not hidden02),
1920x1080 PNG dimensions,background-color order and a two-page landscape PDF.
Actual downloaded PNGs and both PDF pages were visually inspected for the
edited opening text/outline and closing text. This is a local fixture,not a
native file writer/Windows qualification or arbitrary-design proof.
The integrated journey also injects an export-write rejection, verifies no
premature downloads and an open retryable dialog, retries, and checks caption
and export-summary visible-slide count/numbers. This is browser write failure
injection, separate from native staging rollback tests.
