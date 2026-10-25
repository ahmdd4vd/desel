# Local asset library and provenance notes

Pustaka aset proyek lists images from other local projects. Search names, roles,
credits, descriptions and rights notes, preview the original, then copy into the
current project. Copies get fresh IDs and keep pixels, profiles, role/status and
provenance. They do not depend on the source project remaining present.

Image details now have separate source URL, creator/credit, rights note and alt
text fields. Notes persist in SQLite and portable project snapshots and survive
restart, duplicate and library copy. New research image imports use these fields
instead of hiding notes in filenames. Old imports retain their original filename
notes; they are not silently interpreted as permissions. The source URL is an
HTTP(S) reference, not fetched when saving a note. Blank notes are unknown, and a
note never establishes licensing permission. Cropped copies retain the original
provenance, which is still user-supplied.

All data stays local. This is not a cloud DAM, license-verification service,
semantic image search or shared team library. The metadata list does not load image bytes. Preview retrieves one selected image.
A large library still needs server-side pagination (the UI currently caps matching
results at100 and asks for a narrower search).

Tests: SQLite scope/validation/reopen, independent copy/delete, portable metadata
roundtrip, browser copy/reload/note editing, narrow320/390 and desktop pixel review.
Native desktop end-to-end remains part of final Windows verification.

## Reusable brand profiles

Profil brand saves only palette, style guide, handle and save label from the
current project to a named local SQLite profile. Review a profile's replacement
values before applying. Existing slide HTML is not rewritten; new instructions
can use the new metadata. Applying uses normal project autosave/history, so undo
restores previous metadata. Deleting a profile leaves existing projects intact.
These profiles do not include fonts, logos, assets, accounts, chat or credentials.
They are separate local records, not included in a single-project backup.
Browser save/reload/review/apply/unchanged-slide/undo tests pass; desktop end-to-end
remains for final Windows testing.

The project Design panel also edits the palette directly: add validated #RRGGBB
colors, use the native color picker, move a color earlier or remove it. A palette
has up to12colors. These are project metadata changes with normal undo/redo and
brand-profile reuse; existing HTML is not silently recolored. Local UI checks
reject an invalid color and verify persisted color plus project undo.

## Place a project image locally

Objek slide can insert a raster image already attached to the current project.
The image is decoded before insertion, bounded to40million pixels and a combined
4MiB HTML/base64 budget. PNG/JPEG/WebP/GIF/AVIF are accepted; SVG is not inserted
through this route. The result is an independent inline data image with a fresh
ID and the recorded alt text or asset name. Removing the source asset afterward
does not break that placed copy. Notes are not licensing approval. Copy/placement
is local and does not invoke a provider. Existing image inspector controls handle
position,size and contain/cover. Undo follows project autosave grouping.

Selecting an ordinary img object exposes Ganti gambar terpilih for the chosen
current-project asset. It changes src/alt only, keeping position, dimensions,
contain/cover, border radius and other styles. Decode/budget/origin checks still
apply and project undo restores the prior image. picture/srcset responsive images
are rejected rather than reporting success while a different source still wins.

Selected images expose X/Y percentage focal controls through CSS object-position,
useful with cover cropping. This changes the visible crop alignment, not source
pixels or object dimensions. Values apply to the chosen image and project undo
restores them. Existing contain/cover mode remains separate; background-image CSS
cropping and an external raster editor are not part of this control.

Asset library, asset editor and brand library dialogs contain Tab/Shift-Tab
focus, close on Escape, and return focus to the opener when it still exists.
Their keyboard handling does not run editor-global shortcuts behind the dialog.

While an asset crop/metadata save is in progress, close/backdrop/Escape dismissal
and repeat submission are blocked; crop and metadata inputs stay disabled until
it settles. The crop regression holds a save open and attempts duplicate clicks
and dismissal before releasing it, then checks the single persisted copy.
A failed crop-copy save keeps the dialog open with the error instead of treating
a caught attachment error as success. The regression injects a disk-write error,
then retries successfully and checks the saved copy across reload.
Crop output rejects decoded sources above16000px per axis or40million pixels,
uses a bounded decode wait,and reports unavailable canvas context instead of
assuming it exists. Tiny output canvases stay at least1px per axis. The focused
regression injects oversized/failed decode results before normal save/retry.
These guards run after browser decode,not a promise to avoid all decode memory.
The asset crop test also injects a provenance-write failure,checks typed credit
remains,then retries and confirms the cropped copy keeps that saved provenance.

## Partial crop-copy write recovery

The crop-copy UI retains an incomplete copy ID in the running workspace when the image write succeeds but the provenance write fails. Retry finishes that same copy, including after closing/reopening the source dialog. An error explains that the image is already stored and asks for retry before reloading. If the user changes the crop before retry, only that incomplete copy is removed before creating its replacement. Completed copies are never removed for a refresh-only failure. This is session-local recovery, not a new native atomic transaction or a restart-safe journal; a reload during failure can leave the incomplete copy in the library for inspection.

`asset-copy-retry-test.mjs` injects the provenance failure after image success, closes/reopens the source dialog, retries with delayed/double-submit checks, and confirms exactly two assets (source plus one credited crop), original pixels, crop pixels and reload persistence.
