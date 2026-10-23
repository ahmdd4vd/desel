//! Tauri command surface.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use crate::agent;
use crate::db::{new_id, Db};
use crate::model::*;

pub struct AppState {
    pub db: Db,
}

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.db.get_settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    state
        .db
        .save_settings(&settings)
        .map_err(|e| format!("gagal menyimpan settings: {e}"))?;
    Ok(settings)
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let settings = state.db.get_settings();
    agent::fetch_models(&settings).await
}

#[tauri::command]
pub async fn test_connection(state: State<'_, AppState>) -> Result<Value, String> {
    let settings = state.db.get_settings();
    agent::test_connection(&settings).await
}

/* -------------------------------------------------------------------------- */
/* decks                                                                      */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn list_decks(state: State<'_, AppState>) -> Vec<DeckSummary> {
    state.db.list_decks()
}

#[tauri::command]
pub fn get_deck(state: State<'_, AppState>, id: String) -> Option<Deck> {
    state.db.get_deck(&id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDeckArgs {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub aspect: String,
    #[serde(default)]
    pub template_id: Option<String>,
}

#[tauri::command]
pub fn create_deck(state: State<'_, AppState>, args: CreateDeckArgs) -> Result<Deck, String> {
    let now = chrono::Utc::now().to_rfc3339();

    // Starting from a template copies its slides and style guide.
    let mut deck = if let Some(tid) = args.template_id.as_ref() {
        state
            .db
            .list_templates()
            .into_iter()
            .find(|t| &t.id == tid)
            .map(|t| {
                let mut d = t.deck;
                d.id = new_id("deck");
                d.from_template_id = Some(tid.clone());
                d.created_at = now.clone();
                d.updated_at = now.clone();
                d
            })
            .unwrap_or_else(|| blank_deck(&now))
    } else {
        blank_deck(&now)
    };

    if !args.title.trim().is_empty() {
        deck.title = args.title.trim().to_string();
    }
    if ["4:5", "1:1", "9:16"].contains(&args.aspect.as_str()) {
        deck.aspect = args.aspect.clone();
    }

    state
        .db
        .save_deck(&deck, None)
        .map_err(|e| format!("gagal membuat deck: {e}"))?;
    Ok(deck)
}

fn blank_deck(now: &str) -> Deck {
    Deck {
        id: new_id("deck"),
        title: "Untitled deck".into(),
        caption: String::new(),
        aspect: "4:5".into(),
        slides: Vec::new(),
        style_guide: String::new(),
        palette: Vec::new(),
        brand_handle: String::new(),
        save_label: "Save this post".into(),
        from_template_id: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}

#[tauri::command]
pub fn save_deck(
    state: State<'_, AppState>,
    deck: Deck,
    thumbnail: Option<String>,
) -> Result<Deck, String> {
    state
        .db
        .save_deck(&deck, thumbnail.as_deref())
        .map_err(|e| format!("gagal menyimpan deck: {e}"))?;
    Ok(deck)
}

#[tauri::command]
pub fn delete_deck(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .delete_deck(&id)
        .map_err(|e| format!("gagal menghapus deck: {e}"))
}

#[tauri::command]
pub fn duplicate_deck(state: State<'_, AppState>, id: String) -> Result<Deck, String> {
    let mut deck = state
        .db
        .get_deck(&id)
        .ok_or_else(|| "deck tidak ditemukan".to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    deck.id = new_id("deck");
    deck.title = format!("{} (copy)", deck.title);
    deck.created_at = now.clone();
    deck.updated_at = now.clone();
    state
        .db
        .save_deck(&deck, None)
        .map_err(|e| format!("gagal menduplikat deck: {e}"))?;
    Ok(deck)
}

/* -------------------------------------------------------------------------- */
/* chat                                                                       */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, deck_id: String) -> Vec<ChatMessage> {
    state.db.list_messages(&deck_id)
}

#[tauri::command]
pub fn clear_messages(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state
        .db
        .clear_messages(&deck_id)
        .map_err(|e| format!("gagal menghapus riwayat: {e}"))
}

#[tauri::command]
pub fn append_message(
    state: State<'_, AppState>,
    deck_id: String,
    role: String,
    content: String,
) -> Result<ChatMessage, String> {
    let msg = ChatMessage {
        id: new_id("msg"),
        deck_id,
        role,
        content,
        tool_calls: Vec::new(),
        tool_call_id: None,
        streaming: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .db
        .append_message(&msg)
        .map_err(|e| format!("gagal menyimpan pesan: {e}"))?;
    Ok(msg)
}

/// Starts the agent. Returns immediately; progress arrives on `channel`.
#[tauri::command]
pub async fn send_to_agent(
    state: State<'_, AppState>,
    deck_id: String,
    text: String,
    channel: Channel<AgentEvent>,
) -> Result<(), String> {
    let settings = state.db.get_settings();

    if settings.api_key.trim().is_empty()
        && !matches!(agent::provider_label(&settings.base_url).as_str(), "Local")
    {
        return Err(
            "API key belum diisi. Buka Settings (Ctrl+,) dan tambahkan key provider.".into(),
        );
    }

    // Persist the user turn first so a reload keeps the transcript intact.
    let user_msg = ChatMessage {
        id: new_id("msg"),
        deck_id: deck_id.clone(),
        role: "user".into(),
        content: text,
        tool_calls: Vec::new(),
        tool_call_id: None,
        streaming: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .db
        .append_message(&user_msg)
        .map_err(|e| format!("gagal menyimpan pesan: {e}"))?;

    let history = state.db.list_messages(&deck_id);
    let db = &state.db;
    agent::run_agent(db, &settings, &deck_id, history, channel).await;

    Ok(())
}

/* -------------------------------------------------------------------------- */
/* templates                                                                  */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> Vec<TemplateRecord> {
    state.db.list_templates()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplateArgs {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub deck: Deck,
}

#[tauri::command]
pub fn save_template(
    state: State<'_, AppState>,
    args: SaveTemplateArgs,
) -> Result<TemplateRecord, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let record = TemplateRecord {
        id: new_id("tpl"),
        name: args.name,
        description: args.description,
        deck: args.deck,
        created_at: now.clone(),
        updated_at: now,
    };
    state
        .db
        .save_template(&record)
        .map_err(|e| format!("gagal menyimpan template: {e}"))?;
    Ok(record)
}

#[tauri::command]
pub fn delete_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .delete_template(&id)
        .map_err(|e| format!("gagal menghapus template: {e}"))
}

/* -------------------------------------------------------------------------- */
/* comments                                                                   */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn list_comments(state: State<'_, AppState>, deck_id: String) -> Vec<Comment> {
    state.db.list_comments(&deck_id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddCommentArgs {
    pub deck_id: String,
    pub slide_id: String,
    pub x: f64,
    pub y: f64,
    pub body: String,
    #[serde(default)]
    pub author: String,
    /// Element the note points at, e.g. `h1.hero` or `div.badge > span`.
    #[serde(default)]
    pub selector: String,
}

#[tauri::command]
pub fn add_comment(state: State<'_, AppState>, args: AddCommentArgs) -> Result<Comment, String> {
    let comment = Comment {
        id: new_id("cm"),
        deck_id: args.deck_id,
        slide_id: args.slide_id,
        x: args.x,
        y: args.y,
        body: args.body,
        author: if args.author.is_empty() {
            "user".into()
        } else {
            args.author
        },
        status: "open".into(),
        selector: args.selector,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .db
        .add_comment(&comment)
        .map_err(|e| format!("gagal menambah komentar: {e}"))?;
    Ok(comment)
}

#[tauri::command]
pub fn set_comment_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> Result<(), String> {
    state
        .db
        .update_comment_status(&id, &status)
        .map_err(|e| format!("gagal memperbarui komentar: {e}"))
}

#[tauri::command]
pub fn delete_comment(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .delete_comment(&id)
        .map_err(|e| format!("gagal menghapus komentar: {e}"))
}

/* -------------------------------------------------------------------------- */
/* export                                                                     */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub name: String,
    #[serde(default = "default_b64")]
    pub encoding: String,
    pub data: String,
}

fn default_b64() -> String {
    "base64".into()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub directory: String,
    pub files: Vec<String>,
}

#[tauri::command]
pub fn export_default_dir(state: State<'_, AppState>, slug: String) -> String {
    let settings = state.db.get_settings();
    if let Some(dir) = settings.export_dir.filter(|d| !d.trim().is_empty()) {
        return std::path::Path::new(&dir)
            .join(&slug)
            .to_string_lossy()
            .to_string();
    }
    match dirs::picture_dir() {
        Some(pics) => pics.join("Desel").join(&slug).to_string_lossy().to_string(),
        None => format!("./exports/{slug}"),
    }
}

#[tauri::command]
pub fn write_export(
    state: State<'_, AppState>,
    directory: String,
    files: Vec<ExportFile>,
    remember_dir: Option<String>,
) -> Result<ExportOutcome, String> {
    use base64::Engine;

    let dir = std::path::PathBuf::from(&directory);
    std::fs::create_dir_all(&dir).map_err(|e| format!("gagal membuat folder: {e}"))?;

    let mut written = Vec::new();
    for file in files {
        let name = std::path::Path::new(&file.name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| format!("nama file tidak valid: {}", file.name))?;

        let target = dir.join(&name);
        match file.encoding.as_str() {
            "utf8" => std::fs::write(&target, file.data.as_bytes())
                .map_err(|e| format!("gagal menulis {name}: {e}"))?,
            _ => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(file.data.as_bytes())
                    .map_err(|e| format!("base64 tidak valid untuk {name}: {e}"))?;
                std::fs::write(&target, bytes).map_err(|e| format!("gagal menulis {name}: {e}"))?;
            }
        }
        written.push(target.to_string_lossy().to_string());
    }

    if let Some(remember) = remember_dir.filter(|d| !d.trim().is_empty()) {
        let mut settings = state.db.get_settings();
        settings.export_dir = Some(remember);
        let _ = state.db.save_settings(&settings);
    }

    Ok(ExportOutcome {
        directory: dir.to_string_lossy().to_string(),
        files: written,
    })
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("path tidak ditemukan: {path}"));
    }
    let folder = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "folder tidak ditemukan".to_string())?
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder)
            .spawn()
            .map_err(|e| format!("gagal membuka explorer: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Diagnostics used by the settings panel.
#[tauri::command]
pub fn storage_info(state: State<'_, AppState>) -> Value {
    let decks = state.db.list_decks();
    let templates = state.db.list_templates();
    json!({
        "decks": decks.len(),
        "templates": templates.len(),
        "provider": agent::provider_label(&state.db.get_settings().base_url)
    })
}

/// Design findings per slide, shown in the inspector.
#[tauri::command]
pub fn lint_deck(state: State<'_, AppState>, id: String) -> Vec<crate::lint::SlideLint> {
    match state.db.get_deck(&id) {
        Some(deck) => crate::lint::lint_deck(&deck),
        None => Vec::new(),
    }
}

/// Previous versions of one slide, newest first.
#[tauri::command]
pub fn list_revisions(state: State<'_, AppState>, slide_id: String) -> Vec<SlideRevision> {
    state.db.list_revisions(&slide_id, 12)
}

/// Puts an older version back. The version being replaced is snapshotted too, so
/// restoring is itself undoable.
#[tauri::command]
pub fn restore_revision(state: State<'_, AppState>, id: String) -> Result<Deck, String> {
    let revision = state
        .db
        .get_revision(&id)
        .ok_or_else(|| "versi itu sudah tidak tersimpan".to_string())?;
    let mut deck = state
        .db
        .get_deck(&revision.deck_id)
        .ok_or_else(|| "deck-nya sudah dihapus".to_string())?;

    let mut restored = false;
    for slide in deck.slides.iter_mut() {
        if slide.id != revision.slide_id {
            continue;
        }
        slide.html = revision.html.clone();
        if !revision.title.trim().is_empty() {
            slide.title = revision.title.clone();
        }
        restored = true;
    }
    if !restored {
        return Err("slide itu sudah tidak ada di deck".into());
    }

    deck.updated_at = chrono::Utc::now().to_rfc3339();
    state.db.save_deck(&deck, None).map_err(|e| e.to_string())?;
    Ok(deck)
}

/* -------------------------------------------------------------------------- */
/* visual references                                                          */
/* -------------------------------------------------------------------------- */

const MAX_REFERENCE_BYTES: usize = 8 * 1024 * 1024;

fn guess_mime(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    }
}

fn insert_reference(
    state: &State<'_, AppState>,
    deck_id: &str,
    name: String,
    mime: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.len() > MAX_REFERENCE_BYTES {
        return Err(format!(
            "gambar terlalu besar ({} MB, maksimal 8 MB).",
            bytes.len() / 1_048_576
        ));
    }
    use base64::Engine as _;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let profile = crate::palette::analyse(&bytes);
    state
        .db
        .add_asset(&Asset {
            id: new_id("ref"),
            deck_id: Some(deck_id.to_string()),
            name,
            mime,
            data,
            profile,
            created_at: chrono::Utc::now().to_rfc3339(),
        })
        .map_err(|e| format!("gagal menyimpan referensi: {e}"))
}

#[tauri::command]
pub fn list_references(state: State<'_, AppState>, deck_id: String) -> Vec<Asset> {
    state.db.list_asset_summaries(&deck_id)
}

/// Reads images straight off disk — used by the native file picker.
#[tauri::command]
pub fn add_reference_paths(
    state: State<'_, AppState>,
    deck_id: String,
    paths: Vec<String>,
) -> Result<Vec<Asset>, String> {
    for raw in paths {
        let path = std::path::PathBuf::from(&raw);
        let bytes =
            std::fs::read(&path).map_err(|e| format!("gagal membaca {}: {e}", path.display()))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("reference")
            .to_string();
        insert_reference(&state, &deck_id, name, guess_mime(&path).to_string(), bytes)?;
    }
    Ok(state.db.list_asset_summaries(&deck_id))
}

/// Accepts a data URL — used by drag & drop and the browser build.
#[tauri::command]
pub fn add_reference_data(
    state: State<'_, AppState>,
    deck_id: String,
    name: String,
    data_url: String,
) -> Result<Vec<Asset>, String> {
    use base64::Engine as _;

    let (mime, payload) = match data_url.split_once(',') {
        Some((head, body)) if head.starts_with("data:") => {
            let mime = head
                .trim_start_matches("data:")
                .split(';')
                .next()
                .unwrap_or("image/jpeg")
                .to_string();
            (mime, body.to_string())
        }
        _ => ("image/jpeg".to_string(), data_url),
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.as_bytes())
        .map_err(|e| format!("gambar tidak valid: {e}"))?;

    insert_reference(&state, &deck_id, name, mime, bytes)?;
    Ok(state.db.list_asset_summaries(&deck_id))
}

/// Pulls an image straight from a link, so a Pinterest pin or Dribbble shot can
/// be used as a reference without saving it to disk first.
#[tauri::command]
pub async fn add_reference_url(
    state: State<'_, AppState>,
    deck_id: String,
    url: String,
) -> Result<Vec<Asset>, String> {
    let (mime, bytes) = crate::research::fetch_image(url.trim()).await?;
    let name = url
        .trim()
        .rsplit('/')
        .find(|part| !part.is_empty() && !part.contains('?'))
        .unwrap_or("referensi")
        .chars()
        .take(48)
        .collect::<String>();
    insert_reference(&state, &deck_id, name, mime.to_string(), bytes)?;
    Ok(state.db.list_asset_summaries(&deck_id))
}

#[tauri::command]
pub fn delete_reference(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .db
        .delete_asset(&id)
        .map_err(|e| format!("gagal menghapus referensi: {e}"))
}

/// Raw base64 for one reference, so the UI can show a thumbnail without
/// shipping every payload on boot.
#[tauri::command]
pub fn reference_data(state: State<'_, AppState>, deck_id: String) -> Vec<Asset> {
    state.db.list_assets(&deck_id)
}
