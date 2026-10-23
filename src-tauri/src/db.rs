//! SQLite persistence.
//!
//! Everything the app owns lives in one database file inside the app data dir:
//! settings, decks, chat history, templates, comments and image assets. Nothing
//! is lost when the app closes, and no server is involved.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::model::*;

pub struct Db {
    conn: Mutex<Connection>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

/// Snapshots the previous wording of every slide that is about to change.
///
/// Autosave fires while someone types in the code panel, so versions are
/// throttled to one per slide per editing burst instead of one per keystroke.
fn capture_revisions(conn: &Connection, old: &Deck, new: &Deck) {
    const THROTTLE_SECS: i64 = 25;
    const KEEP: i64 = 24;

    for prev in &old.slides {
        let Some(next) = new.slides.iter().find(|s| s.id == prev.id) else {
            continue;
        };
        if next.html == prev.html && next.title == prev.title {
            continue;
        }
        if prev.html.trim().is_empty() {
            continue;
        }

        let recent: Option<String> = conn
            .query_row(
                "SELECT created_at FROM slide_revisions WHERE slide_id = ?1 ORDER BY created_at DESC LIMIT 1",
                params![prev.id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if let Some(ts) = recent {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&ts) {
                let age = (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds();
                if age < THROTTLE_SECS {
                    continue;
                }
            }
        }

        let _ = conn.execute(
            "INSERT INTO slide_revisions(id, deck_id, slide_id, title, html, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id("rev"), old.id, prev.id, prev.title, prev.html, now()],
        );
        let _ = conn.execute(
            "DELETE FROM slide_revisions WHERE slide_id = ?1 AND id NOT IN (
                SELECT id FROM slide_revisions WHERE slide_id = ?1 ORDER BY created_at DESC LIMIT ?2
             )",
            params![prev.id, KEEP],
        );
    }

    // A slide that no longer exists cannot be restored or annotated, so its
    // versions and pins would only linger as invisible rows.
    for gone in &old.slides {
        if new.slides.iter().any(|s| s.id == gone.id) {
            continue;
        }
        let _ = conn.execute("DELETE FROM slide_revisions WHERE slide_id = ?1", params![gone.id]);
        let _ = conn.execute("DELETE FROM comments WHERE slide_id = ?1", params![gone.id]);
    }
}

impl Db {
    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS decks (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT '',
                aspect      TEXT NOT NULL DEFAULT '4:5',
                doc         TEXT NOT NULL,
                thumbnail   TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id          TEXT PRIMARY KEY,
                deck_id     TEXT NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL DEFAULT '',
                tool_calls  TEXT NOT NULL DEFAULT '[]',
                tool_call_id TEXT,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_deck ON messages(deck_id, created_at);

            CREATE TABLE IF NOT EXISTS templates (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                doc         TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS comments (
                id          TEXT PRIMARY KEY,
                deck_id     TEXT NOT NULL,
                slide_id    TEXT NOT NULL,
                x           REAL NOT NULL,
                y           REAL NOT NULL,
                body        TEXT NOT NULL,
                author      TEXT NOT NULL DEFAULT 'user',
                status      TEXT NOT NULL DEFAULT 'open',
                selector    TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_comments_deck ON comments(deck_id);

            CREATE TABLE IF NOT EXISTS assets (
                id          TEXT PRIMARY KEY,
                deck_id     TEXT,
                name        TEXT NOT NULL,
                mime        TEXT NOT NULL,
                data        TEXT NOT NULL,
                meta        TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS slide_revisions (
                id          TEXT PRIMARY KEY,
                deck_id     TEXT NOT NULL,
                slide_id    TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                html        TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_revisions_slide ON slide_revisions(slide_id, created_at DESC);
            "#,
        )?;

        // Older databases predate the profile column.
        let _ = conn.execute(
            "ALTER TABLE assets ADD COLUMN meta TEXT NOT NULL DEFAULT ''",
            [],
        );
        // …and the element a comment points at.
        let _ = conn.execute(
            "ALTER TABLE comments ADD COLUMN selector TEXT NOT NULL DEFAULT ''",
            [],
        );
        Ok(())
    }

    /* ---------------------------------------------------------------- */
    /* settings                                                          */
    /* ---------------------------------------------------------------- */

    pub fn get_settings(&self) -> AppSettings {
        let conn = self.conn.lock().unwrap();
        let raw: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        raw.and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &AppSettings) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let raw = serde_json::to_string(settings).unwrap_or_default();
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![raw],
        )?;
        Ok(())
    }

    /* ---------------------------------------------------------------- */
    /* decks                                                             */
    /* ---------------------------------------------------------------- */

    pub fn list_decks(&self) -> Vec<DeckSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, title, aspect, doc, thumbnail, updated_at FROM decks ORDER BY updated_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map([], |r| {
            let doc: String = r.get(3)?;
            let deck: Deck = serde_json::from_str(&doc).unwrap_or_else(|_| Deck {
                id: r.get::<_, String>(0).unwrap_or_default(),
                title: String::new(),
                caption: String::new(),
                aspect: default_aspect(),
                slides: Vec::new(),
                style_guide: String::new(),
                palette: Vec::new(),
                brand_handle: String::new(),
                save_label: default_save_label(),
                from_template_id: None,
                created_at: String::new(),
                updated_at: String::new(),
            });
            Ok(DeckSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                slide_count: deck.slides.len(),
                aspect: r.get(2)?,
                updated_at: r.get(5)?,
                thumbnail: r.get(4)?,
            })
        });
        rows.ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|d| !d.id.is_empty())
            .collect()
    }

    pub fn get_deck(&self, id: &str) -> Option<Deck> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT doc FROM decks WHERE id = ?1", params![id], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<Deck>(&raw).ok())
    }

    pub fn save_deck(&self, deck: &Deck, thumbnail: Option<&str>) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();

        // Snapshot the previous wording of any slide that is about to change, so a
        // rewrite by the agent can always be undone from the inspector.
        if let Ok(raw) = conn.query_row(
            "SELECT doc FROM decks WHERE id = ?1",
            params![deck.id],
            |r| r.get::<_, String>(0),
        ) {
            if let Ok(old) = serde_json::from_str::<Deck>(&raw) {
                capture_revisions(&conn, &old, deck);
            }
        }

        let raw = serde_json::to_string(deck).unwrap_or_default();
        let stamp = now();
        conn.execute(
            "INSERT INTO decks(id, title, aspect, doc, thumbnail, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               aspect = excluded.aspect,
               doc = excluded.doc,
               thumbnail = COALESCE(excluded.thumbnail, decks.thumbnail),
               updated_at = excluded.updated_at",
            params![
                deck.id,
                deck.title,
                deck.aspect,
                raw,
                thumbnail,
                if deck.created_at.is_empty() {
                    stamp
                } else {
                    deck.created_at.clone()
                }
            ],
        )?;
        Ok(())
    }

    /// Previous versions of one slide, newest first.
    pub fn list_revisions(&self, slide_id: &str, limit: usize) -> Vec<SlideRevision> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, deck_id, slide_id, title, html, created_at
             FROM slide_revisions WHERE slide_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![slide_id, limit as i64], |r| {
            Ok(SlideRevision {
                id: r.get(0)?,
                deck_id: r.get(1)?,
                slide_id: r.get(2)?,
                title: r.get(3)?,
                html: r.get(4)?,
                created_at: r.get(5)?,
            })
        });
        match rows {
            Ok(iter) => iter.flatten().collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn get_revision(&self, id: &str) -> Option<SlideRevision> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, deck_id, slide_id, title, html, created_at FROM slide_revisions WHERE id = ?1",
            params![id],
            |r| {
                Ok(SlideRevision {
                    id: r.get(0)?,
                    deck_id: r.get(1)?,
                    slide_id: r.get(2)?,
                    title: r.get(3)?,
                    html: r.get(4)?,
                    created_at: r.get(5)?,
                })
            },
        )
        .ok()
    }

    pub fn delete_deck(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM messages WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM comments WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM assets WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM slide_revisions WHERE deck_id = ?1", params![id])?;
        Ok(())
    }

    /* ---------------------------------------------------------------- */
    /* reference images                                                  */
    /* ---------------------------------------------------------------- */

    pub fn add_asset(&self, asset: &Asset) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let meta = asset
            .profile
            .as_ref()
            .and_then(|p| serde_json::to_string(p).ok())
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO assets (id, deck_id, name, mime, data, meta, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                asset.id,
                asset.deck_id,
                asset.name,
                asset.mime,
                asset.data,
                meta,
                asset.created_at
            ],
        )?;
        Ok(())
    }

    /// Reference images for a deck, oldest first. Payloads included.
    pub fn list_assets(&self, deck_id: &str) -> Vec<Asset> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, deck_id, name, mime, data, meta, created_at
             FROM assets WHERE deck_id = ?1 ORDER BY created_at ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map(params![deck_id], |r| {
            let meta: String = r.get(5)?;
            Ok(Asset {
                id: r.get(0)?,
                deck_id: r.get(1)?,
                name: r.get(2)?,
                mime: r.get(3)?,
                data: r.get(4)?,
                profile: serde_json::from_str(&meta).ok(),
                created_at: r.get(6)?,
            })
        }) {
            Ok(rows) => rows,
            Err(_) => return Vec::new(),
        };
        rows.filter_map(Result::ok).collect()
    }

    /// Metadata only — used by the UI so it never has to hold megabytes of base64.
    pub fn list_asset_summaries(&self, deck_id: &str) -> Vec<Asset> {
        self.list_assets(deck_id)
            .into_iter()
            .map(|mut a| {
                a.data = String::new();
                a
            })
            .collect()
    }

    pub fn delete_asset(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM assets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /* ---------------------------------------------------------------- */
    /* messages                                                          */
    /* ---------------------------------------------------------------- */

    pub fn list_messages(&self, deck_id: &str) -> Vec<ChatMessage> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, deck_id, role, content, tool_calls, tool_call_id, created_at
             FROM messages WHERE deck_id = ?1 ORDER BY created_at ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![deck_id], |r| {
            let tool_calls_raw: String = r.get(4)?;
            Ok(ChatMessage {
                id: r.get(0)?,
                deck_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                tool_calls: serde_json::from_str(&tool_calls_raw).unwrap_or_default(),
                tool_call_id: r.get(5)?,
                streaming: false,
                created_at: r.get(6)?,
            })
        });
        rows.ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .collect()
    }

    pub fn append_message(&self, msg: &ChatMessage) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let tool_calls = serde_json::to_string(&msg.tool_calls).unwrap_or_else(|_| "[]".into());
        conn.execute(
            "INSERT INTO messages(id, deck_id, role, content, tool_calls, tool_call_id, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                msg.deck_id,
                msg.role,
                msg.content,
                tool_calls,
                msg.tool_call_id,
                if msg.created_at.is_empty() {
                    now()
                } else {
                    msg.created_at.clone()
                }
            ],
        )?;
        Ok(())
    }

    pub fn clear_messages(&self, deck_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE deck_id = ?1", params![deck_id])?;
        Ok(())
    }

    /* ---------------------------------------------------------------- */
    /* templates                                                         */
    /* ---------------------------------------------------------------- */

    pub fn list_templates(&self) -> Vec<TemplateRecord> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, name, description, doc, created_at, updated_at
             FROM templates ORDER BY updated_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map([], |r| {
            let doc: String = r.get(3)?;
            Ok(TemplateRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                deck: serde_json::from_str(&doc).unwrap_or_else(|_| empty_deck()),
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        });
        rows.ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .collect()
    }

    pub fn save_template(&self, t: &TemplateRecord) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let doc = serde_json::to_string(&t.deck).unwrap_or_default();
        let stamp = now();
        conn.execute(
            "INSERT INTO templates(id, name, description, doc, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               doc = excluded.doc,
               updated_at = excluded.updated_at",
            params![t.id, t.name, t.description, doc, stamp, stamp],
        )?;
        Ok(())
    }

    pub fn delete_template(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
        Ok(())
    }

    /* ---------------------------------------------------------------- */
    /* comments                                                          */
    /* ---------------------------------------------------------------- */

    pub fn list_comments(&self, deck_id: &str) -> Vec<Comment> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, deck_id, slide_id, x, y, body, author, status, selector, created_at
             FROM comments WHERE deck_id = ?1 ORDER BY created_at ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![deck_id], |r| {
            Ok(Comment {
                id: r.get(0)?,
                deck_id: r.get(1)?,
                slide_id: r.get(2)?,
                x: r.get(3)?,
                y: r.get(4)?,
                body: r.get(5)?,
                author: r.get(6)?,
                status: r.get(7)?,
                selector: r.get(8)?,
                created_at: r.get(9)?,
            })
        });
        rows.ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .collect()
    }

    pub fn add_comment(&self, c: &Comment) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO comments(id, deck_id, slide_id, x, y, body, author, status, selector, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                c.id,
                c.deck_id,
                c.slide_id,
                c.x,
                c.y,
                c.body,
                c.author,
                c.status,
                c.selector,
                if c.created_at.is_empty() {
                    now()
                } else {
                    c.created_at.clone()
                }
            ],
        )?;
        Ok(())
    }

    pub fn update_comment_status(&self, id: &str, status: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE comments SET status = ?2 WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    pub fn delete_comment(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM comments WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn default_aspect() -> String {
    "4:5".into()
}
fn default_save_label() -> String {
    "Save this post".into()
}

fn empty_deck() -> Deck {
    Deck {
        id: String::new(),
        title: String::new(),
        caption: String::new(),
        aspect: default_aspect(),
        slides: Vec::new(),
        style_guide: String::new(),
        palette: Vec::new(),
        brand_handle: String::new(),
        save_label: default_save_label(),
        from_template_id: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (std::path::PathBuf, Db) {
        let path = std::env::temp_dir()
            .join(format!("desel-test-{}.db", Uuid::new_v4().simple()));
        let db = Db::open(path.clone()).expect("open db");
        (path, db)
    }

    fn sample_deck(id: &str) -> Deck {
        Deck {
            id: id.into(),
            title: "Editorial test".into(),
            caption: "caption".into(),
            aspect: "4:5".into(),
            slides: vec![Slide {
                id: "s1".into(),
                title: "Cover".into(),
                html: "<!doctype html><html><body>hi</body></html>".into(),
                rationale: "because".into(),
                hidden: false,
            }],
            style_guide: "editorial print".into(),
            palette: vec!["#111111".into()],
            brand_handle: "@desel".into(),
            save_label: "Save".into(),
            from_template_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn a_comment_remembers_the_element_it_points_at() {
        let (path, db) = temp_db();
        let deck = sample_deck("deck_pin");
        db.save_deck(&deck, None).unwrap();
        db.add_comment(&Comment {
            id: "cm_1".into(),
            deck_id: "deck_pin".into(),
            slide_id: "s1".into(),
            x: 0.42,
            y: 0.18,
            body: "headline kurang tegas".into(),
            author: "user".into(),
            status: "open".into(),
            selector: "h1 > em".into(),
            created_at: String::new(),
        })
        .unwrap();

        let stored = db.list_comments("deck_pin");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].selector, "h1 > em", "posisi elemen harus ikut tersimpan");
        assert!((stored[0].x - 0.42).abs() < 1e-6);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn deleting_a_slide_takes_its_versions_with_it() {
        let (path, db) = temp_db();
        let mut deck = sample_deck("deck_gone");
        db.save_deck(&deck, None).unwrap();
        deck.slides[0].html = "<!doctype html><html><body>versi kedua</body></html>".into();
        db.save_deck(&deck, None).unwrap();
        assert_eq!(db.list_revisions("s1", 12).len(), 1);

        let removed = deck.slides.remove(0);
        db.save_deck(&deck, None).unwrap();

        assert!(
            db.list_revisions(&removed.id, 12).is_empty(),
            "versi slide yang sudah dihapus tidak boleh tertinggal"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_rewrite_keeps_the_previous_wording() {
        let (path, db) = temp_db();
        let mut deck = sample_deck("deck_rev");

        db.save_deck(&deck, None).unwrap();
        assert!(db.list_revisions("s1", 12).is_empty(), "save pertama belum punya versi lama");

        deck.slides[0].html = "<!doctype html><html><body>versi baru</body></html>".into();
        db.save_deck(&deck, None).unwrap();

        let revisions = db.list_revisions("s1", 12);
        assert_eq!(revisions.len(), 1);
        assert!(revisions[0].html.contains("hi"), "yang disimpan versi sebelum ditimpa");
        assert_eq!(revisions[0].deck_id, "deck_rev");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn autosave_does_not_flood_versions() {
        let (path, db) = temp_db();
        let mut deck = sample_deck("deck_flood");
        db.save_deck(&deck, None).unwrap();

        for i in 0..5 {
            deck.slides[0].html = format!("<!doctype html><html><body>edit {i}</body></html>");
            db.save_deck(&deck, None).unwrap();
        }

        // One snapshot per editing burst, not one per keystroke.
        assert_eq!(db.list_revisions("s1", 12).len(), 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn deleting_a_deck_takes_its_versions_with_it() {
        let (path, db) = temp_db();
        let mut deck = sample_deck("deck_gone");
        db.save_deck(&deck, None).unwrap();
        deck.slides[0].html = "<!doctype html><html><body>lain</body></html>".into();
        db.save_deck(&deck, None).unwrap();
        assert_eq!(db.list_revisions("s1", 12).len(), 1);

        db.delete_deck("deck_gone").unwrap();
        assert!(db.list_revisions("s1", 12).is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn everything_survives_reopen() {
        let (path, db) = temp_db();

        let deck = sample_deck("deck_1");
        db.save_deck(&deck, None).unwrap();

        let mut settings = AppSettings::default();
        settings.api_key = "sk-test".into();
        settings.model = "gpt-4o-mini".into();
        db.save_settings(&settings).unwrap();

        let msg = ChatMessage {
            id: "m1".into(),
            deck_id: "deck_1".into(),
            role: "user".into(),
            content: "halo".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            streaming: false,
            created_at: String::new(),
        };
        db.append_message(&msg).unwrap();

        db.save_template(&TemplateRecord {
            id: "t1".into(),
            name: "Acid".into(),
            description: "d".into(),
            deck: sample_deck("deck_tpl"),
            created_at: String::new(),
            updated_at: String::new(),
        })
        .unwrap();

        db.add_comment(&Comment {
            id: "c1".into(),
            deck_id: "deck_1".into(),
            slide_id: "s1".into(),
            x: 0.2,
            y: 0.4,
            body: "lebih besar".into(),
            author: "user".into(),
            status: "open".into(),
            selector: "h1".into(),
            created_at: String::new(),
        })
        .unwrap();

        drop(db);

        // Reopen: this is the "app restarted" case.
        let db = Db::open(path.clone()).unwrap();

        let loaded = db.get_deck("deck_1").expect("deck persisted");
        assert_eq!(loaded.slides.len(), 1);
        assert_eq!(loaded.style_guide, "editorial print");

        assert_eq!(db.get_settings().api_key, "sk-test");
        assert_eq!(db.list_messages("deck_1").len(), 1);
        assert_eq!(db.list_templates().len(), 1);
        assert_eq!(db.list_comments("deck_1").len(), 1);
        assert_eq!(db.list_decks().len(), 1);

        // Cascade delete.
        db.delete_deck("deck_1").unwrap();
        assert!(db.get_deck("deck_1").is_none());
        assert!(db.list_messages("deck_1").is_empty());
        assert!(db.list_comments("deck_1").is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn upgrades_a_database_created_before_image_profiles() {
        let path = std::env::temp_dir().join(format!("desel-old-{}.db", Uuid::new_v4().simple()));
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE assets (
                    id TEXT PRIMARY KEY,
                    deck_id TEXT,
                    name TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );",
            )
            .unwrap();
        }

        // Opening must add the missing column instead of failing.
        let db = Db::open(path.clone()).expect("db lama tetap bisa dibuka");
        db.add_asset(&Asset {
            id: "ref_old".into(),
            deck_id: Some("deck_1".into()),
            name: "cover.jpg".into(),
            mime: "image/jpeg".into(),
            data: "AAAA".into(),
            profile: Some(crate::palette::ImageProfile {
                width: 1080,
                height: 1350,
                palette: vec!["#900020".into()],
                luminance: 0.09,
                contrast: 0.39,
                light_ratio: 0.0,
            }),
            created_at: String::new(),
        })
        .unwrap();

        let stored = db.list_assets("deck_1");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].profile.as_ref().unwrap().palette[0], "#900020");

        let _ = std::fs::remove_file(path);
    }
}
