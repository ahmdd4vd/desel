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
    pub streaming: bool,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
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
    ToolCall { id: String, name: String, args: String },
    ToolResult { id: String, name: String, result: String, ok: bool },
    DeckUpdated { deck: Deck },
    Done { reason: String },
    Error { message: String },
}
