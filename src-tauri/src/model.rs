//! Serde models mirroring `src/lib/types.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub caption: String,
    #[serde(default = "default_aspect")]
    pub aspect: String,
    #[serde(default)]
    pub slides: Vec<Slide>,
    #[serde(default)]
    pub style_guide: String,
    #[serde(default)]
    pub palette: Vec<String>,
    #[serde(default)]
    pub brand_handle: String,
    #[serde(default = "default_save_label")]
    pub save_label: String,
    #[serde(default)]
    pub from_template_id: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_aspect() -> String {
    "4:5".into()
}
fn default_save_label() -> String {
    "Save this post".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckSummary {
    pub id: String,
    pub title: String,
    pub slide_count: usize,
    pub aspect: String,
    pub updated_at: String,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub deck: Deck,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub deck_id: String,
    pub slide_id: String,
    pub x: f64,
    pub y: f64,
    pub body: String,
    #[serde(default = "default_author")]
    pub author: String,
    #[serde(default = "default_status")]
    pub status: String,
    /// CSS-ish path of the element this note was pinned to (may be empty).
    #[serde(default)]
    pub selector: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideRevision {
    pub id: String,
    pub deck_id: String,
    pub slide_id: String,
    pub title: String,
    pub html: String,
    pub created_at: String,
}

fn default_author() -> String {
    "user".into()
}
fn default_status() -> String {
    "open".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub id: String,
    pub name: String,
    pub args: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub deck_id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCallRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub reasoning_content: String,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetProvenance {
    #[serde(default)] pub source_url: String,
    #[serde(default)] pub creator: String,
    #[serde(default)] pub rights_note: String,
    #[serde(default)] pub alt_text: String,
}
impl AssetProvenance {
 pub fn validate(&self)->Result<(),String>{
  for value in [&self.source_url,&self.creator,&self.rights_note,&self.alt_text]{if value.len()>4000||value.contains('\0'){return Err("Asset note exceeds4000bytes or contains invalid text".into())}}
  if !self.source_url.is_empty() && !(self.source_url.starts_with("https://")||self.source_url.starts_with("http://")){return Err("Source URL must use HTTP or HTTPS".into())}Ok(())
 }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub provenance: Option<AssetProvenance>,
    #[serde(default)]
    pub reference_role: String,
    #[serde(default)]
    pub reference_status: String,
    pub id: String,
    #[serde(default)]
    pub deck_id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mime: String,
    /// Base64 payload without the data-URL prefix.
    #[serde(default)]
    pub data: String,
    #[serde(default)]
    pub profile: Option<crate::palette::ImageProfile>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub provider_kind: String,
    #[serde(default)]
    pub active_connection: String,
    #[serde(default)]
    pub connections: Vec<ProviderConnection>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub model_capabilities: Vec<crate::capabilities::ModelCapability>,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
    #[serde(default)]
    pub export_dir: Option<String>,
    #[serde(default)]
    pub brand_handle: String,
    #[serde(default = "default_save_label")]
    pub save_label: String,
    #[serde(default = "default_true")]
    pub enable_research: bool,
    #[serde(default = "default_true")]
    pub enable_file_tools: bool,
    /// Attach the raw reference images to the prompt (vision models only).
    #[serde(default)]
    pub send_references: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnection {
    pub id: String, pub name: String, pub kind: String,
    pub base_url: String, pub api_key: String, pub model: String,
    #[serde(default)] pub reasoning_effort: Option<String>,
    #[serde(default)] pub model_capabilities: Vec<crate::capabilities::ModelCapability>,
}

fn default_base_url() -> String {
    "https://api.openai.com/v1".into()
}
fn default_model() -> String {
    "gpt-4o-mini".into()
}
fn default_temperature() -> f64 {
    0.85
}
fn default_max_turns() -> u32 {
    24
}
fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            provider_kind: String::new(),
            active_connection: String::new(),
            connections: Vec::new(),
            reasoning_effort: None,
            model_capabilities: Vec::new(),
            base_url: default_base_url(),
            model: default_model(),
            api_key: String::new(),
            temperature: default_temperature(),
            max_turns: default_max_turns(),
            export_dir: None,
            brand_handle: String::new(),
            save_label: default_save_label(),
            enable_research: true,
            enable_file_tools: true,
            send_references: false,
        }
    }
}

/// Events streamed to the frontend over a Tauri channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStart { turn: u32 },
    TextDelta { text: String },
    ReasoningDelta { text: String },
    RenderRequest {request_id:String,index:usize,#[serde(skip_serializing_if="Option::is_none")] revision:Option<String>,#[serde(skip_serializing_if="Option::is_none")] candidate:Option<serde_json::Value>},
    ToolCall { id: String, name: String, args: String },
    ToolResult { id: String, name: String, result: String, ok: bool },
    DeckUpdated { deck: Deck },
    Done { reason: String },
    Error { message: String },
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct BrandProfile{pub id:String,pub name:String,pub style_guide:String,pub palette:Vec<String>,pub brand_handle:String,pub save_label:String,pub updated_at:String}
impl BrandProfile{pub fn validate(&self)->Result<(),String>{
 if self.id.is_empty()||self.id.len()>100||self.name.trim().is_empty()||self.name.len()>160{return Err("Brand needs a name and valid ID".into())}
 for s in [&self.style_guide,&self.brand_handle,&self.save_label]{if s.len()>8000||s.contains('\0'){return Err("Brand text exceeds safe limits".into())}}
 if self.palette.len()>12||self.palette.iter().any(|c|!(c.len()==7&&c.starts_with('#')&&c[1..].chars().all(|v|v.is_ascii_hexdigit()))){return Err("Palette needs up to12 #RRGGBB colors".into())}Ok(())
}}
