# Project undo/redo

The project menu and Ctrl+Z / Ctrl+Shift+Z undo/redo saved project changes:
slide content, titles, order, additions/deletions and deck metadata. Text/code
inputs retain their native typing undo. History survives desktop restart.

History is bounded to30 snapshots per direction and64MiB combined per project.
Every persisted edit creates one snapshot; keystrokes coalesced by450ms autosave
share one saved step. A new edit after undo clears redo. Initial creation is not
an undoable project deletion. History is local and omitted from portable files.

Undo requires the current expected project to match the database. A concurrent
change is rejected instead of overwritten. Agent slide candidates and revision
restores use target-only comparison, preserving unrelated concurrent edits.
Saves, slide revisions, pin cleanup and history changes share one transaction.
A failed save rolls back all of them. Local autosaves run in order.

Deleted-slide pins return when that slide is restored. Edits to pins on surviving
slides are not rewound. Chat, connection settings, assets and account actions
are outside project undo; this is not full database time travel. Existing assets
remain in the project when a slide is deleted. Removing a reference asset is a
separate action and not undone here.

Backend tests cover reopen, structural undo/redo, pin revival, stale-state
rejection, history branching, size/count limits and forced save rollback.
Browser tests cover delete/undo/redo/branch/reload and menu presentation.
Native Windows keyboard and persistence behavior still requires final testing.

Manual autosaves also carry the exact last-known persisted snapshot. If another
operation changed it, the save fails without overwriting either version. The
canvas retains local work. Use "Simpan salinan pemulihan lokal" to preserve it as
a fresh project with new IDs and current assets/pins, leaving the newer database
version untouched. Agent completion reconciles by field/slide with local edits,
and accepted replaced content remains in project history. These are local
conflict controls, not a multi-user collaboration system.

Save health remains visible in the project menu. A failed save also raises a
persistent recovery banner until a save or recovery copy succeeds. Closing a
window with unsaved/saving/failed work requests the browser's leave warning;
this is not an automatic crash-recovery guarantee. Rust tests exercise native
persistence; npm run test:editor checks pure merge contracts without a browser.

## Restart draft recovery

Before the450ms autosave delay, manual edits also try to retain a device-local
project draft in the webview storage. On restart/open, a differing draft is
shown, never applied automatically. "Pulihkan salinan draft" creates a new
project, preserving the database version. "Abaikan draft" explicitly discards
that draft. Successful database saves remove only the matching saved draft,
not a newer unsaved edit. The retained object includes project content, not
settings, account secrets or chat.

This is best-effort crash assistance, not guaranteed backup: local storage can
be unavailable, cleared or full, and large projects may exceed its8MiB character
budget. Older drafts are pruned within that budget. A warning says when draft
retention failed. Export a portable project for an independent backup. Browser
reload tests prove recovery-copy behavior; Windows webview persistence still
requires final native verification.

## Compare before restoring

The slide history panel now opens a comparison instead of restoring immediately.
Current and saved HTML render side by side on desktop and stack on narrow windows,
with a plain-text view and explicit Restore this version / Keep current actions.
Preview uses the current project aspect, not a claim that old aspect metadata was
stored with each HTML revision. Restore changes only this slide's title/HTML; the
current version remains in history. Failures stay visible rather than closing as
if restoration succeeded. The local browser regression checks target-only restore
and recovery of the replaced current version, with desktop/narrow pixel review.
