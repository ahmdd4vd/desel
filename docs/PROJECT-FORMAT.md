# Portable project files

Menu proyek > Backup proyek + aset downloads a version1 `.desel.json` file.
Restore always creates a new project with fresh deck/slide/asset/comment IDs,
leaving the original untouched. Deck metadata, slide HTML, image assets and
pinned comments are included. Accounts/API keys, settings, chat, raw model output
and previous revisions are intentionally excluded. This is a portable current
project snapshot, not a complete database backup or conversation export.

The format has a SHA-256 damage-detection checksum, not a signature or trust
certificate. Imported files remain untrusted. Limits:32MB JSON,200slides/assets,
2000comments,8MB image payload,40million pixels per image. Supported images:
PNG/JPEG/WebP/GIF. Unsupported versions, damaged checksums, duplicate IDs,
missing assets and active HTML are rejected before an atomic SQLite insert.
Source assets and comments are remapped; existing projects are never replaced.

Browser preview reports that native project backup/restore needs the desktop
app. Local backend roundtrip/asset/comment/rollback/invalid-input contracts and
browser menu/error-boundary tests pass. Native file download/import is still
for final desktop verification. This is not a claim of full crash recovery,
full-history backup, encrypted backup or cloud sync.
