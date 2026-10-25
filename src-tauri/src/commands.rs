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
    /// Geometry findings measured by the front-end's rendered preview, keyed by
    /// deck. The string linter cannot see these; the agent needs them to
    /// self-correct overlaps the user can see in the lint panel.
    pub geometry: std::sync::Mutex<std::collections::HashMap<String, Vec<String>>>,
    /// Per-deck cancel flags for the running agent, set by `cancel_agent`.
    pub cancel: std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>,
    >,
}

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings,String> {
    state.db.get_settings_checked()
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
pub async fn discover_models(app:tauri::AppHandle, mut settings: AppSettings) -> Result<Vec<crate::capabilities::ModelCapability>,String> {
    crate::provider_runtime::resolve(&app,&mut settings).await?;
    agent::discover_capabilities(&settings).await
}

#[tauri::command]
pub async fn test_connection(app:tauri::AppHandle,state: State<'_, AppState>, settings: Option<AppSettings>) -> Result<Value, String> {
    let mut settings = settings.unwrap_or_else(||state.db.get_settings());
    crate::provider_runtime::resolve(&app,&mut settings).await?;
    agent::test_connection(&settings).await
}

/* -------------------------------------------------------------------------- */
/* decks                                                                      */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn list_decks(state: State<'_, AppState>) -> Result<Vec<DeckSummary>,String> {
    state.db.list_decks_checked()
}

#[tauri::command]
pub fn get_deck(state: State<'_, AppState>, id: String) -> Result<Option<Deck>,String> {
    state.db.get_deck_checked(&id)
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
                fresh_template_slide_ids(&mut d);
                d.from_template_id = Some(tid.clone());
                d.created_at = now.clone();
                d.updated_at = now.clone();
                d
            })
            .ok_or_else(||"Template tidak ditemukan; proyek tidak dibuat".to_string())?
    } else {
        blank_deck(&now)
    };

    if !args.title.trim().is_empty() {
        deck.title = args.title.trim().to_string();
    }
    if ["4:5", "1:1", "9:16", "16:9"].contains(&args.aspect.as_str()) {
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
    expected:Option<Deck>,
) -> Result<Deck, String> {
    state
        .db
        .save_deck_checked(&deck, thumbnail.as_deref(),expected.as_ref())
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
    crate::project_file::duplicate(&state.db,&id)
}

/* -------------------------------------------------------------------------- */
/* chat                                                                       */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, deck_id: String) -> Vec<ChatMessage> {
    state.db.list_messages(&deck_id)
}

#[tauri::command]
pub fn get_chat_branches(state: State<'_, AppState>, deck_id: String) -> Option<serde_json::Value> {
    state.db.chat_branches(&deck_id)
}

#[tauri::command]
pub fn save_chat_branches(state: State<'_, AppState>, deck_id: String, branches: serde_json::Value) -> Result<(), String> {
    state.db.save_chat_branches(&deck_id, &branches)
}

#[tauri::command]
pub fn get_creator_workspace(state: State<'_, AppState>, deck_id: String) -> Option<serde_json::Value> {
    state.db.creator_workspace(&deck_id)
}

#[tauri::command]
pub fn save_creator_workspace(state: State<'_, AppState>, deck_id: String, workspace: serde_json::Value) -> Result<(), String> {
    state.db.save_creator_workspace(&deck_id, &workspace)
}

#[tauri::command]
pub fn creator_resume_plan(state: State<'_, AppState>, run_id: String) -> Result<serde_json::Value, String> {
    state.db.creator_resume_plan(&run_id)
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
        tool_call_id: None, reasoning_content: String::new(),
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
    app:tauri::AppHandle,
    state: State<'_, AppState>,
    deck_id: String,
    text: String,
    channel: Channel<AgentEvent>,
    context:Option<crate::creator::CreatorRequest>,
) -> Result<(), String> {
    // Reserve before any await, so two invocations cannot race the canvas writer.
    let cancel=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {let mut map=state.cancel.lock().map_err(|_|"Run lock unavailable")?;if map.contains_key(&deck_id){return Err("Agent masih berjalan pada proyek ini; tidak memulai writer kedua.".into())}map.insert(deck_id.clone(),cancel.clone());}
    struct Lease<'a>{map:&'a std::sync::Mutex<std::collections::HashMap<String,std::sync::Arc<std::sync::atomic::AtomicBool>>>,id:String}
    impl Drop for Lease<'_>{fn drop(&mut self){if let Ok(mut m)=self.map.lock(){m.remove(&self.id);}}}
    let _lease=Lease{map:&state.cancel,id:deck_id.clone()};
    if let Some(c)=&context{let deck=state.db.get_deck(&deck_id).ok_or("Project missing")?;c.validate(&deck)?;}
    let mut settings = state.db.get_settings();
    crate::provider_runtime::resolve(&app,&mut settings).await?;

    if settings.model.trim().is_empty(){return Err("Pilih model provider di Pengaturan sebelum mengirim pesan.".into())}
    if settings.api_key.trim().is_empty()
        && !matches!(agent::provider_label(&settings.base_url).as_str(), "Local")
    {
        return Err(
            "API key belum diisi. Buka Settings (Ctrl+,) dan tambahkan key provider.".into(),
        );
    }

    if settings.send_references {
        if let Some(cap)=settings.model_capabilities.iter().find(|c|c.id==settings.model && c.source==settings.base_url){
            if !cap.input_modalities.is_empty() && !cap.input_modalities.iter().any(|v|v=="image") {return Err("Metadata model ini tidak mendukung input gambar. Matikan pengiriman gambar atau pilih model vision.".into())}
        }
    }
    // Persist the user turn first so a reload keeps the transcript intact.
    let user_msg = ChatMessage {
        id: new_id("msg"),
        deck_id: deck_id.clone(),
        role: "user".into(),
        content: text,
        tool_calls: Vec::new(),
        tool_call_id: None, reasoning_content: String::new(),
        streaming: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let run_id=context.as_ref().and_then(|c|c.run_id.clone()).unwrap_or_else(||new_id("run"));
    state.db.begin_creator_run(&run_id,&deck_id,&json!({"text":user_msg.content,"context":context}),&user_msg)?;
    let mut context=context.unwrap_or(crate::creator::CreatorRequest{mode:"produce".into(),..Default::default()});context.run_id=Some(run_id.clone());

    state.db.track_user_turn(&deck_id,&user_msg.id)?;
    let history = state.db.active_history(&deck_id);
    let geometry = state
        .geometry
        .lock()
        .map(|g| g.get(&deck_id).cloned().unwrap_or_default())
        .unwrap_or_default();
    let db = &state.db;
    agent::run_agent_scoped(db, &settings, &deck_id, history, geometry, cancel, channel,Some(context)).await;
    state.db.checkpoint_creator_run(&run_id,"settled","Invocation returned. Inspect saved results and review findings before continuing.")?;
    Ok(())
}

/// Stop the agent currently working on a deck. Cooperative: the loop checks
/// the flag between turns and while streaming, then exits cleanly.
#[tauri::command]
pub fn cancel_agent(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    let map = state.cancel.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(&deck_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

/// Front-end reports the current geometry findings for a deck (replaces, never
/// appends; an empty list clears them once the user fixed the slide).
#[tauri::command]
pub fn report_geometry_lints(
    state: State<'_, AppState>,
    deck_id: String,
    issues: Vec<String>,
) -> Result<(), String> {
    let mut store = state.geometry.lock().map_err(|e| e.to_string())?;
    if issues.is_empty() {
        store.remove(&deck_id);
    } else {
        store.insert(deck_id, issues);
    }
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
        deck: crate::project_file::template_snapshot(&state.db,&args.deck)?,
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
    let outcome=crate::export_files::write_batch(&directory,files)?;

    if let Some(remember) = remember_dir.filter(|d| !d.trim().is_empty()) {
        let mut settings = state.db.get_settings();
        settings.export_dir = Some(remember);
        let _ = state.db.save_settings(&settings);
    }

    Ok(outcome)
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
    let deck = state
        .db
        .get_deck(&revision.deck_id)
        .ok_or_else(|| "deck-nya sudah dihapus".to_string())?;

    let index=deck.slides.iter().position(|s|s.id==revision.slide_id).ok_or("slide itu sudah tidak ada di deck")?;
    let mut candidate=deck.slides[index].clone();candidate.html=revision.html;candidate.title=revision.title;
    state.db.commit_slide_candidate(&deck,index,&candidate)

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
        .add_asset(&Asset {provenance:None,reference_role:String::new(),reference_status:String::new(),
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

#[tauri::command]
pub fn set_reference_intent(state:State<'_,AppState>,deck_id:String,id:String,role:String,status:String)->Result<(),String>{state.db.set_reference_intent(&deck_id,&id,&role,&status)}

/// Revision-bound render receipt. Kept transiently in the existing private asset
/// mailbox, then consumed/deleted by the active run. Not a user reference.
#[tauri::command]
pub fn submit_render_review(state:State<'_,AppState>,deck_id:String,request_id:String,receipt:Value)->Result<(),String>{
 let asset=Asset{id:new_id("review"),deck_id:Some(deck_id),name:format!("__render_receipt_{request_id}"),mime:"application/json".into(),data:receipt.to_string(),provenance:None,reference_role:String::new(),reference_status:String::new(),profile:None,created_at:chrono::Utc::now().to_rfc3339()};
 state.db.add_asset(&asset).map_err(|e|e.to_string())
}

#[tauri::command]
pub fn deck_history_counts(state:State<'_,AppState>,id:String)->[i64;2]{state.db.deck_history_counts(&id)}
#[tauri::command]
pub fn step_deck_history(state:State<'_,AppState>,expected:Deck,direction:String)->Result<Deck,String>{state.db.step_deck_history(&expected,&direction)}

fn fresh_template_slide_ids(deck:&mut Deck){for slide in &mut deck.slides{slide.id=new_id("slide");}}
#[cfg(test)]mod template_isolation_tests{use super::*;#[test]fn fresh_template_copies_do_not_share_revision_or_pin_ids(){let source:Deck=serde_json::from_value(json!({"id":"template","slides":[{"id":"a","html":"art"},{"id":"b","html":"second"}]})).unwrap();let mut a=source.clone();let mut b=source.clone();fresh_template_slide_ids(&mut a);fresh_template_slide_ids(&mut b);assert!(a.slides.iter().all(|x|b.slides.iter().all(|y|x.id!=y.id)));assert!(a.slides.iter().all(|x|source.slides.iter().all(|y|x.id!=y.id)));assert_eq!(a.slides[0].html,"art");}}

#[tauri::command]
pub fn set_asset_provenance(state:State<'_,AppState>,deck_id:String,id:String,value:AssetProvenance)->Result<(),String>{state.db.set_asset_provenance(&deck_id,&id,&value)}
#[tauri::command]
pub fn list_asset_library(state:State<'_,AppState>)->Vec<Asset>{state.db.library_assets()}
#[tauri::command]
pub fn copy_library_asset(state:State<'_,AppState>,deck_id:String,source_deck:String,id:String)->Result<Asset,String>{state.db.copy_library_asset(&deck_id,&source_deck,&id)}

#[tauri::command]
pub fn asset_by_id(state:State<'_,AppState>,deck_id:String,id:String)->Result<Asset,String>{state.db.asset_by_id(&deck_id,&id)}

#[tauri::command]pub fn list_brands(state:State<'_,AppState>)->Vec<BrandProfile>{state.db.list_brands()}
#[tauri::command]pub fn save_brand(state:State<'_,AppState>,brand:BrandProfile)->Result<(),String>{state.db.save_brand(&brand)}
#[tauri::command]pub fn delete_brand(state:State<'_,AppState>,id:String)->Result<(),String>{state.db.delete_brand(&id)}

#[tauri::command]
pub fn creator_runs(state:State<'_,AppState>,deck_id:String)->Result<Vec<Value>,String>{state.db.creator_runs(&deck_id)}
