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
fn capture_revisions(conn: &Connection, old: &Deck, new: &Deck) -> rusqlite::Result<()> {
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

        let recent: Option<(String, String, String)> = conn
            .query_row(
                "SELECT created_at, html, title FROM slide_revisions WHERE slide_id = ?1 ORDER BY created_at DESC LIMIT 1",
                params![prev.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .ok()
            .flatten();
        if let Some((ts, last_html, last_title)) = recent {
            // Coalesce bursts of the SAME content, but never skip a snapshot
            // whose content differs - e.g. an agent version overwritten by a
            // user's manual commit seconds later must stay recoverable.
            if last_html == prev.html && last_title==prev.title {
                if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&ts) {
                    let age = (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds();
                    if age < THROTTLE_SECS {
                        continue;
                    }
                }
            }
        }

        conn.execute(
            "INSERT INTO slide_revisions(id, deck_id, slide_id, title, html, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id("rev"), old.id, prev.id, prev.title, prev.html, now()],
        )?;
        conn.execute(
            "DELETE FROM slide_revisions WHERE slide_id = ?1 AND id NOT IN (
                SELECT id FROM slide_revisions WHERE slide_id = ?1 ORDER BY created_at DESC LIMIT ?2
             )",
            params![prev.id, KEEP],
        )?;
    }

    // A slide that no longer exists cannot be restored or annotated, so its
    // versions and pins would only linger as invisible rows.
    for gone in &old.slides {
        if new.slides.iter().any(|s| s.id == gone.id) {
            continue;
        }
        conn.execute("DELETE FROM slide_revisions WHERE slide_id = ?1", params![gone.id])?;
        conn.execute("DELETE FROM comments WHERE slide_id = ?1", params![gone.id])?;
    }
    Ok(())
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
            CREATE TABLE IF NOT EXISTS creator_runs(id TEXT PRIMARY KEY,deck_id TEXT NOT NULL,doc TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS creator_steps(run_id TEXT NOT NULL,call_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(run_id,call_id));
            CREATE TABLE IF NOT EXISTS brand_profiles(id TEXT PRIMARY KEY,doc TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS deck_history (seq INTEGER PRIMARY KEY AUTOINCREMENT,deck_id TEXT NOT NULL,direction TEXT NOT NULL,doc TEXT NOT NULL,comments TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_deck_history ON deck_history(deck_id,direction,seq DESC);
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

            CREATE TABLE IF NOT EXISTS response_outputs(message_id TEXT PRIMARY KEY,deck_id TEXT NOT NULL,scope TEXT NOT NULL,output TEXT NOT NULL);
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

        for column in ["reference_role", "reference_status", "provenance"] {let _=conn.execute(&format!("ALTER TABLE assets ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"),[]);}
        // Older databases predate the profile column.
        let _=conn.execute("ALTER TABLE messages ADD COLUMN reasoning_content TEXT NOT NULL DEFAULT ''",[]);
        conn.execute("CREATE TABLE IF NOT EXISTS creator_workspace(deck_id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL)",[])?;
        conn.execute("CREATE TABLE IF NOT EXISTS chat_branches(deck_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL)",[])?;
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

    pub fn save_deck(&self, deck: &Deck, thumbnail: Option<&str>) -> rusqlite::Result<()> {self.save_deck_checked(deck,thumbnail,None)}
    pub fn save_deck_checked(&self,deck:&Deck,thumbnail:Option<&str>,expected:Option<&Deck>)->rusqlite::Result<()>{
        let mut guard=self.conn.lock().unwrap();
        let conn=guard.transaction()?;
        if let Some(base)=expected{let raw:String=conn.query_row("SELECT doc FROM decks WHERE id=?1",params![deck.id],|r|r.get(0))?;if serde_json::from_str::<serde_json::Value>(&raw).ok()!=serde_json::to_value(base).ok(){return Err(rusqlite::Error::InvalidParameterName("Project changed in another operation; local edits were not overwritten. Reopen the project before saving again.".into()))}}

        // Snapshot the previous wording of any slide that is about to change, so a
        // rewrite by the agent can always be undone from the inspector.
        let previous:Option<String>=conn.query_row("SELECT doc FROM decks WHERE id=?1",params![deck.id],|r|r.get(0)).optional()?;
        if let Some(raw)=previous {
            let old:Deck=serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidParameterName("Saved project is damaged; original record was not changed".into()))?;
            if old.id!=deck.id{return Err(rusqlite::Error::InvalidParameterName("Saved project identity mismatch; original record was not changed".into()))}
            if serde_json::to_value(&old).ok()!=serde_json::to_value(deck).ok(){
                push_deck_history(&conn,&old,"undo")?;
                conn.execute("DELETE FROM deck_history WHERE deck_id=?1 AND direction='redo'",params![deck.id])?;
            }
            capture_revisions(&conn,&old,deck)?;
        }

        let raw = serde_json::to_string(deck).unwrap_or_default();
        let stamp = now();
        conn.execute(
            "INSERT INTO decks(id, title, aspect, doc, thumbnail, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
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
                    stamp.clone()
                } else {
                    deck.created_at.clone()
                },
                stamp
            ],
        )?;
        conn.commit()?;
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
        let mut guard=self.conn.lock().unwrap();let conn=guard.transaction()?;
        conn.execute("DELETE FROM creator_steps WHERE run_id IN (SELECT id FROM creator_runs WHERE deck_id=?1)",params![id])?;
        conn.execute("DELETE FROM creator_runs WHERE deck_id=?1",params![id])?;
        conn.execute("DELETE FROM deck_history WHERE deck_id=?1",params![id])?;
        conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM response_outputs WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM chat_branches WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM creator_workspace WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM messages WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM comments WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM assets WHERE deck_id = ?1", params![id])?;
        conn.execute("DELETE FROM slide_revisions WHERE deck_id = ?1", params![id])?;
        conn.commit()?;Ok(())
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
            "INSERT INTO assets (id, deck_id, name, mime, data, meta, created_at, reference_role, reference_status, provenance)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                asset.id,
                asset.deck_id,
                asset.name,
                asset.mime,
                asset.data,
                meta,
                asset.created_at, asset.reference_role, asset.reference_status, serde_json::to_string(&asset.provenance).unwrap_or_default()
            ],
        )?;
        Ok(())
    }

    /// Reference images for a deck, oldest first. Payloads included.
    pub fn list_assets(&self, deck_id: &str) -> Vec<Asset> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, deck_id, name, mime, data, meta, created_at, reference_role, reference_status, provenance
             FROM assets WHERE deck_id = ?1 ORDER BY created_at ASC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map(params![deck_id], |r| {
            let meta: String = r.get(5)?;
            Ok(Asset {provenance:serde_json::from_str(&r.get::<_,String>(9)?).unwrap_or(None),reference_role:r.get(7)?,reference_status:r.get(8)?,
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

    pub fn set_reference_intent(&self, deck_id:&str,id:&str,role:&str,status:&str)->Result<(),String>{
        if !["", "cover","body","closer","asset"].contains(&role) || !["", "candidate","approved","rejected"].contains(&status){return Err("invalid reference role or status".into())}
        let count=self.conn.lock().unwrap().execute("UPDATE assets SET reference_role=?1,reference_status=?2 WHERE id=?3 AND deck_id=?4",params![role,status,id,deck_id]).map_err(|e|e.to_string())?;
        if count!=1{return Err("reference not found in this deck".into())}Ok(())
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

    pub fn save_response_output(&self,message_id:&str,deck_id:&str,scope:&str,output:&serde_json::Value)->Result<(),String>{let json=serde_json::to_string(output).map_err(|e|e.to_string())?;if json.len()>4*1024*1024||!output.is_array(){return Err("Invalid or oversized response continuity".into())}self.conn.lock().unwrap().execute("INSERT OR REPLACE INTO response_outputs(message_id,deck_id,scope,output) VALUES(?1,?2,?3,?4)",params![message_id,deck_id,scope,json]).map_err(|e|e.to_string())?;Ok(())}
    pub fn response_outputs(&self,deck_id:&str,scope:&str)->std::collections::HashMap<String,serde_json::Value>{let conn=self.conn.lock().unwrap();let mut out=std::collections::HashMap::new();if let Ok(mut statement)=conn.prepare("SELECT message_id,output FROM response_outputs WHERE deck_id=?1 AND scope=?2"){if let Ok(rows)=statement.query_map(params![deck_id,scope],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))){for row in rows.flatten(){if let Ok(v)=serde_json::from_str(&row.1){out.insert(row.0,v);}}}}out}
    pub fn list_messages(&self, deck_id: &str) -> Vec<ChatMessage> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, deck_id, role, content, tool_calls, tool_call_id, created_at, reasoning_content
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
                tool_call_id: r.get(5)?, reasoning_content: r.get(7)?,
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
            "INSERT INTO messages(id, deck_id, role, content, tool_calls, tool_call_id, created_at,reasoning_content)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7,?8)",
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
                },
                msg.reasoning_content
            ],
        )?;
        Ok(())
    }

    /// Branch lineage is metadata beside the linear log. Only ids that exist as messages of this deck are accepted.
    pub fn save_chat_branches(&self, deck_id: &str, state: &serde_json::Value) -> Result<(), String> {
        let nodes = state.get("nodes").and_then(|n| n.as_array()).ok_or("branch state needs nodes")?;
        let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
        if json.len() > 1024 * 1024 || nodes.len() > 20000 { return Err("Oversized branch state".into()); }
        let conn = self.conn.lock().unwrap();
        let known: std::collections::HashSet<String> = {
            let mut st = conn.prepare("SELECT id FROM messages WHERE deck_id=?1").map_err(|e| e.to_string())?;
            let rows = st.query_map(params![deck_id], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
            rows.flatten().collect()
        };
        let ids = nodes.iter().filter_map(|n| n.get("messageId").and_then(|v| v.as_str()));
        for id in ids { if !known.contains(id) { return Err(format!("Unknown message in branch state: {id}")); } }
        if let Some(leaf) = state.get("activeLeaf").and_then(|v| v.as_str()) { if !known.contains(leaf) { return Err("Unknown active leaf".into()); } }
        conn.execute("INSERT OR REPLACE INTO chat_branches(deck_id,state,updated_at) VALUES(?1,?2,?3)", params![deck_id, json, now()]).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Durable mirror of the per-project Creator workspace (draft, queue, memory). Shape-checked, never executed.
    pub fn check_creator_workspace(doc: &serde_json::Value) -> Result<(), String> {
        let ok = doc.get("draft").map_or(false, |v| v.is_string()) && doc.get("queue").map_or(false, |v| v.is_array()) && doc.get("memory").map_or(false, |v| v.is_array()) && doc.get("lockedSlideIds").map_or(false, |v| v.is_array()) && doc.get("lockedObjects").map_or(true, |v| v.is_array());
        if !ok { return Err("Invalid Creator workspace shape".into()); }
        let json = serde_json::to_string(doc).map_err(|e| e.to_string())?;
        if json.len() > 512 * 1024 { return Err("Creator workspace exceeds 512 KB".into()); }
        Ok(())
    }

    pub fn save_creator_workspace(&self, deck_id: &str, doc: &serde_json::Value) -> Result<(), String> {
        Self::check_creator_workspace(doc)?;
        let json = serde_json::to_string(doc).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().unwrap();
        let exists: bool = conn.query_row("SELECT 1 FROM decks WHERE id=?1", params![deck_id], |_| Ok(true)).unwrap_or(false);
        if !exists { return Err("Unknown project".into()); }
        conn.execute("INSERT OR REPLACE INTO creator_workspace(deck_id,doc,updated_at) VALUES(?1,?2,?3)", params![deck_id, json, now()]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn creator_workspace(&self, deck_id: &str) -> Option<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let raw: String = conn.query_row("SELECT doc FROM creator_workspace WHERE deck_id=?1", params![deck_id], |r| r.get(0)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn chat_branches(&self, deck_id: &str) -> Option<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let raw: String = conn.query_row("SELECT state FROM chat_branches WHERE deck_id=?1", params![deck_id], |r| r.get(0)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// Messages the model may see. With no branch state this is the full log. Tracked messages
    /// follow the active path; untracked ones (agent replies, tool rows) inherit from the message before them.
    pub fn active_history(&self, deck_id: &str) -> Vec<ChatMessage> {
        let all = self.list_messages(deck_id);
        let Some(state) = self.chat_branches(deck_id) else { return all };
        let nodes: Vec<(String, Option<String>)> = state.get("nodes").and_then(|n| n.as_array()).map(|a| a.iter().filter_map(|n| Some((n.get("messageId")?.as_str()?.to_string(), n.get("parentId").and_then(|v| v.as_str()).map(String::from)))).collect()).unwrap_or_default();
        if nodes.is_empty() { return all; }
        let parent: std::collections::HashMap<&str, Option<&str>> = nodes.iter().map(|(m, p)| (m.as_str(), p.as_deref())).collect();
        let mut path = std::collections::HashSet::new();
        let mut cur = state.get("activeLeaf").and_then(|v| v.as_str());
        while let Some(id) = cur { if !path.insert(id.to_string()) { break; } cur = parent.get(id).copied().flatten(); }
        let mut keep = true;
        all.into_iter().filter(|m| { if parent.contains_key(m.id.as_str()) { keep = path.contains(&m.id); } keep }).collect()
    }

    /// Register a new user turn under the active leaf (only when branching is in use).
    pub fn track_user_turn(&self, deck_id: &str, message_id: &str) -> Result<(), String> {
        let Some(mut state) = self.chat_branches(deck_id) else { return Ok(()) };
        let leaf = state.get("activeLeaf").cloned().unwrap_or(serde_json::Value::Null);
        let nodes = state.get_mut("nodes").and_then(|n| n.as_array_mut()).ok_or("bad branch state")?;
        if nodes.iter().any(|n| n.get("messageId").and_then(|v| v.as_str()) == Some(message_id)) { return Ok(()); }
        let branch = if leaf.is_null() { "main".to_string() } else if nodes.iter().any(|n| n.get("parentId") == Some(&leaf)) { format!("b-{message_id}") } else { nodes.iter().find(|n| n.get("messageId") == Some(&leaf)).and_then(|n| n.get("branchId")).and_then(|v| v.as_str()).unwrap_or("main").to_string() };
        nodes.push(serde_json::json!({"messageId":message_id,"parentId":leaf,"branchId":branch}));
        state["activeLeaf"] = serde_json::json!(message_id);
        self.save_chat_branches(deck_id, &state)
    }

    pub fn clear_messages(&self, deck_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chat_branches WHERE deck_id = ?1", params![deck_id])?;
        conn.execute("DELETE FROM response_outputs WHERE deck_id = ?1", params![deck_id])?;
        conn.execute("DELETE FROM creator_steps WHERE run_id IN (SELECT id FROM creator_runs WHERE deck_id=?1)",params![deck_id])?;
        conn.execute("DELETE FROM creator_runs WHERE deck_id=?1",params![deck_id])?;
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

        // Distinct overwritten versions stay recoverable even in a fast burst
        // (e.g. an agent version overwritten by a manual commit seconds later).
        for i in 0..5 {
            deck.slides[0].html = format!("<!doctype html><html><body>edit {i}</body></html>");
            db.save_deck(&deck, None).unwrap();
        }
        let revs = db.list_revisions("s1", 12);
        assert_eq!(revs.len(), 5, "every distinct overwritten version kept: {revs:?}");
        assert!(revs.iter().any(|r| r.html.contains("edit 3")));

        // Re-saving identical content inside the burst window coalesces.
        deck.slides[0].html = "<!doctype html><html><body>edit 4</body></html>".into();
        db.save_deck(&deck, None).unwrap();
        assert_eq!(db.list_revisions("s1", 12).len(), 5, "identical re-save adds nothing");

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
            tool_call_id: None, reasoning_content: String::new(),
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
        db.add_asset(&Asset {provenance:None,reference_role:String::new(),reference_status:String::new(),
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

#[cfg(test)]mod reference_intent_tests{use super::*;
#[test]fn reference_intent_roundtrips_and_is_deck_scoped(){let p=std::env::temp_dir().join(format!("intent-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();let a=Asset{id:"a".into(),deck_id:Some("d".into()),name:"plain.jpg".into(),mime:"image/jpeg".into(),data:"AAAA".into(),profile:None,provenance:None,reference_role:String::new(),reference_status:String::new(),created_at:now()};db.add_asset(&a).unwrap();assert!(db.set_reference_intent("other","a","cover","approved").is_err());assert!(db.set_reference_intent("d","a","bad","approved").is_err());db.set_reference_intent("d","a","cover","approved").unwrap();drop(db);let db=Db::open(p.clone()).unwrap();let a=&db.list_assets("d")[0];assert_eq!(a.reference_role,"cover");assert_eq!(a.reference_status,"approved");assert_eq!(a.data,"AAAA");drop(db);let _=std::fs::remove_file(p);}}

impl Db {
 /// Atomic target-only CAS. Unrelated concurrent deck/slide edits survive.
 pub fn commit_slide_candidate(&self,base:&Deck,index:usize,candidate:&Slide)->Result<Deck,String>{
  let mut conn=self.conn.lock().unwrap();let tx=conn.transaction().map_err(|e|e.to_string())?;
  let raw:String=tx.query_row("SELECT doc FROM decks WHERE id=?1",params![base.id],|r|r.get(0)).map_err(|e|e.to_string())?;
  let mut latest:Deck=serde_json::from_str(&raw).map_err(|e|e.to_string())?;let old=base.slides.get(index).ok_or("base target absent")?;
  if latest.aspect!=base.aspect||latest.slides.get(index).map(|s|serde_json::to_string(s).ok())!=Some(serde_json::to_string(old).ok())||candidate.id!=old.id{return Err("stale target/aspect/order: candidate not committed".into())}
  let previous=latest.clone();latest.slides[index]=candidate.clone();latest.updated_at=now();push_deck_history(&tx,&previous,"undo").map_err(|e|e.to_string())?;tx.execute("DELETE FROM deck_history WHERE deck_id=?1 AND direction='redo'",params![previous.id]).map_err(|e|e.to_string())?;capture_revisions(&tx,&previous,&latest).map_err(|e|e.to_string())?;
  let doc=serde_json::to_string(&latest).map_err(|e|e.to_string())?;tx.execute("UPDATE decks SET doc=?1,updated_at=?2 WHERE id=?3",params![doc,latest.updated_at,latest.id]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;Ok(latest)
 }
}

#[cfg(test)]mod candidate_cas_tests{use super::*;use serde_json::json;
#[test]fn target_cas_preserves_unrelated_edits_and_rejects_races(){let path=std::env::temp_dir().join(format!("candidate-cas-{}.db",new_id("t")));let db=Db::open(path.clone()).unwrap();let base:Deck=serde_json::from_value(json!({"id":"d","slides":[{"id":"a","html":"old"},{"id":"b","html":"other"}]})).unwrap();db.save_deck(&base,None).unwrap();let mut latest=base.clone();latest.title="user title".into();latest.slides[1].html="user other edit".into();db.save_deck(&latest,None).unwrap();let mut candidate=base.slides[0].clone();candidate.html="accepted".into();let saved=db.commit_slide_candidate(&base,0,&candidate).unwrap();assert_eq!(saved.title,"user title");assert_eq!(saved.slides[1].html,"user other edit");assert_eq!(saved.slides[0].html,"accepted");let before=serde_json::to_string(&saved).unwrap();assert!(db.commit_slide_candidate(&base,0,&candidate).is_err());assert_eq!(serde_json::to_string(&db.get_deck("d").unwrap()).unwrap(),before);let mut aspect=saved.clone();aspect.aspect="1:1".into();db.save_deck(&aspect,None).unwrap();assert!(db.commit_slide_candidate(&saved,0,&candidate).is_err());drop(db);let _=std::fs::remove_file(path);}
}

#[cfg(test)]mod response_storage_tests{use super::*;#[test]fn response_items_survive_reopen_and_scope_isolation(){let path=std::env::temp_dir().join(format!("desel-output-{}.db",uuid::Uuid::new_v4()));let db=Db::open(path.clone()).unwrap();let output=serde_json::json!([{"type":"reasoning","encrypted_content":"opaque-fixture"}]);db.save_response_output("msg","deck","scope-a",&output).unwrap();drop(db);let db=Db::open(path.clone()).unwrap();assert_eq!(db.response_outputs("deck","scope-a")["msg"],output);assert!(db.response_outputs("deck","scope-b").is_empty());assert!(db.response_outputs("other-deck","scope-a").is_empty());drop(db);let _=std::fs::remove_file(path);}}

impl Db{
 pub fn import_project_atomic(&self,deck:&Deck,assets:&[Asset],comments:&[Comment])->Result<(),String>{let mut conn=self.conn.lock().map_err(|_|"Project database unavailable")?;let tx=conn.transaction().map_err(|_|"Cannot begin project restore")?;let result=(||->rusqlite::Result<()>{tx.execute("INSERT INTO decks(id,title,aspect,doc,created_at,updated_at)VALUES(?1,?2,?3,?4,?5,?6)",params![deck.id,deck.title,deck.aspect,serde_json::to_string(deck).unwrap(),deck.created_at,deck.updated_at])?;for a in assets{tx.execute("INSERT INTO assets(id,deck_id,name,mime,data,meta,created_at,reference_role,reference_status,provenance)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![a.id,a.deck_id,a.name,a.mime,a.data,serde_json::to_string(&a.profile).unwrap(),a.created_at,a.reference_role,a.reference_status,serde_json::to_string(&a.provenance).unwrap_or_default()])?;}for c in comments{tx.execute("INSERT INTO comments(id,deck_id,slide_id,x,y,body,author,status,selector,created_at)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![c.id,c.deck_id,c.slide_id,c.x,c.y,c.body,c.author,c.status,c.selector,c.created_at])?;}Ok(())})();result.map_err(|_|"Project restore failed; nothing was imported")?;tx.commit().map_err(|_|"Cannot commit restored project")?;Ok(())}
}

fn history_comments(conn:&Connection,deck_id:&str)->rusqlite::Result<Vec<Comment>>{
 let mut q=conn.prepare("SELECT id,deck_id,slide_id,x,y,body,author,status,selector,created_at FROM comments WHERE deck_id=?1")?;
 let rows=q.query_map(params![deck_id],|r|Ok(Comment{id:r.get(0)?,deck_id:r.get(1)?,slide_id:r.get(2)?,x:r.get(3)?,y:r.get(4)?,body:r.get(5)?,author:r.get(6)?,status:r.get(7)?,selector:r.get(8)?,created_at:r.get(9)?}))?;
 rows.collect()
}
fn push_deck_history(conn:&Connection,deck:&Deck,direction:&str)->rusqlite::Result<()>{
 let comments=history_comments(conn,&deck.id)?;
 conn.execute("INSERT INTO deck_history(deck_id,direction,doc,comments) VALUES(?1,?2,?3,?4)",params![deck.id,direction,serde_json::to_string(deck).unwrap(),serde_json::to_string(&comments).unwrap()])?;
 conn.execute("DELETE FROM deck_history WHERE deck_id=?1 AND direction=?2 AND seq NOT IN (SELECT seq FROM deck_history WHERE deck_id=?1 AND direction=?2 ORDER BY seq DESC LIMIT 30)",params![deck.id,direction])?;
 // Bound large HTML histories as well as entry count (64MiB per project).
 conn.execute("DELETE FROM deck_history WHERE deck_id=?1 AND seq NOT IN (SELECT seq FROM (SELECT seq,SUM(length(CAST(doc AS BLOB))+length(CAST(comments AS BLOB))) OVER (ORDER BY seq DESC) AS bytes FROM deck_history WHERE deck_id=?1) WHERE bytes<=67108864)",params![deck.id])?;Ok(())
}
impl Db{
 pub fn deck_history_counts(&self,id:&str)->[i64;2]{let c=self.conn.lock().unwrap();["undo","redo"].map(|d|c.query_row("SELECT count(*) FROM deck_history WHERE deck_id=?1 AND direction=?2",params![id,d],|r|r.get(0)).unwrap_or(0))}
 pub fn step_deck_history(&self,expected:&Deck,direction:&str)->Result<Deck,String>{
 if !matches!(direction,"undo"|"redo"){return Err("Invalid history direction".into())}
 let mut c=self.conn.lock().unwrap();let tx=c.transaction().map_err(|e|e.to_string())?;
 let raw:String=tx.query_row("SELECT doc FROM decks WHERE id=?1",params![expected.id],|r|r.get(0)).map_err(|_|"Project not found")?;
 let current:Deck=serde_json::from_str(&raw).map_err(|_|"Invalid current project")?;
 if serde_json::to_value(&current).ok()!=serde_json::to_value(expected).ok(){return Err("Project changed. Refresh before undo/redo; newer edits were kept.".into())}
 let (seq,doc,pins):(i64,String,String)=tx.query_row("SELECT seq,doc,comments FROM deck_history WHERE deck_id=?1 AND direction=?2 ORDER BY seq DESC LIMIT 1",params![expected.id,direction],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"No history available")?;
 let mut restored:Deck=serde_json::from_str(&doc).map_err(|_|"Damaged project history")?;
 let old_pins:Vec<Comment>=serde_json::from_str(&pins).map_err(|_|"Damaged comment history")?;
 push_deck_history(&tx,&current,if direction=="undo"{"redo"}else{"undo"}).map_err(|e|e.to_string())?;
 // Only revive pins on reintroduced slides. Never erase edits to surviving pins.
 for pin in old_pins{if !current.slides.iter().any(|s|s.id==pin.slide_id)&&restored.slides.iter().any(|s|s.id==pin.slide_id){tx.execute("INSERT OR IGNORE INTO comments(id,deck_id,slide_id,x,y,body,author,status,selector,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![pin.id,pin.deck_id,pin.slide_id,pin.x,pin.y,pin.body,pin.author,pin.status,pin.selector,pin.created_at]).map_err(|e|e.to_string())?;}}
 capture_revisions(&tx,&current,&restored).map_err(|e|e.to_string())?;
 restored.updated_at=now();
 tx.execute("UPDATE decks SET title=?2,aspect=?3,doc=?4,updated_at=?5,thumbnail=NULL WHERE id=?1",params![restored.id,restored.title,restored.aspect,serde_json::to_string(&restored).unwrap(),restored.updated_at]).map_err(|e|e.to_string())?;
 tx.execute("DELETE FROM deck_history WHERE seq=?1",params![seq]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;Ok(restored)
 }
}
#[cfg(test)]mod deck_history_tests{use super::*;use serde_json::json;
#[test]fn structural_undo_redo_survives_reopen_preserves_pins_and_rejects_races(){let path=std::env::temp_dir().join(format!("history-{}.db",new_id("t")));let db=Db::open(path.clone()).unwrap();let mut d:Deck=serde_json::from_value(json!({"id":"d","title":"before","slides":[{"id":"a","html":"A"},{"id":"b","html":"B"}]})).unwrap();db.save_deck(&d,None).unwrap();db.add_comment(&Comment{id:"pin".into(),deck_id:"d".into(),slide_id:"b".into(),x:0.2,y:0.3,body:"keep".into(),author:"user".into(),status:"open".into(),selector:"".into(),created_at:now()}).unwrap();d.slides.pop();d.title="after".into();db.save_deck(&d,None).unwrap();assert_eq!(db.list_comments("d").len(),0);assert!(db.step_deck_history(&serde_json::from_value(json!({"id":"d"})).unwrap(),"undo").is_err());drop(db);let db=Db::open(path.clone()).unwrap();let undone=db.step_deck_history(&d,"undo").unwrap();assert_eq!(undone.slides.len(),2);assert_eq!(undone.title,"before");assert_eq!(db.list_comments("d").len(),1);let redone=db.step_deck_history(&undone,"redo").unwrap();assert_eq!(redone.slides.len(),1);assert!(db.list_comments("d").is_empty());let mut new=redone.clone();new.title="branch".into();db.save_deck(&new,None).unwrap();assert_eq!(db.deck_history_counts("d")[1],0);drop(db);let _=std::fs::remove_file(path);}
#[test]fn failed_save_rolls_back_history_and_pins(){let db=Db::open(std::env::temp_dir().join(format!("history-fail-{}.db",new_id("t")))).unwrap();let d:Deck=serde_json::from_value(json!({"id":"d","slides":[{"id":"s","html":"old"}]})).unwrap();db.save_deck(&d,None).unwrap();db.conn.lock().unwrap().execute_batch("CREATE TRIGGER fail_save BEFORE UPDATE ON decks BEGIN SELECT RAISE(ABORT,'forced'); END;").unwrap();let mut next=d.clone();next.slides[0].html="new".into();assert!(db.save_deck(&next,None).is_err());assert_eq!(db.deck_history_counts("d"),[0,0]);assert_eq!(db.get_deck("d").unwrap().slides[0].html,"old");assert!(db.list_revisions("s",10).is_empty());}
}

impl Db{
 /// Read deck, assets and pins under one database snapshot. Never silently export empty rows after a query error.
 pub fn portable_snapshot(&self,id:&str)->Result<(Deck,Vec<Asset>,Vec<Comment>),String>{
 let mut c=self.conn.lock().unwrap();let tx=c.transaction().map_err(|e|e.to_string())?;
 let raw:String=tx.query_row("SELECT doc FROM decks WHERE id=?1",params![id],|r|r.get(0)).map_err(|_|"Project not found")?;
 let deck:Deck=serde_json::from_str(&raw).map_err(|_|"Invalid project data")?;
 let assets={let mut q=tx.prepare("SELECT id,deck_id,name,mime,data,meta,created_at,reference_role,reference_status,provenance FROM assets WHERE deck_id=?1 ORDER BY created_at ASC").map_err(|e|e.to_string())?;let rows=q.query_map(params![id],|r|{let meta:String=r.get(5)?;Ok(Asset{id:r.get(0)?,deck_id:r.get(1)?,name:r.get(2)?,mime:r.get(3)?,data:r.get(4)?,profile:serde_json::from_str(&meta).ok(),created_at:r.get(6)?,provenance:serde_json::from_str(&r.get::<_,String>(9)?).unwrap_or(None),reference_role:r.get(7)?,reference_status:r.get(8)?})}).map_err(|e|e.to_string())?;rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?};
 let comments=history_comments(&tx,id).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;Ok((deck,assets,comments))
 }
}
#[cfg(test)]mod bounded_history_tests{use super::*;use serde_json::json;
#[test]fn history_count_bound_and_title_only_revisions(){let path=std::env::temp_dir().join(format!("bounded-{}.db",new_id("t")));let db=Db::open(path.clone()).unwrap();let mut d:Deck=serde_json::from_value(json!({"id":"d","slides":[{"id":"s","html":"same","title":"zero"}]})).unwrap();db.save_deck(&d,None).unwrap();for n in 0..40{d.slides[0].title=format!("title{n}");db.save_deck(&d,None).unwrap();}assert_eq!(db.deck_history_counts("d"),[30,0]);let r=db.list_revisions("s",24);assert_eq!(r.len(),24);assert_eq!(r[0].title,"title38");assert_eq!(db.portable_snapshot("d").unwrap().0.slides[0].title,"title39");assert!(db.portable_snapshot("absent").is_err());drop(db);let _=std::fs::remove_file(path);}
}

#[cfg(test)]mod checked_save_tests{use super::*;use serde_json::json;
#[test]fn stale_manual_save_cannot_overwrite_agent_or_unrelated_edits(){let p=std::env::temp_dir().join(format!("checked-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();let base:Deck=serde_json::from_value(json!({"id":"d","slides":[{"id":"s","html":"original"}]})).unwrap();db.save_deck(&base,None).unwrap();let mut agent=base.clone();agent.slides[0].html="agent accepted".into();db.commit_slide_candidate(&base,0,&agent.slides[0]).unwrap();let mut manual=base.clone();manual.title="local unsaved".into();assert!(db.save_deck_checked(&manual,None,Some(&base)).is_err());let current=db.get_deck("d").unwrap();assert_eq!(current.slides[0].html,"agent accepted");assert_eq!(current.title,"");assert_eq!(db.deck_history_counts("d"),[1,0]);let mut fresh=current.clone();fresh.title="explicit fresh edit".into();db.save_deck_checked(&fresh,None,Some(&current)).unwrap();assert_eq!(db.get_deck("d").unwrap().title,"explicit fresh edit");drop(db);let _=std::fs::remove_file(p);}
}

#[cfg(test)]mod history_byte_tests{use super::*;use serde_json::json;
#[test]fn byte_budget_prunes_old_rows_and_delete_is_atomic(){let p=std::env::temp_dir().join(format!("history-budget-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();let d:Deck=serde_json::from_value(json!({"id":"d","slides":[]})).unwrap();db.save_deck(&d,None).unwrap();{let conn=db.conn.lock().unwrap();for _ in 0..2{conn.execute("INSERT INTO deck_history(deck_id,direction,doc,comments) VALUES('d','undo',zeroblob(35000000),'[]')",[]).unwrap();}push_deck_history(&conn,&d,"undo").unwrap();let size:i64=conn.query_row("SELECT sum(length(doc)+length(comments)) FROM deck_history WHERE deck_id='d'",[],|r|r.get(0)).unwrap();assert!(size<=67108864);conn.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT,'forced'); END;").unwrap();conn.execute("INSERT INTO messages(id,deck_id,role,content,created_at) VALUES('m','d','user','test','')",[]).unwrap();}assert!(db.delete_deck("d").is_err());assert!(db.get_deck("d").is_some());assert_eq!(db.deck_history_counts("d"),[2,0]);drop(db);let _=std::fs::remove_file(p);}
}

#[cfg(test)]mod recent_project_tests{use super::*;use serde_json::json;
#[test]fn saving_old_project_moves_it_to_recent_without_rewriting_creation_time(){let p=std::env::temp_dir().join(format!("recents-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();let mut first:Deck=serde_json::from_value(json!({"id":"first","createdAt":"2000-01-01T00:00:00Z"})).unwrap();let second:Deck=serde_json::from_value(json!({"id":"second","createdAt":"2001-01-01T00:00:00Z"})).unwrap();db.save_deck(&first,None).unwrap();db.save_deck(&second,None).unwrap();first.title="edited old project".into();db.save_deck(&first,None).unwrap();let recent=db.list_decks();assert_eq!(recent[0].id,"first");assert!(recent[0].updated_at>"2020".to_string());assert_eq!(db.get_deck("first").unwrap().created_at,"2000-01-01T00:00:00Z");drop(db);let _=std::fs::remove_file(p);}
}

impl Db {
 pub fn set_asset_provenance(&self,deck_id:&str,id:&str,value:&crate::model::AssetProvenance)->Result<(),String>{
  value.validate()?;let text=serde_json::to_string(value).map_err(|e|e.to_string())?;
  let count=self.conn.lock().map_err(|_|"Database unavailable")?.execute("UPDATE assets SET provenance=?1 WHERE id=?2 AND deck_id=?3",params![text,id,deck_id]).map_err(|e|e.to_string())?;
  if count!=1{return Err("Asset not found in this project".into())}Ok(())
 }
 pub fn library_assets(&self)->Vec<Asset>{
  let conn=self.conn.lock().unwrap();let mut q=match conn.prepare("SELECT a.id,a.deck_id,a.name,a.mime,a.meta,a.created_at,a.reference_role,a.reference_status,a.provenance FROM assets a JOIN decks d ON d.id=a.deck_id WHERE a.mime LIKE 'image/%' AND substr(a.name,1,8) != '__render' ORDER BY d.updated_at DESC,a.created_at ASC"){Ok(q)=>q,Err(_)=>return vec![]};
  let rows=q.query_map([],|r|Ok(Asset{id:r.get(0)?,deck_id:r.get(1)?,name:r.get(2)?,mime:r.get(3)?,data:String::new(),profile:serde_json::from_str(&r.get::<_,String>(4)?).ok(),created_at:r.get(5)?,reference_role:r.get(6)?,reference_status:r.get(7)?,provenance:serde_json::from_str(&r.get::<_,String>(8)?).unwrap_or(None)}));
  match rows{Ok(r)=>r.filter_map(Result::ok).collect(),Err(_)=>vec![]}
 }
 pub fn asset_by_id(&self,deck:&str,id:&str)->Result<Asset,String>{
  self.conn.lock().map_err(|_|"Database unavailable")?.query_row("SELECT id,deck_id,name,mime,data,meta,created_at,reference_role,reference_status,provenance FROM assets WHERE id=?1 AND deck_id=?2 AND mime LIKE 'image/%'",params![id,deck],|r|Ok(Asset{id:r.get(0)?,deck_id:r.get(1)?,name:r.get(2)?,mime:r.get(3)?,data:r.get(4)?,profile:serde_json::from_str(&r.get::<_,String>(5)?).ok(),created_at:r.get(6)?,reference_role:r.get(7)?,reference_status:r.get(8)?,provenance:serde_json::from_str(&r.get::<_,String>(9)?).unwrap_or(None)})).map_err(|_|"Image not found in this project".into())
 }
 pub fn copy_library_asset(&self,target:&str,source_deck:&str,id:&str)->Result<Asset,String>{
  if self.get_deck(target).is_none(){return Err("Destination project not found".into())}
  let mut asset=self.asset_by_id(source_deck,id)?;if asset.name.starts_with("__render"){return Err("Internal image is not a library asset".into())}
  asset.id=new_id("ref");asset.deck_id=Some(target.into());asset.created_at=now();
  self.add_asset(&asset).map_err(|e|e.to_string())?;Ok(asset)
 }
}

#[cfg(test)]mod library_tests{use super::*;use serde_json::json;use crate::model::AssetProvenance;
fn fixture(db:&Db)->Asset{for id in ["source","target"]{db.save_deck(&serde_json::from_value(json!({"id":id})).unwrap(),None).unwrap();}let a:Asset=serde_json::from_value(json!({"id":"a","deckId":"source","name":"Original","mime":"image/png","data":"AAAA"})).unwrap();db.add_asset(&a).unwrap();a}
#[test]fn provenance_survives_restart_and_rejects_wrong_scope(){let p=std::env::temp_dir().join(format!("provenance-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();fixture(&db);let note=AssetProvenance{source_url:"https://example.test/image".into(),creator:"Creator".into(),rights_note:"User-supplied, not verified".into(),alt_text:"A circle".into(),medium:"".into()};assert!(db.set_asset_provenance("target","a",&note).is_err());let mut bad=note.clone();bad.source_url="javascript:alert(1)".into();assert!(db.set_asset_provenance("source","a",&bad).is_err());bad=note.clone();bad.rights_note="x".repeat(4001);assert!(db.set_asset_provenance("source","a",&bad).is_err());db.set_asset_provenance("source","a",&note).unwrap();drop(db);let db=Db::open(p.clone()).unwrap();assert_eq!(db.list_assets("source")[0].provenance,Some(note));assert_eq!(db.list_assets("source")[0].data,"AAAA");assert!(db.library_assets().iter().all(|a|a.data.is_empty()));drop(db);let _=std::fs::remove_file(p);}
#[test]fn copied_asset_is_independent_and_keeps_provenance(){let p=std::env::temp_dir().join(format!("library-copy-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();fixture(&db);let note=AssetProvenance{rights_note:"Check license".into(),..Default::default()};db.set_asset_provenance("source","a",&note).unwrap();assert!(db.copy_library_asset("missing","source","a").is_err());assert!(db.copy_library_asset("target","wrong","a").is_err());let copy=db.copy_library_asset("target","source","a").unwrap();assert_ne!(copy.id,"a");assert_eq!(copy.provenance,Some(note.clone()));assert_eq!(copy.data,"AAAA");db.set_asset_provenance("target",&copy.id,&AssetProvenance::default()).unwrap();db.delete_asset("a").unwrap();assert_eq!(db.list_assets("target")[0].data,"AAAA");assert_eq!(db.list_assets("target")[0].provenance,Some(AssetProvenance::default()));drop(db);let _=std::fs::remove_file(p);}
}

impl Db{
 pub fn list_brands(&self)->Vec<BrandProfile>{let c=self.conn.lock().unwrap();let mut q=match c.prepare("SELECT doc FROM brand_profiles ORDER BY rowid DESC"){Ok(q)=>q,Err(_)=>return vec![]};let rows=q.query_map([],|r|r.get::<_,String>(0));match rows{Ok(r)=>r.filter_map(Result::ok).filter_map(|s|serde_json::from_str(&s).ok()).collect(),Err(_)=>vec![]}}
 pub fn save_brand(&self,brand:&BrandProfile)->Result<(),String>{brand.validate()?;let mut b=brand.clone();b.updated_at=now();self.conn.lock().map_err(|_|"Database unavailable")?.execute("INSERT INTO brand_profiles(id,doc)VALUES(?1,?2)ON CONFLICT(id)DO UPDATE SET doc=excluded.doc",params![b.id,serde_json::to_string(&b).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;Ok(())}
 pub fn delete_brand(&self,id:&str)->Result<(),String>{self.conn.lock().map_err(|_|"Database unavailable")?.execute("DELETE FROM brand_profiles WHERE id=?1",params![id]).map_err(|e|e.to_string())?;Ok(())}
}

#[cfg(test)]mod brand_tests{use super::*;
#[test]fn brands_persist_validate_and_delete_without_touching_projects(){let p=std::env::temp_dir().join(format!("brand-{}.db",new_id("t")));let db=Db::open(p.clone()).unwrap();let b=BrandProfile{id:"brand".into(),name:"Editorial".into(),style_guide:"Quiet grid".into(),palette:vec!["#aabbcc".into()],brand_handle:"@fixture".into(),save_label:"Keep this".into(),updated_at:String::new()};let mut bad=b.clone();bad.palette=vec!["red;bad".into()];assert!(db.save_brand(&bad).is_err());bad=b.clone();bad.name=" ".into();assert!(db.save_brand(&bad).is_err());db.save_brand(&b).unwrap();drop(db);let db=Db::open(p.clone()).unwrap();assert_eq!(db.list_brands()[0].style_guide,"Quiet grid");assert_eq!(db.list_brands()[0].palette,vec!["#aabbcc"]);db.delete_brand("brand").unwrap();assert!(db.list_brands().is_empty());drop(db);let _=std::fs::remove_file(p);}}

impl Db{
 /// User-facing reads must distinguish absent records from failed/corrupt storage.
 pub fn get_deck_checked(&self,id:&str)->Result<Option<Deck>,String>{
  let conn=self.conn.lock().map_err(|_|"Project database unavailable")?;let raw:Option<String>=conn.query_row("SELECT doc FROM decks WHERE id=?1",params![id],|r|r.get(0)).optional().map_err(|_|"Cannot read saved project")?;
  raw.map(|s|serde_json::from_str::<Deck>(&s).map_err(|_|"Saved project is damaged; original record was not changed".into())).transpose()
 }
 pub fn list_decks_checked(&self)->Result<Vec<DeckSummary>,String>{
  let conn=self.conn.lock().map_err(|_|"Project database unavailable")?;let mut q=conn.prepare("SELECT id,title,aspect,doc,thumbnail,updated_at FROM decks ORDER BY updated_at DESC").map_err(|_|"Cannot read project list")?;
  let rows=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,String>(5)?))).map_err(|_|"Cannot read project list")?;
  rows.map(|r|{let(id,title,aspect,raw,thumbnail,updated_at)=r.map_err(|_|"Cannot read project record")?;let deck:Deck=serde_json::from_str(&raw).map_err(|_|"A saved project is damaged; no records were changed")?;if deck.id!=id{return Err("Saved project identity mismatch".into())}Ok(DeckSummary{id,title,aspect,slide_count:deck.slides.len(),thumbnail,updated_at})}).collect()
 }
 pub fn get_settings_checked(&self)->Result<AppSettings,String>{let c=self.conn.lock().map_err(|_|"Settings database unavailable")?;let raw:Option<String>=c.query_row("SELECT value FROM settings WHERE key='app'",[],|r|r.get(0)).optional().map_err(|_|"Cannot read settings")?;match raw{Some(s)=>serde_json::from_str(&s).map_err(|_|"Saved settings are damaged; original record was not changed".into()),None=>Ok(AppSettings::default())}}
}
#[cfg(test)]mod checked_read_tests{use super::*;use serde_json::json;
#[test]fn damaged_project_does_not_become_missing_or_empty(){let p=std::env::temp_dir().join(format!("checked-{}",new_id("t")));let db=Db::open(p.clone()).unwrap();assert!(db.get_deck_checked("missing").unwrap().is_none());let d:Deck=serde_json::from_value(json!({"id":"saved"})).unwrap();db.save_deck(&d,None).unwrap();db.conn.lock().unwrap().execute("UPDATE decks SET doc='broken json' WHERE id='saved'",[]).unwrap();assert!(db.get_deck_checked("saved").is_err());assert!(db.list_decks_checked().is_err());let raw:String=db.conn.lock().unwrap().query_row("SELECT doc FROM decks WHERE id='saved'",[],|r|r.get(0)).unwrap();assert_eq!(raw,"broken json");drop(db);let _=std::fs::remove_file(p);}
#[test]fn settings_damage_and_sql_errors_are_not_defaults(){let p=std::env::temp_dir().join(format!("settings-checked-{}",new_id("t")));let db=Db::open(p.clone()).unwrap();assert!(db.get_settings_checked().is_ok());db.conn.lock().unwrap().execute("INSERT INTO settings(key,value)VALUES('app','broken json')",[]).unwrap();assert!(db.get_settings_checked().is_err());db.conn.lock().unwrap().execute("DROP TABLE decks",[]).unwrap();assert!(db.get_deck_checked("anything").is_err());assert!(db.list_decks_checked().is_err());drop(db);let _=std::fs::remove_file(p);}}

#[cfg(test)]mod damaged_save_tests{use super::*;use serde_json::json;
#[test]fn unconditional_save_preserves_corrupt_and_mismatched_records(){
 let p=std::env::temp_dir().join(format!("damaged-save-{}",new_id("t")));let db=Db::open(p.clone()).unwrap();
 let d:Deck=serde_json::from_value(json!({"id":"d","title":"Original"})).unwrap();db.save_deck(&d,None).unwrap();
 for raw in ["broken json".to_string(),serde_json::to_string(&Deck{id:"other".into(),..d.clone()}).unwrap()]{
  db.conn.lock().unwrap().execute("UPDATE decks SET doc=?1 WHERE id='d'",params![raw]).unwrap();
  assert!(db.save_deck(&d,None).is_err());
  let after:String=db.conn.lock().unwrap().query_row("SELECT doc FROM decks WHERE id='d'",[],|r|r.get(0)).unwrap();assert_eq!(after,raw);assert_eq!(db.deck_history_counts("d"),[0,0]);
 }
 drop(db);let _=std::fs::remove_file(p);
}
}

// Durable runs are a journal, never a replay queue. A running entry after a
// restart means interrupted/unknown, not permission to execute tools again.
impl Db{
 pub fn begin_creator_run(&self,id:&str,deck_id:&str,request:&serde_json::Value,msg:&ChatMessage)->Result<(),String>{
  let mut c=self.conn.lock().map_err(|_|"Run database unavailable")?;
  c.execute_batch("CREATE TABLE IF NOT EXISTS creator_runs(id TEXT PRIMARY KEY,deck_id TEXT NOT NULL,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS creator_steps(run_id TEXT NOT NULL,call_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(run_id,call_id));").map_err(|e|e.to_string())?;
  let tx=c.transaction().map_err(|e|e.to_string())?;
  let doc=serde_json::json!({"id":id,"deckId":deck_id,"request":request,"state":"running","updatedAt":now(),"lastEvent":"started"});
  tx.execute("INSERT INTO creator_runs(id,deck_id,doc)VALUES(?1,?2,?3)",params![id,deck_id,doc.to_string()]).map_err(|_|"Run ID already exists; nothing was replayed")?;
  tx.execute("INSERT INTO messages(id,deck_id,role,content,tool_calls,tool_call_id,created_at)VALUES(?1,?2,?3,?4,'[]',NULL,?5)",params![msg.id,msg.deck_id,msg.role,msg.content,msg.created_at]).map_err(|e|e.to_string())?;
  tx.commit().map_err(|e|e.to_string())
 }
 pub fn creator_runs(&self,deck_id:&str)->Result<Vec<serde_json::Value>,String>{
  let c=self.conn.lock().map_err(|_|"Run database unavailable")?;c.execute_batch("CREATE TABLE IF NOT EXISTS creator_runs(id TEXT PRIMARY KEY,deck_id TEXT NOT NULL,doc TEXT NOT NULL);").map_err(|e|e.to_string())?;
  let mut q=c.prepare("SELECT doc FROM creator_runs WHERE deck_id=?1 ORDER BY rowid DESC LIMIT 20").map_err(|e|e.to_string())?;
  let rows=q.query_map(params![deck_id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
  rows.map(|r|serde_json::from_str(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect()
 }
 pub fn checkpoint_creator_run(&self,id:&str,state:&str,event:&str)->Result<(),String>{
  let c=self.conn.lock().map_err(|_|"Run database unavailable")?;
  let raw:String=c.query_row("SELECT doc FROM creator_runs WHERE id=?1",params![id],|r|r.get(0)).map_err(|e|e.to_string())?;
  let mut doc:serde_json::Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;doc["state"]=serde_json::json!(state);doc["lastEvent"]=serde_json::json!(event);doc["updatedAt"]=serde_json::json!(now());
  c.execute("UPDATE creator_runs SET doc=?2 WHERE id=?1",params![id,doc.to_string()]).map_err(|e|e.to_string())?;Ok(())
 }
 /// Journal-derived resume plan: what finished (never repeat), what has an unknown outcome (inspect first).
 /// `safe_boundary` is true only when no step is left in an uncertain state.
 pub fn creator_resume_plan(&self,run:&str)->Result<serde_json::Value,String>{
  let c=self.conn.lock().map_err(|_|"Run database unavailable")?;
  let exists:bool=c.query_row("SELECT 1 FROM creator_runs WHERE id=?1",params![run],|_|Ok(true)).unwrap_or(false);
  if !exists{return Err("Unknown run".into())}
  let mut q=c.prepare("SELECT call_id,doc FROM creator_steps WHERE run_id=?1 ORDER BY rowid").map_err(|e|e.to_string())?;
  let rows=q.query_map(params![run],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
  let(mut finished,mut uncertain)=(Vec::new(),Vec::new());
  for row in rows{let(call,raw)=row.map_err(|e|e.to_string())?;let d:serde_json::Value=serde_json::from_str(&raw).unwrap_or_default();let name=d["name"].as_str().unwrap_or("unknown").to_string();let item=serde_json::json!({"callId":call,"tool":name});if d["state"]=="finished"{finished.push(item)}else{uncertain.push(item)}}
  Ok(serde_json::json!({"runId":run,"finished":finished,"uncertain":uncertain,"safeBoundary":uncertain.is_empty()}))
 }
 pub fn creator_step(&self,run:&str,call:&str,name:&str,state:&str)->Result<(),String>{
  let c=self.conn.lock().map_err(|_|"Run database unavailable")?;
  let doc=serde_json::json!({"name":name,"state":state,"updatedAt":now()});
  if state=="started"{c.execute("INSERT INTO creator_steps(run_id,call_id,doc)VALUES(?1,?2,?3)",params![run,call,doc.to_string()]).map_err(|_|"Tool ID already journaled; execution blocked, not replayed")?;}else{c.execute("UPDATE creator_steps SET doc=?3 WHERE run_id=?1 AND call_id=?2",params![run,call,doc.to_string()]).map_err(|e|e.to_string())?;}Ok(())
 }
}
#[cfg(test)]mod creator_journal_tests{use super::*;use serde_json::json;
 #[test]fn restart_keeps_receipts_and_duplicate_never_replays(){let p=std::env::temp_dir().join(new_id("journal"));let db=Db::open(p.clone()).unwrap();let m:ChatMessage=serde_json::from_value(json!({"id":"m","deckId":"d","role":"user","content":"brief","createdAt":"now"})).unwrap();db.begin_creator_run("r","d",&json!({"text":"brief"}),&m).unwrap();assert!(db.begin_creator_run("r","d",&json!({}),&m).is_err());assert_eq!(db.list_messages("d").len(),1);db.creator_step("r","call","write_slide","started").unwrap();assert!(db.creator_step("r","call","write_slide","started").is_err());drop(db);let db=Db::open(p.clone()).unwrap();assert_eq!(db.creator_runs("d").unwrap()[0]["state"],"running");assert!(db.creator_runs("other").unwrap().is_empty());db.creator_step("r","call","write_slide","finished").unwrap();db.checkpoint_creator_run("r","settled","Review results").unwrap();assert_eq!(db.creator_runs("d").unwrap()[0]["state"],"settled");drop(db);let _=std::fs::remove_file(p);}
}

#[cfg(test)]
mod resume_plan_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn resume_plan_separates_finished_from_uncertain_and_survives_restart() {
        let p = std::env::temp_dir().join(new_id("resume"));
        let db = Db::open(p.clone()).unwrap();
        let m: ChatMessage = serde_json::from_value(json!({"id":"m","deckId":"d","role":"user","content":"b","createdAt":"now"})).unwrap();
        db.begin_creator_run("r", "d", &json!({"text":"b"}), &m).unwrap();
        db.creator_step("r", "c1", "write_slide", "started").unwrap();
        db.creator_step("r", "c1", "write_slide", "finished").unwrap();
        db.creator_step("r", "c2", "add_asset", "started").unwrap();
        drop(db);
        let db = Db::open(p.clone()).unwrap();
        let plan = db.creator_resume_plan("r").unwrap();
        assert_eq!(plan["finished"][0]["callId"], "c1");
        assert_eq!(plan["uncertain"][0]["tool"], "add_asset");
        assert_eq!(plan["safeBoundary"], false);
        db.creator_step("r", "c2", "add_asset", "finished").unwrap();
        assert_eq!(db.creator_resume_plan("r").unwrap()["safeBoundary"], true);
        assert!(db.creator_resume_plan("ghost").is_err());
        drop(db);
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(test)]
mod branch_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn branch_state_persists_validates_and_is_cleared() {
        let p = std::env::temp_dir().join(new_id("branches"));
        let db = Db::open(p.clone()).unwrap();
        for id in ["u1", "a1", "u2"] {
            let m: ChatMessage = serde_json::from_value(json!({"id":id,"deckId":"d","role":"user","content":"x","createdAt":"now"})).unwrap();
            db.append_message(&m).unwrap();
        }
        let ok = json!({"nodes":[{"messageId":"u1","parentId":null,"branchId":"main"},{"messageId":"u2","parentId":"u1","branchId":"b"}],"activeLeaf":"u2"});
        db.save_chat_branches("d", &ok).unwrap();
        assert!(db.save_chat_branches("d", &json!({"nodes":[{"messageId":"ghost"}],"activeLeaf":null})).is_err());
        assert!(db.save_chat_branches("other", &ok).is_err());
        assert!(db.save_chat_branches("d", &json!({"nodes":[],"activeLeaf":"ghost"})).is_err());
        drop(db);
        let db = Db::open(p.clone()).unwrap();
        assert_eq!(db.chat_branches("d").unwrap()["activeLeaf"], "u2");
        assert!(db.chat_branches("other").is_none());
        // fork: u1 -> u2 (a2 reply untracked), then fork from u1 and send u3
        let a2: ChatMessage = serde_json::from_value(json!({"id":"a2","deckId":"d","role":"assistant","content":"r","createdAt":"now"})).unwrap();
        db.append_message(&a2).unwrap();
        assert_eq!(db.active_history("d").len(), 4);
        db.save_chat_branches("d", &json!({"nodes":[{"messageId":"u1","parentId":null,"branchId":"main"},{"messageId":"u2","parentId":"u1","branchId":"main"}],"activeLeaf":"u1"})).unwrap();
        let u3: ChatMessage = serde_json::from_value(json!({"id":"u3","deckId":"d","role":"user","content":"x","createdAt":"now"})).unwrap();
        db.append_message(&u3).unwrap();
        db.track_user_turn("d", "u3").unwrap();
        let ids: Vec<String> = db.active_history("d").into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["u1","a1","u3"]);
        assert_eq!(db.chat_branches("d").unwrap()["activeLeaf"], "u3");
        db.clear_messages("d").unwrap();
        assert!(db.chat_branches("d").is_none());
        drop(db);
        let _ = std::fs::remove_file(p);
    }
    #[test]
    fn creator_workspace_mirror_persists_validates_and_follows_project_delete() {
        let p = std::env::temp_dir().join(new_id("ws"));
        let db = Db::open(p.clone()).unwrap();
        let d: Deck = serde_json::from_value(serde_json::json!({"id":"d","slides":[]})).unwrap();
        db.save_deck(&d, None).unwrap();
        let ws = serde_json::json!({"draft":"x","queue":[],"memory":[{"id":"m","text":"t","source":"s","pinned":true,"kind":"fact"}],"mode":"edit","lockedSlideIds":["a"]});
        db.save_creator_workspace("d", &ws).unwrap();
        assert!(db.save_creator_workspace("d", &serde_json::json!({"draft":1})).is_err());
        assert!(db.save_creator_workspace("ghost", &ws).is_err());
        drop(db);
        let db = Db::open(p.clone()).unwrap();
        assert_eq!(db.creator_workspace("d").unwrap()["memory"][0]["id"], "m");
        assert!(db.creator_workspace("other").is_none());
        db.delete_deck("d").unwrap();
        assert!(db.creator_workspace("d").is_none());
        drop(db);
        let _ = std::fs::remove_file(p);
    }
}
