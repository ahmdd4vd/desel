//! Tool definitions and execution for the agent.
//!
//! The agent edits the deck by calling these. Every mutation is persisted
//! immediately and streamed back to the UI, so the canvas updates while the
//! model is still talking.

use serde_json::{json, Value};

use crate::db::Db;
use crate::model::*;

pub struct ToolContext<'a> {
    pub db: &'a Db,
    pub deck_id: String,
    pub settings: AppSettings,
}

pub struct ToolOutcome {
    /// Text handed back to the model as the tool result.
    pub content: String,
    /// Set when the deck changed and the UI must refresh.
    pub deck: Option<Deck>,
    /// When set, the agent loop stops and this becomes the assistant reply.
    pub pause_question: Option<String>,
}

/// JSON schema advertised to the model.
pub fn tool_specs(settings: &AppSettings) -> Value {
    let mut tools = vec![
        json!({
            "type": "function",
            "function": {
                "name": "read_deck",
                "description": "Read the current deck: title, aspect, style guide and every slide (index, title, html length). Pass `index` to get the full HTML of one slide — do that before revising it, so you change the real design instead of guessing.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "description": "Optional: return the complete HTML of this slide." }
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "set_deck_meta",
                "description": "Update deck-level fields: title, caption, aspect, styleGuide (the design system you committed to), palette, brandHandle, saveLabel. Only pass the fields you want to change.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "caption": { "type": "string", "description": "Ready-to-post caption with hook + hashtags." },
                        "aspect": { "type": "string", "enum": ["4:5", "1:1", "9:16", "16:9"] },
                        "styleGuide": { "type": "string", "description": "Short written spec of the visual system so every slide stays consistent: type stack, palette, texture, layout rules." },
                        "palette": { "type": "array", "items": { "type": "string" }, "description": "Hex colours used." },
                        "brandHandle": { "type": "string" },
                        "saveLabel": { "type": "string" }
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "write_slide",
                "description": "Create or replace ONE slide. `html` must be a complete standalone HTML document (doctype + <style> + body) sized exactly to the deck aspect. This is where you write the actual design: real CSS, inline SVG art, gradients, masks, blend modes. Emit one tool call per slide.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "description": "0-based position. Use -1 or omit to append at the end." },
                        "title": { "type": "string", "description": "Short label for the rail, e.g. 'Cover — GitHub hides pure gold'." },
                        "html": { "type": "string", "description": "Complete HTML document string." },
                        "rationale": { "type": "string", "description": "One line on the design decision for this slide." }
                    },
                    "required": ["html"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "patch_slide",
                "description": "Apply ONE targeted edit to an existing slide instead of rewriting it. Prefer this for revision requests: every patch lands on the user's canvas immediately, so a revision shows up as a sequence of visible edits. Use write_slide only when the slide's direction changes completely. Read the slide first if unsure of its structure.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "description": "0-based slide position." },
                        "op": { "type": "string", "enum": ["set_text", "replace_html", "append_html", "remove"], "description": "set_text: replace an element's text. replace_html: replace an element with an HTML fragment. append_html: append a fragment (to the element matching selector, or body). remove: delete an element." },
                        "selector": { "type": "string", "description": "CSS selector of the target element (ids/classes you assigned when writing the slide). Not needed for append_html to body." },
                        "html": { "type": "string", "description": "HTML fragment for replace_html / append_html." },
                        "text": { "type": "string", "description": "New text content for set_text." }
                    },
                    "required": ["index", "op"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "delete_slide",
                "description": "Delete a slide by 0-based index.",
                "parameters": {
                    "type": "object",
                    "properties": { "index": { "type": "integer" } },
                    "required": ["index"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "save_template",
                "description": "Save the current deck as a reusable template the user can start future decks from.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "description": { "type": "string", "description": "What this visual system is good for." }
                    },
                    "required": ["name"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_templates",
                "description": "List saved templates (id, name, description, slide count).",
                "parameters": { "type": "object", "properties": {}, "required": [] }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "load_template",
                "description": "Copy a saved template's slides and style guide into the current deck as a starting point, then adapt it.",
                "parameters": {
                    "type": "object",
                    "properties": { "templateId": { "type": "string" } },
                    "required": ["templateId"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "ask_user",
                "description": "Pause the workflow and ask a concise clarifying question when an important decision is unresolved. Wait for the answer before slide mutations. Do not ask again for known details or force a fixed slide count, brand, research step or permission ritual.",
                "parameters": {
                    "type": "object",
                    "properties": { "question": { "type": "string" } },
                    "required": ["question"]
                }
            }
        }),
    ];

    if settings.send_references {
        tools.push(json!({"type":"function","function":{"name":"review_render","description":"Request an actual rendered PNG of ONE current slide for visual critique (not HTML/lint). Available only with vision enabled. Inspect layout, image crop, contrast, hierarchy, reference match, overflow. Fix issues and request another render. Do not claim you saw pixels unless image returned. Desktop must be open.","parameters":{"type":"object","properties":{"index":{"type":"integer"}},"required":["index"]}}}));
    }
    if settings.enable_research {
        tools.push(json!({"type":"function","function":{"name":"search_commons","description":"Cari DAN impor satu foto nyata dari Wikimedia Commons untuk satu slide. Beri kata kunci pendek (Inggris atau nama tempat/objek) dan pesan slide. Alat ini mencari, memilih hasil berformat foto dengan fotografer bernama, mencoba ulang saat 429/503, mengimpor thumbnail 1280px, dan mengembalikan ID aset serta KREDIT TERVERIFIKASI. Pakai ini, jangan menebak URL Commons.","parameters":{"type":"object","properties":{"query":{"type":"string"},"role":{"type":"string"},"slideMessage":{"type":"string"}},"required":["query","role","slideMessage"]}}}));
        tools.push(json!({"type":"function","function":{"name":"import_image","description":"Download an observed public image URL into this deck's asset library. Supply the actual source page, intended role and rights note. Returns an asset ID. Use use_asset in slide HTML rather than repeating base64. Crop/layout via CSS object-fit/object-position. Not video, not image generation, and not a license grant.","parameters":{"type":"object","properties":{"url":{"type":"string"},"sourceUrl":{"type":"string"},"role":{"type":"string"},"rightsNote":{"type":"string"}},"required":["url","sourceUrl","role","rightsNote"]}}}));
        tools.push(json!({"type":"function","function":{"name":"github_trending","description":"Read GitHub Trending primary daily/weekly/monthly list with timestamp and actual repo links, not search rank. Verify each selected repo/docs before claims. Public page can block or change.","parameters":{"type":"object","properties":{"since":{"type":"string","enum":["daily","weekly","monthly"]}},"required":[]}}}));
    }
    if settings.enable_research {
        tools.push(json!({
            "type": "function",
            "function": {
                "name": "search_web",
                "description": "Search the web for current facts, real repo names, product names, dates. Returns titles, URLs and snippets.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "integer", "description": "1-8, default 6" }
                    },
                    "required": ["query"]
                }
            }
        }));
        tools.push(json!({
            "type": "function",
            "function": {
                "name": "fetch_url",
                "description": "Fetch a URL and return its readable text (HTML is stripped). Use for README files, docs, changelogs.",
                "parameters": {
                    "type": "object",
                    "properties": { "url": { "type": "string" } },
                    "required": ["url"]
                }
            }
        }));
    }

    Value::Array(tools)
}

fn arg_str(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn arg_i64(args: &Value, key: &str, default: i64) -> i64 {
    args.get(key).and_then(|v| v.as_i64()).unwrap_or(default)
}

pub async fn execute(ctx: &ToolContext<'_>, name: &str, args: &Value) -> ToolOutcome {
    match name {
        "read_deck" => read_deck(ctx, args),
        "set_deck_meta" => set_deck_meta(ctx, args),
        "write_slide" => write_slide(ctx, args).await,
        "patch_slide" => patch_slide(ctx, args).await,
        "delete_slide" => delete_slide(ctx, args),
        "save_template" => save_template(ctx, args),
        "list_templates" => list_templates(ctx),
        "load_template" => load_template(ctx, args),
        "ask_user" => {
            let question = arg_str(args, "question");
            // An empty question would stop the run with nothing to show the user.
            if question.trim().is_empty() {
                ToolOutcome {
                    content: "error: pertanyaan kosong — kirim satu pertanyaan yang benar-benar perlu dijawab user".into(),
                    deck: None,
                    pause_question: None,
                }
            } else {
                ToolOutcome {
                    content: format!("asked: {question}"),
                    deck: None,
                    pause_question: Some(question),
                }
            }
        }
        "search_web" => search_web(ctx, args).await,
        "fetch_url" => fetch_url(ctx, args).await,
        "github_trending" => {let since=arg_str(args,"since");let since=if ["daily","weekly","monthly"].contains(&since.as_str()){since.as_str()}else{"daily"};if !ctx.settings.enable_research {ToolOutcome{content:"error: research disabled".into(),deck:None,pause_question:None}}else{ToolOutcome{content:crate::research::github_trending(since).await.unwrap_or_else(|e|format!("error: {e}")),deck:None,pause_question:None}}},
        "import_image" => import_image(ctx,args).await,
        "search_commons" => search_commons(ctx,args).await,
        other => ToolOutcome {
            content: format!("Unknown tool: {other}"),
            deck: None,
            pause_question: None,
        },
    }
}

fn load_or_default(ctx: &ToolContext<'_>) -> Deck {
    ctx.db.get_deck(&ctx.deck_id).unwrap_or_else(|| Deck {
        id: ctx.deck_id.clone(),
        title: String::new(),
        caption: String::new(),
        aspect: "4:5".into(),
        slides: Vec::new(),
        style_guide: String::new(),
        palette: Vec::new(),
        brand_handle: String::new(),
        save_label: "Save this post".into(),
        from_template_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn persist(ctx: &ToolContext<'_>, deck: &mut Deck) -> Option<Deck> {
    deck.updated_at = chrono::Utc::now().to_rfc3339();
    ctx.db.save_deck(deck, None).ok()?;
    Some(deck.clone())
}

pub fn compact_asset_html(ctx:&ToolContext<'_>,html:&str)->String{let mut out=html.to_string();for a in ctx.db.list_assets(&ctx.deck_id){if !a.data.is_empty(){out=out.replace(&format!("data:{};base64,{}",a.mime,a.data),&format!("asset:{}",a.id));}}out}

fn read_deck(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let deck = load_or_default(ctx);

    // Revising a slide means reading it first; a summary alone would make the
    // model rewrite the design from scratch and lose what made it work.
    if let Some(index) = args.get("index").and_then(|v| v.as_i64()) {
        let Some(slide) = deck.slides.get(index.max(0) as usize) else {
            return ToolOutcome {
                content: format!(
                    "error: tidak ada slide di index {index} (deck punya {} slide)",
                    deck.slides.len()
                ),
                deck: None,
                pause_question: None,
            };
        };
        return ToolOutcome {
            content: serde_json::to_string_pretty(&json!({
                "index": index,
                "title": slide.title,
                "rationale": slide.rationale,
                "html": compact_asset_html(ctx,&slide.html),
                "styleGuide": deck.style_guide,
                "palette": deck.palette,
                "aspect": deck.aspect
            }))
            .unwrap_or_default(),
            deck: None,
            pause_question: None,
        };
    }

    let slides: Vec<Value> = deck
        .slides
        .iter()
        .enumerate()
        .map(|(i, s)| {
            json!({
                "index": i,
                "title": s.title,
                "htmlChars": s.html.len(),
                "rationale": s.rationale
            })
        })
        .collect();

    ToolOutcome {
        content: serde_json::to_string_pretty(&json!({
            "id": deck.id,
            "title": deck.title,
            "aspect": deck.aspect,
            "caption": deck.caption,
            "styleGuide": deck.style_guide,
            "palette": deck.palette,
            "brandHandle": deck.brand_handle,
            "saveLabel": deck.save_label,
            "slides": slides
        }))
        .unwrap_or_default(),
        deck: None,
        pause_question: None,
    }
}

fn set_deck_meta(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let mut deck = load_or_default(ctx);

    if let Some(v) = args.get("title").and_then(|v| v.as_str()) {
        deck.title = v.to_string();
    }
    if let Some(v) = args.get("caption").and_then(|v| v.as_str()) {
        deck.caption = v.to_string();
    }
    if let Some(v) = args.get("aspect").and_then(|v| v.as_str()) {
        if ["4:5", "1:1", "9:16", "16:9"].contains(&v) {
            deck.aspect = v.to_string();
        }
    }
    if let Some(v) = args.get("styleGuide").and_then(|v| v.as_str()) {
        deck.style_guide = v.to_string();
    }
    if let Some(arr) = args.get("palette").and_then(|v| v.as_array()) {
        deck.palette = arr
            .iter()
            .filter_map(|x| x.as_str())
            .map(|s| s.to_string())
            .collect();
    }
    if let Some(v) = args.get("brandHandle").and_then(|v| v.as_str()) {
        deck.brand_handle = v.to_string();
    }
    if let Some(v) = args.get("saveLabel").and_then(|v| v.as_str()) {
        deck.save_label = v.to_string();
    }

    let updated = persist(ctx, &mut deck);
    ToolOutcome {
        content: "deck meta updated".into(),
        deck: updated,
        pause_question: None,
    }
}

/// Remote image URLs referenced by a slide's markup (`<img src>` and CSS
/// `url(...)`), de-duplicated, capped so a runaway slide cannot stall the agent.
fn collect_remote_image_urls(html: &str) -> Vec<String> {
    let mut urls: Vec<String> = Vec::new();
    let mut push = |u: &str| {
        let u = u.trim().trim_matches(|c| c == '"' || c == '\'' || c == ')');
        if u.starts_with("http://") || u.starts_with("https://") {
            if !urls.iter().any(|x| x == u) {
                urls.push(u.to_string());
            }
        }
    };
    let mut rest = html;
    while let Some(pos) = rest.find("src=") {
        let after = &rest[pos + 4..];
        let after = after.trim_start();
        if let Some(stripped) = after.strip_prefix(|c| c == '"' || c == '\'') {
            let q = after.chars().next().unwrap();
            if let Some(end) = stripped.find(q) {
                push(&stripped[..end]);
            }
        }
        rest = &rest[pos + 4..];
    }
    let mut rest = html;
    while let Some(pos) = rest.find("url(") {
        let after = &rest[pos + 4..];
        if let Some(end) = after.find(')') {
            push(&after[..end]);
        }
        rest = &rest[pos + 4..];
    }
    urls.truncate(4);
    urls
}

/// Trust the bytes, not the URL or the Content-Type header.
fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some("image/png")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        Some("image/avif")
    } else {
        None
    }
}

/// Download every remote image a slide references and swap it for an embedded
/// data URI. Anything that fails (offline, wrong type, too big) is left as-is
/// and reported, so the model can swap in CSS/SVG art instead.
/// Addresses the downloader must never reach: loopback, RFC1918, link-local
/// (covers the 169.254.169.254 cloud metadata endpoint), CGNAT, multicast,
/// and the IPv6 equivalents.
fn blocked_ip(ip: &std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || (o[0] == 100 && (o[1] & 0xC0) == 64) // CGNAT 100.64.0.0/10
                || o[0] >= 240
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 unique-local
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

/// Static checks on a model-supplied image URL, before any DNS or traffic.
fn validate_image_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| e.to_string())?;
    match url.scheme() {
        "http" | "https" => {}
        s => return Err(format!("skema {s}: tidak didukung")),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL dengan kredensial ditolak".into());
    }
    match url.host_str() {
        None => Err("URL tanpa host".into()),
        Some(host) => {
            // IPv6 literals keep their brackets in host_str ("[::1]").
            let bare = host.trim_start_matches('[').trim_end_matches(']');
            if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
                if blocked_ip(&ip) {
                    return Err(format!("alamat {ip} bukan alamat publik"));
                }
            }
            Ok(url)
        }
    }
}

/// Resolve the host and pin the client to a verified-public address, so a DNS
/// answer cannot be swapped between our check and the actual connect.
async fn pinned_client(url: &reqwest::Url) -> Result<reqwest::Client, String> {
    let host = url.host_str().ok_or("URL tanpa host")?;
    let port = url.port_or_known_default().unwrap_or(443);
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    let addr = if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
        std::net::SocketAddr::new(ip, port)
    } else {
        let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| e.to_string())?
            .collect();
        if addrs.is_empty() {
            return Err(format!("{host} tidak resolve"));
        }
        for a in &addrs {
            if blocked_ip(&a.ip()) {
                return Err(format!("{host} resolve ke alamat non-publik {}", a.ip()));
            }
        }
        addrs[0]
    };
    reqwest::Client::builder()
        .user_agent("desel/0.1")
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .resolve(host, addr)
        .build()
        .map_err(|e| e.to_string())
}

/// Fetch an image with SSRF protection: scheme/credential checks, pinned
/// public IP, manually re-validated redirects, and a hard cap on the streamed
/// body (no automatic decompression, so a gzip bomb lands as non-image bytes
/// and is rejected by the magic sniff instead of exploding in memory).
fn unsupported_image_message(bytes:&[u8])->String{
 let head=String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).to_ascii_lowercase();
 if head.contains("<svg") {"SVG belum didukung importer raster. Jangan ulangi URL ini atau menebak ekstensi PNG. Gunakan screenshot PNG/JPEG/WebP yang benar-benar ditemukan dari halaman sumber; aset yang sudah berhasil diimpor tetap bisa digunakan. Bila tidak ada, sebut gap aset, jangan buat logo/screenshot palsu.".into()}
 else if head.contains("<html")||head.contains("<!doctype html") {"URL mengembalikan halaman HTML, bukan gambar. Ambil URL gambar dari OBSERVED IMAGES sumber; jangan menebak path atau ekstensi. Gunakan aset berhasil diimpor bila cukup.".into()}
 else {"Format gambar tidak didukung. Importer menerima PNG/JPEG/GIF/WebP terverifikasi dari byte. Jangan ulangi sumber yang sama; gunakan aset berhasil diimpor atau jelaskan gap.".into()}
}

async fn fetch_image_data_uri(raw_url: &str, max_bytes: usize) -> Result<String, String> {
    let mut url = validate_image_url(raw_url)?;
    for _hop in 0..4 {
        let client = pinned_client(&url).await?;
        let resp = client.get(url.clone()).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        if status.is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| format!("redirect {status} tanpa Location"))?;
            url = validate_image_url(
                url.join(location).map_err(|e| e.to_string())?.as_str(),
            )?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("status {status}"));
        }
        if let Some(len) = resp.content_length() {
            if len as usize > max_bytes {
                return Err(format!("terlalu besar ({} KB)", len / 1024));
            }
        }
        let mut resp = resp;
        let mut bytes = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > max_bytes {
                return Err(format!("terlalu besar (>{} KB)", max_bytes / 1024));
            }
            bytes.extend_from_slice(&chunk);
        }
        let mime = sniff_image_mime(&bytes).ok_or_else(|| unsupported_image_message(&bytes))?;
        use base64::Engine;
        return Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        ));
    }
    Err("terlalu banyak redirect".into())
}

async fn localize_remote_images(html: &str) -> (String, Vec<String>) {
    const MAX_BYTES: usize = 5 * 1024 * 1024;
    let urls = collect_remote_image_urls(html);
    if urls.is_empty() {
        return (html.to_string(), Vec::new());
    }
    let mut out = html.to_string();
    let mut notes = Vec::new();
    for url in urls {
        let short: String = url.chars().take(80).collect();
        match fetch_image_data_uri(&url, MAX_BYTES).await {
            Ok(data_uri) => {
                out = out.replace(&url, &data_uri);
                notes.push(format!("- {short} -> aset lokal"));
            }
            Err(e) => notes.push(format!("- {short} GAGAL diunduh ({e}); dibiarkan sebagai URL remote")),
        }
    }
    (out, notes)
}

fn resolve_assets(ctx:&ToolContext<'_>,html:&str)->String{let assets=ctx.db.list_assets(&ctx.deck_id).into_iter().map(|a|(a.id.clone(),a)).collect::<std::collections::HashMap<_,_>>();regex::Regex::new(r"asset:([A-Za-z0-9_-]+)").unwrap().replace_all(html,|caps:&regex::Captures|assets.get(&caps[1]).map(|a|format!("data:{};base64,{}",a.mime,a.data)).unwrap_or_else(||caps[0].to_string())).into_owned()}

async fn write_slide(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    // Remote images cannot be rendered by the in-app preview/export reliably
    // (CORS, offline), so pull them into the slide as embedded assets the
    // moment they arrive. The model keeps designing with normal URLs and the
    // deck stays portable.
    let raw=crate::lint::fix_credit_size(&resolve_assets(ctx,&arg_str(args,"html")));
    let (html, notes) = localize_remote_images(&raw).await;
    let mut local_args = args.clone();
    local_args["html"] = json!(html);
    let mut outcome = write_slide_inner(ctx, &local_args);
    if !notes.is_empty() {
        outcome.content.push_str("\nAset gambar:\n");
        outcome.content.push_str(&notes.join("\n"));
    }
    outcome
}

fn write_slide_inner(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let mut deck = load_or_default(ctx);
    let html = arg_str(args, "html");

    if html.trim().is_empty() {
        return ToolOutcome {
            content: "error: html is empty".into(),
            deck: None,
            pause_question: None,
        };
    }

    let slide = Slide {
        id: crate::db::new_id("sl"),
        title: {
            let t = arg_str(args, "title");
            if t.trim().is_empty() {
                format!("Slide {}", deck.slides.len() + 1)
            } else {
                t
            }
        },
        html,
        rationale: arg_str(args, "rationale"),
        hidden: false,
    };

    let force=args.get("force").and_then(|v|v.as_bool()).unwrap_or(false);
    let idx = arg_i64(args, "index", -1);
    if !force&&idx>=0&&(idx as usize)<deck.slides.len(){
        let (w,h)=crate::lint::canvas(&deck.aspect);
        let errs=|html:&str|crate::lint::lint(html,w,h).into_iter().filter(|i|i.severity==crate::lint::Severity::Error).count();
        let (old,new)=(errs(&deck.slides[idx as usize].html),errs(&slide.html));
        if new>old{return ToolOutcome{content:format!("REWRITE DITOLAK: versi baru punya {new} error lint, versi lama {old}. Slide lama TETAP. Perbaiki versi baru supaya error <= {old} (pakai patch_slide untuk perubahan kecil), atau kirim force=true bila memang disengaja."),deck:None,pause_question:None}}
    }
    let title_arg = arg_str(args, "title");
    let label = slide.title.clone();
    // An index that already exists is a REWRITE, not an insertion: the agent is
    // told to fix slide 1 by writing slide 1 again, and that must not duplicate it.
    let inserted_at = if idx < 0 || idx as usize >= deck.slides.len() {
        deck.slides.push(slide);
        deck.slides.len() - 1
    } else {
        let slot = &mut deck.slides[idx as usize];
        slot.html = slide.html;
        slot.rationale = slide.rationale;
        if !title_arg.trim().is_empty() {
            slot.title = title_arg;
        }
        idx as usize
    };

    // A deck the user never named should be named by its first slide, not left
    // as "Untitled deck" in the project list.
    if inserted_at == 0 && (deck.title.trim().is_empty() || deck.title == "Untitled deck") {
        let first = deck.slides[0].title.trim();
        if !first.is_empty() {
            deck.title = first.chars().take(60).collect();
        }
    }

    let updated = persist(ctx, &mut deck);

    // Hand the design smells straight back so the model can fix them now.
    let (w, h) = crate::lint::canvas(&deck.aspect);
    let mut issues = crate::lint::lint(&deck.slides[inserted_at].html, w, h);
    issues.extend(crate::lint::deck_lint(&deck, inserted_at));
    {
        let h=&deck.slides[inserted_at].html;let low=h.to_lowercase();
        let has_photo=low.contains("<img")&&low.contains("src=\"data:image");
        let commons=ctx.db.list_assets(&ctx.deck_id).iter().any(|a|a.provenance.as_ref().map_or(false,|p|p.source_url.contains("commons.wikimedia.org")));
        if has_photo&&commons&&!low.contains("foto:"){issues.push(crate::lint::Issue{rule:"photo-no-credit".into(),severity:crate::lint::Severity::Error,message:"Slide ini memakai foto Commons tapi tanpa kredit. Tambahkan satu baris kecil (>=18px, satu baris, >=24px dari tepi) persis dari baris KREDIT TERVERIFIKASI foto itu, mis. \"Foto: Nama / Wikimedia (lisensi)\". Bila foto itu tidak punya nama fotografer terverifikasi, GANTI fotonya lewat search_commons (jangan hapus kredit dan pakai foto tanpa atribusi).".into()})}
    }
    let review = if issues.is_empty() {
        String::from("Pemeriksaan desain: bersih.")
    } else {
        format!(
            "Pemeriksaan desain ({} temuan):\n{}",
            issues.len(),
            crate::lint::summarise(&issues)
        )
    };

    ToolOutcome {
        content: format!(
            "slide written at index {inserted_at} (\"{label}\"). total slides: {}.\n{review}",
            deck.slides.len()
        ),
        deck: updated,
        pause_question: None,
    }
}

async fn patch_slide(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let mut deck = load_or_default(ctx);
    let idx = arg_i64(args, "index", -1);
    if idx < 0 || idx as usize >= deck.slides.len() {
        return ToolOutcome {
            content: format!("error: no slide at index {idx}"),
            deck: None,
            pause_question: None,
        };
    }
    let i = idx as usize;
    let op = arg_str(args, "op");
    let selector = arg_str(args, "selector");
    let text = arg_str(args, "text");
    let raw_fragment = resolve_assets(ctx,&arg_str(args, "html"));
    // Fragments get the same remote-image localization as full slide writes.
    let (fragment, notes) = if raw_fragment.trim().is_empty() {
        (raw_fragment, Vec::new())
    } else {
        localize_remote_images(&raw_fragment).await
    };
    let source = deck.slides[i].html.clone();
    match apply_patch(&source, &op, &selector, &fragment, &text) {
        Ok(patched) => {
            deck.slides[i].html = patched;
            let updated = persist(ctx, &mut deck);
            let (w, h) = crate::lint::canvas(&deck.aspect);
            let mut issues = crate::lint::lint(&deck.slides[i].html, w, h);
            issues.extend(crate::lint::deck_lint(&deck, i));
            let review = if issues.is_empty() {
                String::from("Pemeriksaan desain: bersih.")
            } else {
                format!(
                    "Pemeriksaan desain ({} temuan):\n{}",
                    issues.len(),
                    crate::lint::summarise(&issues)
                )
            };
            let mut content = format!("slide {i} patched (op: {op}).\n{review}");
            if !notes.is_empty() {
                content.push_str("\nAset gambar:\n");
                content.push_str(&notes.join("\n"));
            }
            ToolOutcome {
                content,
                deck: updated,
                pause_question: None,
            }
        }
        Err(e) => ToolOutcome {
            content: format!("error: {e}"),
            deck: None,
            pause_question: None,
        },
    }
}

/// Apply one targeted edit to a slide document. Pure: no db, no IO.
fn apply_patch(source: &str, op: &str, selector: &str, fragment: &str, text: &str) -> Result<String, String> {
    use ego_tree::{NodeId, NodeMut, NodeRef, Tree};
    use scraper::node::{Node, Text};
    use scraper::{ElementRef, Html, Selector};

fn frag_children_unwrapped<'a>(frag: &'a Html) -> Vec<NodeRef<'a, Node>> {
    let mut out: Vec<NodeRef<'a, Node>> = Vec::new();
    let mut stack: Vec<NodeRef<'a, Node>> = frag.tree.root().children().collect();
    while let Some(n) = stack.pop() {
        if let Node::Element(el) = n.value() {
            let tag = el.name();
            if tag == "html" || tag == "head" || tag == "body" {
                let kids: Vec<NodeRef<'a, Node>> = n.children().collect();
                for k in kids.into_iter().rev() { stack.push(k); }
                continue;
            }
        }
        out.push(n);
    }
    out.reverse();
    out
}

    fn find_id(tree: &Tree<Node>, selector: &str) -> Result<NodeId, String> {
        let sel = Selector::parse(selector).map_err(|_| format!("selector CSS tidak valid: `{selector}`"))?;
        for node in tree.root().descendants() {
            if let Some(el) = ElementRef::wrap(node) {
                if sel.matches(&el) {
                    return Ok(node.id());
                }
            }
        }
        Err(format!("tidak ada elemen yang cocok dengan `{selector}`"))
    }

    fn copy_children(src: NodeRef<'_, Node>, dst: &mut NodeMut<'_, Node>) {
        for child in src.children() {
            let mut n = dst.append(child.value().clone());
            copy_children(child, &mut n);
        }
    }

    let mut doc = Html::parse_document(source);
    match op {
        "set_text" => {
            if selector.trim().is_empty() {
                return Err("set_text butuh `selector`".into());
            }
            let id = find_id(&doc.tree, selector)?;
            let child_ids: Vec<NodeId> = {
                let node = doc.tree.get(id).ok_or("node hilang")?;
                node.children().map(|c| c.id()).collect()
            };
            for cid in child_ids {
                if let Some(mut c) = doc.tree.get_mut(cid) {
                    c.detach();
                }
            }
            let mut node = doc.tree.get_mut(id).ok_or("node hilang")?;
            node.append(Node::Text(Text { text: text.into() }));
        }
        "replace_html" => {
            if selector.trim().is_empty() {
                return Err("replace_html butuh `selector`".into());
            }
            if fragment.trim().is_empty() {
                return Err("replace_html butuh `html` fragment".into());
            }
            let id = find_id(&doc.tree, selector)?;
            let frag = Html::parse_fragment(fragment);
            let frag_children: Vec<NodeRef<'_, Node>> = frag_children_unwrapped(&frag);
            let mut target = doc.tree.get_mut(id).ok_or("node hilang")?;
            for child in &frag_children {
                let mut inserted = target.insert_before(child.value().clone());
                copy_children(*child, &mut inserted);
            }
            target.detach();
        }
        "append_html" => {
            if fragment.trim().is_empty() {
                return Err("append_html butuh `html` fragment".into());
            }
            let sel = if selector.trim().is_empty() { "body" } else { selector };
            let id = find_id(&doc.tree, sel)?;
            let frag = Html::parse_fragment(fragment);
            let frag_children: Vec<NodeRef<'_, Node>> = frag_children_unwrapped(&frag);
            let mut target = doc.tree.get_mut(id).ok_or("node hilang")?;
            for child in &frag_children {
                let mut appended = target.append(child.value().clone());
                copy_children(*child, &mut appended);
            }
        }
        "remove" => {
            if selector.trim().is_empty() {
                return Err("remove butuh `selector`".into());
            }
            let id = find_id(&doc.tree, selector)?;
            let mut target = doc.tree.get_mut(id).ok_or("node hilang")?;
            target.detach();
        }
        other => {
            return Err(format!(
                "op tidak dikenal: `{other}` (pakai set_text / replace_html / append_html / remove)"
            ));
        }
    }
    let out = doc.html();
    // html5ever keeps the doctype node, but guard anyway: the preview and
    // export render srcDoc, where a missing doctype flips quirks mode.
    if source.trim_start().to_lowercase().starts_with("<!doctype")
        && !out.trim_start().to_lowercase().starts_with("<!doctype")
    {
        return Ok(format!("<!doctype html>\n{out}"));
    }
    Ok(out)
}

fn delete_slide(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let mut deck = load_or_default(ctx);
    let idx = arg_i64(args, "index", -1);
    if idx < 0 || idx as usize >= deck.slides.len() {
        return ToolOutcome {
            content: format!("error: no slide at index {idx}"),
            deck: None,
            pause_question: None,
        };
    }
    deck.slides.remove(idx as usize);
    let updated = persist(ctx, &mut deck);
    ToolOutcome {
        content: format!("slide {idx} deleted. total slides: {}", deck.slides.len()),
        deck: updated,
        pause_question: None,
    }
}

fn save_template(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let deck = load_or_default(ctx);
    let name = {
        let n = arg_str(args, "name");
        if n.trim().is_empty() {
            if deck.title.is_empty() {
                "Untitled template".to_string()
            } else {
                deck.title.clone()
            }
        } else {
            n
        }
    };

    let record = TemplateRecord {
        id: crate::db::new_id("tpl"),
        name: name.clone(),
        description: arg_str(args, "description"),
        deck,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    match ctx.db.save_template(&record) {
        Ok(_) => ToolOutcome {
            content: format!("template saved: {} ({})", record.name, record.id),
            deck: None,
            pause_question: None,
        },
        Err(e) => ToolOutcome {
            content: format!("error saving template: {e}"),
            deck: None,
            pause_question: None,
        },
    }
}

fn list_templates(ctx: &ToolContext<'_>) -> ToolOutcome {
    let items: Vec<Value> = ctx
        .db
        .list_templates()
        .iter()
        .map(|t| {
            json!({
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "slideCount": t.deck.slides.len(),
                "aspect": t.deck.aspect
            })
        })
        .collect();

    ToolOutcome {
        content: if items.is_empty() {
            "no templates saved yet".to_string()
        } else {
            serde_json::to_string_pretty(&items).unwrap_or_default()
        },
        deck: None,
        pause_question: None,
    }
}

fn load_template(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    let id = arg_str(args, "templateId");
    let templates = ctx.db.list_templates();
    let Some(t) = templates.iter().find(|t| t.id == id) else {
        return ToolOutcome {
            content: format!("error: template {id} not found"),
            deck: None,
            pause_question: None,
        };
    };

    let mut deck = load_or_default(ctx);
    // Fresh ids: two decks started from the same template must not share slide
    // identities, or their comments and versions would bleed into each other.
    deck.slides = t
        .deck
        .slides
        .iter()
        .map(|s| Slide {
            id: crate::db::new_id("sl"),
            ..s.clone()
        })
        .collect();
    deck.style_guide = t.deck.style_guide.clone();
    deck.palette = t.deck.palette.clone();
    deck.from_template_id = Some(t.id.clone());
    if deck.title.is_empty() {
        deck.title = t.name.clone();
    }

    let updated = persist(ctx, &mut deck);
    ToolOutcome {
        content: format!(
            "template '{}' loaded: {} slides copied. style guide:\n{}",
            t.name,
            t.deck.slides.len(),
            t.deck.style_guide
        ),
        deck: updated,
        pause_question: None,
    }
}

/* -------------------------------------------------------------------------- */
/* research tools                                                             */
/* -------------------------------------------------------------------------- */

async fn search_web(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    if !ctx.settings.enable_research {
        return ToolOutcome {
            content: "research tools are disabled in settings".into(),
            deck: None,
            pause_question: None,
        };
    }
    let query = arg_str(args, "query");
    let limit = arg_i64(args, "limit", 6).clamp(1, 8) as usize;

    match crate::research::search(&query, limit).await {
        Ok(results) => ToolOutcome {
            content: results,
            deck: None,
            pause_question: None,
        },
        Err(e) => ToolOutcome {
            content: format!("search failed: {e}"),
            deck: None,
            pause_question: None,
        },
    }
}

async fn fetch_url(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
    if !ctx.settings.enable_research {
        return ToolOutcome {
            content: "research tools are disabled in settings".into(),
            deck: None,
            pause_question: None,
        };
    }
    let url = arg_str(args, "url");
    match crate::research::fetch_text(&url).await {
        Ok(text) => ToolOutcome {
            content: text,
            deck: None,
            pause_question: None,
        },
        Err(e) => ToolOutcome {
            content: format!("fetch failed: {e}"),
            deck: None,
            pause_question: None,
        },
    }
}

/// Real creator from the Wikimedia Commons file page (API extmetadata). Empty when unavailable.
/// Strip boilerplate like "This image was taken by ..." from a Commons Artist field so credits read as a name.
pub fn clean_artist_name(a:&str)->String{
    let re=regex::Regex::new(r"(?i)^\s*(this (image|photo|picture|photograph|work|file|media)( was)? (taken|created|made|shot|captured|produced) by|photo(graph)? (taken )?by|image (taken )?by|picture (taken )?by)\s*:?\s*").unwrap();
    let t=re.replace(a,"");
    let t=t.trim().trim_end_matches('.').trim().trim_start_matches("the ").trim();
    if t.len()<3{a.to_string()}else{t.to_string()}
}
#[test]fn artist_boilerplate_stripped(){assert_eq!(clean_artist_name("This image was taken by the NASA Expedition 20 crew."),"NASA Expedition 20 crew");assert_eq!(clean_artist_name("Photo by Gunawan Kartapranata"),"Gunawan Kartapranata");assert_eq!(clean_artist_name("Rijksmuseum"),"Rijksmuseum");}

fn medium_from_categories(cats:&str)->&'static str{if cats.contains("lithograph")||cats.contains("engraving")||cats.contains("woodcut")||cats.contains("print"){"Litografi"}else if cats.contains("artwork")||cats.contains("pd-art"){"Lukisan"}else if cats.contains("painting"){"Lukisan"}else if cats.contains("drawing")||cats.contains("sketch"){"Gambar"}else if cats.contains("map")||cats.contains("cartograph"){"Peta"}else if cats.contains("poster"){"Poster"}else if cats.contains("illustration"){"Ilustrasi"}else{"Foto"}}
async fn commons_credit(source:&str)->String{
    let work=async{
        let t=source.split("/wiki/").nth(1)?; if !source.contains("commons.wikimedia.org"){return None;}
        let title=t.split(['#','?']).next()?;
        let api=format!("https://commons.wikimedia.org/w/api.php?action=query&titles={title}&prop=imageinfo&iiprop=extmetadata&format=json");
        let url=validate_image_url(&api).ok()?;let client=pinned_client(&url).await.ok()?;
        let txt=client.get(url).header("User-Agent","DeselCarouselApp/1.0").send().await.ok()?.text().await.ok()?;
        let v:serde_json::Value=serde_json::from_str(&txt).ok()?;
        let pages=v.get("query")?.get("pages")?.as_object()?;
        let em=pages.values().next()?.get("imageinfo")?.get(0)?.get("extmetadata")?;
        let artist=em.get("Artist")?.get("value")?.as_str()?;
        let tag=regex::Regex::new(r"(?s)<[^>]*>").ok()?;
        let sep=regex::Regex::new(r"</[^>]+>\s*<[^>]+>").unwrap();
        let artist2=sep.replace_all(artist,"; ");
        let a=tag.replace_all(&artist2," ").replace("&amp;","&").split_whitespace().collect::<Vec<_>>().join(" ").trim().trim_end_matches(';').trim_end_matches(',').trim().to_string();
        let a=clean_artist_name(&a);
        let lic=em.get("LicenseShortName").and_then(|x|x.get("value")).and_then(|x|x.as_str()).unwrap_or("").to_string();
        let cats=em.get("Categories").and_then(|x|x.get("value")).and_then(|x|x.as_str()).unwrap_or("").to_lowercase();
        let medium=medium_from_categories(&cats);
        if a.is_empty()||a.len()>80{return None;}
        Some(format!("{a}|{lic}|{medium}"))
    };
    tokio::time::timeout(std::time::Duration::from_secs(6),work).await.ok().flatten().unwrap_or_default()
}

/// Candidates (thumb url, file page url, title) from a Commons generator=search JSON, best rank first, photo formats only.
pub fn commons_candidates(json_text:&str)->Vec<(String,String,String)>{
    let Ok(v)=serde_json::from_str::<serde_json::Value>(json_text) else{return vec![]};
    let Some(pages)=v.get("query").and_then(|q|q.get("pages")).and_then(|p|p.as_object()) else{return vec![]};
    let mut rows:Vec<(i64,String,String,String)>=vec![];
    for p in pages.values(){
        let title=p.get("title").and_then(|t|t.as_str()).unwrap_or("").to_string();
        let low=title.to_lowercase();
        if !(low.ends_with(".jpg")||low.ends_with(".jpeg")||low.ends_with(".png")||low.ends_with(".webp")){continue}
        let Some(ii)=p.get("imageinfo").and_then(|i|i.get(0)) else{continue};
        let thumb=ii.get("thumburl").and_then(|t|t.as_str()).unwrap_or("");
        let page=ii.get("descriptionurl").and_then(|t|t.as_str()).unwrap_or("");
        let w=ii.get("width").and_then(|x|x.as_i64()).unwrap_or(0);
        if thumb.is_empty()||page.is_empty()||w<900{continue}
        rows.push((p.get("index").and_then(|x|x.as_i64()).unwrap_or(99),thumb.to_string(),page.to_string(),title));
    }
    rows.sort_by_key(|r|r.0);
    rows.into_iter().map(|r|(r.1,r.2,r.3)).collect()
}

async fn commons_search_json(query:&str)->Result<String,String>{
    let q:String=query.chars().filter(|c|c.is_alphanumeric()||*c==' '||*c=='-').collect::<String>().split_whitespace().collect::<Vec<_>>().join("+");
    if q.is_empty(){return Err("kata kunci kosong".into())}
    let api=format!("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch={q}&gsrlimit=12&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=1280&format=json");
    let mut last="tidak ada percobaan".to_string();
    for attempt in 0..4{
        if attempt>0{tokio::time::sleep(std::time::Duration::from_secs(3*attempt)).await;}
        let url=validate_image_url(&api).map_err(|e|e.to_string())?;
        let client=pinned_client(&url).await.map_err(|e|e.to_string())?;
        match client.get(url).header("User-Agent","DeselCarouselApp/1.0").send().await{
            Ok(r)if r.status().is_success()=>{if let Ok(t)=r.text().await{return Ok(t)}}
            Ok(r)=>{last=format!("status {}",r.status());}
            Err(e)=>{last=e.to_string();}
        }
    }
    Err(last)
}

#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub enum Verdict{Yes,No,Unsure,Unavailable}

pub fn placeholder_artist(n:&str)->bool{let l=n.to_lowercase();l.trim().len()<3||["unknown","anonym","tidak diketahui","not specified","unspecified","no author","n/a","creator","wikimedia commons","wikipedia commons","credited in file","file title","see file","see description","uncredited","own work"].iter().any(|k|l.contains(k))}
#[test]fn placeholder_artist_detected(){assert!(placeholder_artist("Unknown author"));assert!(placeholder_artist("AnonymousUnknown author"));assert!(placeholder_artist("Wikimedia Commons"));assert!(placeholder_artist("Credited in file title"));assert!(!placeholder_artist("Hiart"));}
pub fn subject_repeat(cand_title:&str,used_pages:&[String],brief:&str)->bool{
    let brief_l=brief.to_lowercase();
    let stop=["file","jpg","jpeg","png","commons","wikimedia","indonesia","indonesian","java","javanese","with","from","street","photo","view","the","and","dari","yang"];
    let toks=|t:&str|->std::collections::HashSet<String>{t.to_lowercase().replace(|c:char|!c.is_alphanumeric()," ").split_whitespace().filter(|w|w.len()>=4&&!stop.contains(w)&&!w.chars().all(|c|c.is_ascii_digit())).map(String::from).collect()};
    let c:std::collections::HashSet<String>=toks(cand_title).into_iter().filter(|w|!brief_l.contains(w.as_str())).collect();
    used_pages.iter().any(|u|{let tail=u.rsplit('/').next().unwrap_or("");let t=toks(&tail.replace("%20"," "));c.intersection(&t).count()>=2})
}

pub fn packaged_product(title:&str,role:&str,msg:&str)->bool{
    let wants=format!("{role} {msg}").to_lowercase();
    if ["kemasan","kaleng","botol","packaging","produk kemasan","merek"].iter().any(|w|wants.contains(w)){return false}
    let t=title.to_lowercase().replace(|c:char|!c.is_alphanumeric()," ");
    t.split_whitespace().map(|w|w.trim_end_matches(|c:char|c.is_ascii_digit())).any(|w|["can","cans","tin","carton","bottle","bottles","packaged","packaging","supermarket","sachet","brand","tetra"].contains(&w))
}

pub fn judge_prompt(role:&str,message:&str,meta:&str)->String{
    let msg_line=if message.trim().is_empty(){String::new()}else{format!("Pesan/judul slide tempat foto dipakai: \"{message}\".\nFoto harus MENDUKUNG pesan slide itu, bukan hanya topik umum.\n")};
    format!("Peran foto di slide: \"{role}\".\n{msg_line}Judul/deskripsi asli sumber foto (bisa bahasa Inggris): \"{meta}\".\nApakah foto itu kemungkinan besar memperlihatkan subjek yang disebut di peran? TIDAK bila peran atau pesan slide menyebut KEGIATAN/BENDA tertentu (mis. penenun, pewarna, benang, indigo, tungku, pengrajin, alat tenun) dan judul/deskripsi/kategori foto tidak menyebut kegiatan atau benda itu (atau sinonimnya) - foto bangunan, lanskap, danau atau bukit TIDAK mendukung pesan tentang proses/bahan, meski daerahnya cocok. TIDAK juga bila peran/pesan menyebut PULAU, KABUPATEN atau SUKU tertentu (mis. Sumba, Toraja, Ponorogo, Minangkabau) dan metadata foto menyebut pulau/kabupaten/suku TETANGGA yang berbeda (mis. Flores, Wae Rebo, Bali, Lombok, Jawa untuk brief Sumba): satu negara bukan berarti daerah yang sama. TIDAK bila foto jelas memperlihatkan KEGIATAN/INDUSTRI LAIN dari yang disebut peran (mis. peran gamelan/musik tetapi foto tempa besi, pengelasan, api pabrik, mesin, dapur atau olahraga; peran tenun tetapi foto pertanian). Kesamaan kata tidak cukup. TIDAK bila brief menyebut produk/daerah spesifik (mis. kopi Gayo, songket Palembang) dan judul/deskripsi foto hanya generik tanpa daerah atau produk itu (mis. 'Coffee Pour Over Setup', 'cafe', 'kitchen', 'weaving loom') - foto stok generik bukan bukti. TIDAK bila peran/pesan membahas MAKANAN, MASAKAN atau BAHAN (mis. gudeg, nangka muda, santan, gula jawa) dan judul/deskripsi foto tidak menyebut hidangan/bahan itu atau daerahnya, atau menyebut hidangan lain/negara lain (mis. 'dessert', 'cake', 'Portland', 'soup', 'curry'): foto makanan yang mirip warna/bentuk BUKAN bukti. TIDAK bila peran/pesan membahas PENJUAL, WARUNG, REGENERASI atau PENUTUP tentang makanan dan foto hanya memperlihatkan tanaman, bunga, hewan, bangunan atau benda yang tidak terkait makanan/penjual/dapur/warung (mis. bunga kecombrang untuk pesan regenerasi warung). TIDAK bila peran atau pesan slide membahas MANUSIA atau AKSI/KEGIATAN yang dilakukan orang (penari, pertunjukan, penenun, penambang, empu, nelayan, pemain, upacara, prosesi, kerja tangan) tetapi judul/deskripsi/kategori foto hanya menunjukkan lanskap, matahari terbenam/terbit, panorama, pantai, langit atau pemandangan kosong tanpa orang atau aksi itu sebagai subjek - foto suasana bukan bukti untuk pesan tentang orang. Jawab satu kata saja: YA, TIDAK, atau RAGU. TIDAK bila peran atau pesan menyebut DAERAH/BUDAYA tertentu (mis. Sumba, Banjarmasin, Toraja) dan judul/deskripsi/kredit foto menyebut negara atau daerah LAIN (India, Odisha, Bangladesh, Vietnam, Thailand, Afrika, dll). TIDAK bila judul menunjukkan dokumen, teks, diploma, sertifikat, poster, tangkapan layar atau arsip, atau bila judul hanya nama orang/tempat tanpa aktivitas/objek yang diminta peran. TIDAK bila peran atau pesan slide menyebut NAMA SPESIFIK (mis. tarian Saman, rumah Tongkonan, burung Maleo, gunung Rinjani) dan judul/deskripsi foto tidak menyebut nama itu atau terjemahan/sinonimnya, hanya hal umum (mis. 'penari', 'rumah', 'burung', 'anak-anak') atau nama jenis lain (RAGU hanya bila judul memang tidak berisi nama apa pun). TIDAK bila peran atau pesan slide menyebut komoditas/objek utama (mis. kopi, burung, gunung, batik) tetapi judul foto hanya menunjukkan kota, panorama, jalan, bangunan, atau lanskap umum tanpa objek itu sebagai subjek. TIDAK bila foto dipakai di slide penutup/ringkasan/cover tetapi judul foto hanya potret/orang berpose atau wajah tanpa objek/aktivitas topik carousel. TIDAK bila judul jelas menunjukkan subjek lain (mis. bendera, pantai, orang acak untuk topik kopi). TIDAK bila judul foto menyebut ILUSTRASI, engraving, litograf, drawing, sketch, lukisan, painting, watercolor, oil on canvas, poster, diagram, chart, grafik, map, peta, locator, topographic, route map atau aerial diagram sementara peran bukan tentang sejarah/seni/peta-data itu: slide butuh foto nyata subjeknya. Cek juga KATEGORI foto: bila kategorinya mengandung 'paintings', 'drawings', 'illustrations', 'maps', 'diagrams' dan peran bukan tentang hal itu, jawab TIDAK. PENGECUALIAN: bila topik/peran jelas mendahului era fotografi (peristiwa atau tokoh sebelum sekitar 1850, mis. Diponegoro, Majapahit, kerajaan kuno) dan lukisan/litograf/ukiran itu menggambarkan subjek peran secara langsung, jawab RAGU (bukan TIDAK) supaya bisa dipakai hanya bila tidak ada foto relevan. TIDAK bila foto dipakai sebagai COVER tetapi judulnya menyebut kemasan, kardus, kotak, lantai, meja kosong, ruangan, toko atau alat tanpa objek/subjek utama carousel di dalam bingkai. KHUSUS COVER: foto cover adalah wajah deck, jadi judul/deskripsi/kategori Commons-nya harus menyebut subjek inti judul deck secara eksplisit (nama tarian/ritual/benda/tempat itu atau sinonim ketatnya) - atraksi, tradisi atau pertunjukan LAIN yang mirip atau sedaerah (mis. debus atau atraksi kebal untuk deck tari piring; kuda lumping/jathilan untuk deck reog; ratoh jaroe untuk deck saman) BUKAN subjek yang sama: jawab TIDAK. Bila metadata tidak membuktikan subjek inti secara eksplisit, jawab RAGU. Bila bukti kurang, jawab RAGU.")
}

pub fn parse_verdict(text:&str)->Verdict{
    let t=text.trim().to_uppercase();
    if t.starts_with("TIDAK")||t.starts_with("NO"){Verdict::No}else if t.starts_with("YA")||t.starts_with("YES"){Verdict::Yes}else if t.starts_with("RAGU"){Verdict::Unsure}else{Verdict::Unsure}
}

async fn judge_photo_relevance(settings:&AppSettings,role:&str,message:&str,meta:&str)->Verdict{
    if settings.api_key.trim().is_empty(){return Verdict::Unsure}
    let base=settings.base_url.trim().trim_end_matches('/');
    let url=if base.ends_with("/v1")||base.contains("/v1/"){format!("{base}/chat/completions")}else{format!("{base}/v1/chat/completions")};
    let prompt=judge_prompt(role,message,meta);
    let Ok(client)=reqwest::Client::builder().timeout(std::time::Duration::from_secs(25)).build() else{return Verdict::Unavailable};
    for _ in 0..3{
        let mut body=json!({"model":settings.model,"messages":[{"role":"user","content":prompt.clone()}],"max_tokens":16,"temperature":0.0});
        if crate::capabilities::configure(&mut body,settings).is_err(){return Verdict::Unavailable}
        let Ok(res)=client.post(&url).json(&body).bearer_auth(settings.api_key.trim()).send().await else{continue};
        if !res.status().is_success(){continue}
        let Ok(v)=res.json::<Value>().await else{continue};
        let text=v["choices"][0]["message"]["content"].as_str().unwrap_or("");
        if text.trim().is_empty(){continue}
        return parse_verdict(text);
    }
    Verdict::Unavailable
}

/// Commons description + categories + GPS (extmetadata) for a file page.
async fn commons_meta(source:&str)->(String,Option<(f64,f64)>){
    let work=async{
        let t=source.split("/wiki/").nth(1)?; if !source.contains("commons.wikimedia.org"){return None;}
        let title=t.split(['#','?']).next()?;
        let api=format!("https://commons.wikimedia.org/w/api.php?action=query&titles={title}&prop=imageinfo&iiprop=extmetadata&format=json");
        let url=validate_image_url(&api).ok()?;let client=pinned_client(&url).await.ok()?;
        let txt=client.get(url).header("User-Agent","DeselCarouselApp/1.0").send().await.ok()?.text().await.ok()?;
        let v:serde_json::Value=serde_json::from_str(&txt).ok()?;
        let em=v.get("query")?.get("pages")?.as_object()?.values().next()?.get("imageinfo")?.get(0)?.get("extmetadata")?.clone();
        let g=|k:&str|em.get(k).and_then(|x|x.get("value")).and_then(|x|x.as_str()).unwrap_or("").to_string();
        let tag=regex::Regex::new(r"(?s)<[^>]*>").ok()?;
        let text=format!("{} | {}",tag.replace_all(&g("ImageDescription"),""),g("Categories").replace('|',", "));
        let gps=match(g("GPSLatitude").parse::<f64>(),g("GPSLongitude").parse::<f64>()){(Ok(a),Ok(b))=>Some((a,b)),_=>None};
        Some((text.chars().take(400).collect::<String>(),gps))
    };
    tokio::time::timeout(std::time::Duration::from_secs(8),work).await.ok().flatten().unwrap_or_default()
}

const ID_WORDS:[&str;42]=["palembang","betawi","padang","surabaya","bandung","medan","makassar","solo","madura","sunda","bugis","minang","samosir","gayo","ponorogo","pempek","rendang","gudeg","indonesia","sumba","ntt","bali","jawa","java","sumatera","sumatra","kalimantan","banjarmasin","sulawesi","toraja","papua","lombok","flores","maluku","aceh","yogyakarta","jakarta","nusantara","minangkabau","dayak","batak","borneo"];
const FOREIGN_WORDS:[&str;24]=["india","odisha","bangladesh","vietnam","thailand","myanmar","burma","pakistan","nepal","china","philippines","laos","cambodia","sri lanka","africa","peru","guatemala","mexico","turkey","iran","morocco","japan","korea","malaysia"];
fn has_word(hay:&str,w:&str)->bool{let h=hay.to_lowercase();let mut from=0;while let Some(p)=h[from..].find(w){let a=from+p;let b=a+w.len();let ok_a=a==0||!h[..a].chars().last().unwrap().is_alphanumeric();let ok_b=b>=h.len()||!h[b..].chars().next().unwrap().is_alphanumeric();if ok_a&&ok_b{return true}from=b;}false}
/// True when the brief is about an Indonesian place but the file metadata/GPS says elsewhere.
pub fn foreign_for_brief(brief:&str,meta:&str,gps:Option<(f64,f64)>)->bool{
    if !ID_WORDS.iter().any(|w|has_word(brief,w)){return false}
    if let Some((la,lo))=gps{if !(la>=-11.5&&la<=6.5&&lo>=94.5&&lo<=141.5){return true}}
    FOREIGN_WORDS.iter().any(|w|has_word(meta,w)&&!has_word(brief,w))
}
pub fn looks_like_document(title:&str)->bool{["page","seite","scan","book","buch","manuscript","inscription","plaque","handwritten","handwriting","certificate","newspaper","naskah","surat","dokumen","tulisan","signature","diagram","logo","poster","document","pdf","djvu","table","chart","map of","peta","grafik","bagan","perangko","prangko","stamp","stempel","text","letter","informasi","infografis","infographic","skema"].iter().any(|w|has_word(title,w))}
#[test]fn geo_city_briefs_reject_foreign(){assert!(foreign_for_brief("pempek Palembang","Scomberomorus commerson Philippines",None));assert!(!foreign_for_brief("pempek Palembang","Pempek Kuah Cuko",None));}

#[test]fn medium_artwork_maps_lukisan(){assert_eq!(medium_from_categories("the arrest of pangeran diponegoro|pd-art (pd-old-auto-expired)|artworks with wikidata item"),"Lukisan");assert_eq!(medium_from_categories("lithographs|history"),"Litografi");assert_eq!(medium_from_categories("photographs of java"),"Foto");}
#[test]fn stamp_titles_rejected(){assert!(looks_like_document("Thomas Cup 1958-1961 stamp of Indonesia"));assert!(looks_like_document("Perangko seri olahraga 1962"));assert!(!looks_like_document("Penonton Istora Senayan"));}
#[test]fn map_titles_rejected(){assert!(looks_like_document("Peta Kecamatan Puncak Sorik Marapi"));assert!(looks_like_document("Peta sebaran habitat harimau"));assert!(!looks_like_document("Pemandangan hutan Sumatra pagi hari"));}
#[test]fn collage_word_detected(){assert!(has_word("portrait collage of the city of yogyakarta","collage"));assert!(has_word("a screenshot of the article","screenshot"));assert!(!has_word("painted portrait of the city","collage"));}
#[test]fn geo_and_doc_filters(){assert!(foreign_for_brief("tenun ikat Sumba","Weaver, Looms in Bangladesh",None));assert!(foreign_for_brief("tenun Sumba","",Some((22.0,85.0))));assert!(!foreign_for_brief("tenun Sumba","Kain Sumba, Nusa Tenggara",Some((-9.6,119.9))));assert!(!foreign_for_brief("weaving in India","India loom",None));assert!(looks_like_document("File:Der Farbenfabrikant page 33.jpg"));assert!(looks_like_document("File:The inscription of Borobudur restoration in 1973.jpg"));assert!(!looks_like_document("Tenun ikat Sumba.jpg"));}

async fn search_commons(ctx:&ToolContext<'_>,args:&Value)->ToolOutcome{
    if !ctx.settings.enable_research{return ToolOutcome{content:"error: research disabled".into(),deck:None,pause_question:None}}
    let query=arg_str(args,"query");let role=arg_str(args,"role");let msg=arg_str(args,"slideMessage");
    if query.trim().is_empty()||role.trim().is_empty(){return ToolOutcome{content:"error: query dan role wajib".into(),deck:None,pause_question:None}}
    let mut words:Vec<&str>=query.split_whitespace().collect();
    let floor=if words.len()>=2{2}else{1};
    let mut cands=vec![];
    loop{
        let q=words.join(" ");
        match commons_search_json(&q).await{Ok(t)=>{cands=commons_candidates(&t);if !cands.is_empty(){break}},Err(e)=>return ToolOutcome{content:format!("error: pencarian Commons gagal ({e}) setelah 4 percobaan. Coba kata kunci lain atau ulangi sebentar lagi."),deck:None,pause_question:None}}
        if words.len()<=floor{break}
        words.pop();
    }
    if cands.is_empty(){return ToolOutcome{content:format!("error: Commons tidak punya foto layak untuk \"{query}\". Coba kata kunci lebih umum atau berbeda."),deck:None,pause_question:None}}
    let brief:String=ctx.db.list_messages(&ctx.deck_id).into_iter().find(|m|m.role=="user").map(|m|m.content).unwrap_or_default();
    let mut tried=vec![];
    let mut named=0;
    for (thumb,page,title) in cands.into_iter().take(8){
        if named>=4{break}
        if {let c=commons_credit(&page).await;c.is_empty()||placeholder_artist(c.split('|').next().unwrap_or(""))}{tried.push(format!("{title}: fotografer tidak bernama"));continue}
        named+=1;
        if ctx.db.list_assets(&ctx.deck_id).iter().any(|a|a.provenance.as_ref().map_or(false,|p|p.source_url==page)){tried.push(format!("{title}: sudah dipakai di deck ini"));continue}
        {let used:Vec<String>=ctx.db.list_assets(&ctx.deck_id).iter().filter_map(|a|a.provenance.as_ref().map(|p|p.source_url.clone())).collect();if subject_repeat(&title,&used,&brief){eprintln!("[filter] repeat-reject {title}");tried.push(format!("{title}: subjek mirip foto slide lain, cari subjek berbeda"));continue}}
        if packaged_product(&title,&role,&msg){eprintln!("[filter] product-reject {title}");tried.push(format!("{title}: foto produk kemasan/kaleng generik, cari foto bahan/hidangan aslinya"));continue}
        if looks_like_document(&title){eprintln!("[filter] doc-reject {title}");tried.push(format!("{title}: dokumen/scan, bukan foto subjek"));continue}
        let (meta,gps)=commons_meta(&page).await;
        if looks_like_document(&meta)||has_word(&meta.to_lowercase(),"collage")||has_word(&meta.to_lowercase(),"screenshot"){eprintln!("[filter] doc-reject-meta {title}");tried.push(format!("{title}: deskripsi menyebut dokumen/kolase/screenshot, bukan foto subjek"));continue}
        if foreign_for_brief(&brief,&format!("{title} {meta}"),gps){eprintln!("[filter] geo-reject {title}");tried.push(format!("{title}: lokasi di luar daerah brief"));continue}
        if packaged_product(&meta,&role,&msg){eprintln!("[filter] product-reject-meta {title}");tried.push(format!("{title}: deskripsi menyebut kemasan/botol/merek, bukan bahan/hidangan asli"));continue}
        let jmeta=format!("{title}. {meta}");
        if judge_photo_relevance(&ctx.settings,&role,&format!("{msg} [Brief carousel: {}]",brief.chars().take(200).collect::<String>()),&jmeta).await==Verdict::No{eprintln!("[filter] judge-reject {title}");tried.push(format!("{title}: ditolak juri subjek"));continue}
        let a=json!({"url":thumb,"sourceUrl":page,"role":role,"slideMessage":msg,"rightsNote":"Wikimedia Commons, lisensi bebas; fotografer dari halaman file"});
        let out=import_image(ctx,&a).await;
        if out.content.starts_with("Imported "){let mut out=out;if !tried.is_empty(){out.content.push_str(&format!("\nCatatan filter (kandidat ditolak sebelum ini): {}",tried.join(" | ")));}eprintln!("[filter] diterima \"{title}\"; ditolak: {}",tried.join(" | "));return out}
        tried.push(format!("{title}: {}",out.content.lines().next().unwrap_or("").chars().take(110).collect::<String>()));
    }
    ToolOutcome{content:format!("error: tidak ada foto yang lolos untuk \"{query}\". Dicoba: {}. Pakai kata kunci lain.",tried.join(" | ")),deck:None,pause_question:None}
}

pub const IMPORT_CAP:usize=14;
async fn import_image(ctx:&ToolContext<'_>,args:&Value)->ToolOutcome{
 if !ctx.settings.enable_research{return ToolOutcome{content:"research disabled".into(),deck:None,pause_question:None}}
 {let n=ctx.db.list_assets(&ctx.deck_id).into_iter().filter(|a|a.id.starts_with("asset_")).count();if n>=IMPORT_CAP{return ToolOutcome{content:format!("error: sudah {n} foto diimpor di deck ini (batas {IMPORT_CAP}). Pakai ulang foto yang ada (list assets) atau hapus kebutuhan foto; jangan impor lagi."),deck:None,pause_question:None}}}
 let url=arg_str(args,"url");let source=arg_str(args,"sourceUrl");let role=arg_str(args,"role");let rights=arg_str(args,"rightsNote");
 if source.trim().is_empty()||role.trim().is_empty()||rights.trim().is_empty(){return ToolOutcome{content:"error: sourceUrl, role and rightsNote required; do not invent licensing permission".into(),deck:None,pause_question:None}}
 if let Some(a)=ctx.db.list_assets(&ctx.deck_id).into_iter().find(|a|a.provenance.as_ref().map_or(false,|p|!p.source_url.is_empty()&&p.source_url==source)){return ToolOutcome{content:format!("error: foto ini SUDAH diimpor di deck ini ({}). Satu foto sekali per carousel: cari foto lain (search_commons dengan kata kunci berbeda) atau pakai angka/diagram.",a.id),deck:None,pause_question:None}}
 let cc=commons_credit(&source).await;let mut parts=cc.splitn(3,'|');let cc_name=parts.next().unwrap_or("").to_string();let cc_lic=parts.next().unwrap_or("").to_string();let cc_medium=parts.next().unwrap_or("Foto").to_string();let cc_medium=if cc_medium.is_empty(){"Foto".to_string()}else{cc_medium};let cc_name=if placeholder_artist(&cc_name){String::new()}else{cc_name};
 let result=async{let provenance=crate::model::AssetProvenance{source_url:source.clone(),creator:cc_name.clone(),rights_note:rights.clone(),alt_text:String::new()};provenance.validate()?;let data_uri=fetch_image_data_uri(&url,5*1024*1024).await?;let (prefix,data)=data_uri.split_once(',').ok_or("invalid image")?;let mime=prefix.trim_start_matches("data:").trim_end_matches(";base64");let id=crate::db::new_id("asset");use base64::Engine as _;let profile=base64::engine::general_purpose::STANDARD.decode(data).ok().and_then(|bytes|crate::palette::analyse(&bytes));let asset=Asset {provenance:Some(provenance),reference_role:if ["cover","body","closer","asset"].contains(&role.as_str()){role.clone()}else{String::new()},reference_status:"candidate".into(),id:id.clone(),deck_id:Some(ctx.deck_id.clone()),name:role.clone(),mime:mime.into(),data:data.into(),profile,created_at:chrono::Utc::now().to_rfc3339()};ctx.db.add_asset(&asset).map_err(|e|e.to_string())?;Ok::<_,String>(format!("Imported {id}. Use <img src=\"asset:{id}\"> in write_slide. Source and rights note stored; rights are your supplied note, not verified permission."))}.await;
 let result=result.map(|s|if cc_name.is_empty(){format!("{s}\nKREDIT: nama fotografer TIDAK terverifikasi untuk foto ini. Jangan menulis kredit karangan; cari foto lain bila perlu kredit, atau hapus baris kredit.")}else{format!("{s}\nKREDIT TERVERIFIKASI (pakai persis): {cc_medium}: {cc_name} / Wikimedia{}",if cc_lic.is_empty(){String::new()}else{format!(" ({cc_lic})")})});
 ToolOutcome{content:result.unwrap_or_else(|e|{let assets=ctx.db.list_assets(&ctx.deck_id).into_iter().filter(|a|a.id.starts_with("asset_")).map(|a|format!("{}: {}",a.id,a.name.chars().take(120).collect::<String>())).collect::<Vec<_>>();format!("image import failed: {e}\nExisting imported assets (not lost): {}. Stop repeated asset hunting when existing relevant screenshots suffice; disclose any missing artwork instead of inventing it.",assets.join("; "))}),deck:None,pause_question:None}
}

#[test]fn judge_prompt_has_role_noun_rule(){assert!(judge_prompt("pewarna","","Lake in Sumba").contains("KEGIATAN/BENDA"));}
#[test]fn judge_prompt_has_other_activity_rule(){assert!(judge_prompt("gamelan","","Blacksmith at work").contains("INDUSTRI LAIN"));}
#[test]fn judge_prompt_has_generic_stock_rule(){assert!(judge_prompt("cangkir kopi","kopi Gayo","Coffee Pour Over Setup").contains("foto stok generik"));}
#[test]fn subject_repeat_detects_same_subject(){let u=vec!["https://commons.wikimedia.org/wiki/File:Nangka_muda_gudeg_Wijilan.jpg".to_string()];assert!(subject_repeat("File:Nangka muda untuk gudeg.jpg",&u,"gudeg Yogyakarta"));assert!(!subject_repeat("File:Kuali tanah liat.jpg",&u,"gudeg"));assert!(!subject_repeat("File:Gudeg Wijilan.jpg",&[],""));let t=vec!["https://commons.wikimedia.org/wiki/File:Danau_Toba_view.jpg".to_string()];assert!(!subject_repeat("File:Perahu dan danau Toba.jpg",&t,"Danau Toba dan Samosir"));}
#[test]fn packaged_product_rejects_cans(){assert!(packaged_product("File:Coconut milk from can01.JPG","santan","Cuma dua bahan"));assert!(!packaged_product("File:Santan segar.jpg","santan",""));assert!(!packaged_product("File:Can.jpg","kaleng susu",""));}
#[test]fn judge_prompt_has_closer_rule(){assert!(judge_prompt("warung","regenerasi","flower").contains("PENUTUP"));}
#[test]fn judge_prompt_has_food_rule(){assert!(judge_prompt("gudeg","","Orange dish Portland").contains("MAKANAN, MASAKAN"));}
#[test]fn judge_prompt_has_illustration_and_cover_object_rule(){let p=judge_prompt("cover","","x");assert!(p.contains("ILUSTRASI")&&p.contains("COVER"));}
#[test]fn judge_prompt_has_island_rule(){assert!(judge_prompt("Sumba","","Women weaving, Wae Rebo, Flores").contains("TETANGGA"));}
#[test]fn judge_prompt_has_region_rule(){assert!(judge_prompt("tenun Sumba","","Weaver in Odisha India").contains("negara atau daerah LAIN"));}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_env() -> (std::path::PathBuf, Db, String) {
        let path = std::env::temp_dir().join(format!("desel-tools-{}.db", uuid::Uuid::new_v4().simple()));
        let db = Db::open(path.clone()).expect("buka db");
        let now = chrono::Utc::now().to_rfc3339();
        let deck = Deck {
            id: "deck_1".into(),
            title: "Untitled deck".into(),
            caption: String::new(),
            aspect: "4:5".into(),
            slides: Vec::new(),
            style_guide: String::new(),
            palette: Vec::new(),
            brand_handle: String::new(),
            save_label: "Save this post".into(),
            from_template_id: None,
            created_at: now.clone(),
            updated_at: now,
        };
        db.save_deck(&deck, None).unwrap();
        (path, db, "deck_1".to_string())
    }

    fn ctx<'a>(db: &'a Db, deck_id: &str) -> ToolContext<'a> {
        ToolContext { db, deck_id: deck_id.to_string(), settings: AppSettings::default() }
    }

    #[test]
    fn slide_count_is_dynamic_not_a_six_slide_template() {
        let (path, db, id) = temp_env();
        let c = ctx(&db, &id);
        assert_eq!(db.get_deck(&id).unwrap().slides.len(), 0);
        for expected in 1..=11 {
            write_slide_inner(&c, &json!({"html":"<!doctype html><html><body>Isi</body></html>"}));
            assert_eq!(db.get_deck(&id).unwrap().slides.len(), expected);
        }
        drop(c); drop(db); let _ = std::fs::remove_file(path);
    }

    #[test]
    fn six_slide_count_and_invalid_delete_are_stable() {
        let (path, db, id) = temp_env();
        let c = ctx(&db, &id);
        for i in 0..6 {
            write_slide_inner(&c, &json!({"index":i,"title":format!("Slide {i}"),"html":"<!doctype html><html><body>Isi</body></html>"}));
        }
        let before = db.get_deck(&id).unwrap();
        assert_eq!(before.slides.len(),6);
        for index in [-1,6,7,999] {
            let out = delete_slide(&c,&json!({"index":index}));
            assert!(out.content.starts_with("error:"));
            assert!(out.deck.is_none());
            let after=db.get_deck(&id).unwrap();
            assert_eq!(serde_json::to_value(&before).unwrap(),serde_json::to_value(&after).unwrap());
        }
        delete_slide(&c,&json!({"index":5}));
        assert_eq!(db.get_deck(&id).unwrap().slides.len(),5);
        drop(c);drop(db);let _=std::fs::remove_file(path);
    }

    #[test]
    fn remote_image_urls_are_collected_from_img_and_css() {
        let html = r#"<img src="https://cdn.example.com/a.png">
            <div style="background-image:url('https://cdn.example.com/b.jpg')"></div>
            <img src="data:image/png;base64,xx">
            <img src="https://cdn.example.com/a.png">"#;
        let urls = collect_remote_image_urls(html);
        assert_eq!(urls, vec!["https://cdn.example.com/a.png", "https://cdn.example.com/b.jpg"]);
    }

    #[test]
    fn remote_image_collection_is_capped() {
        let mut html = String::new();
        for i in 0..8 {
            html.push_str(&format!(r#"<img src="https://cdn.example.com/{i}.png">"#));
        }
        assert_eq!(collect_remote_image_urls(&html).len(), 4);
    }

    #[test]
    fn image_magic_bytes_are_sniffed_not_trusted() {
        assert_eq!(sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0, 1, 2]), Some("image/jpeg"));
        assert_eq!(sniff_image_mime(&[0x89, 0x50, 0x4E, 0x47, 1, 2]), Some("image/png"));
        assert_eq!(sniff_image_mime(b"GIF89a...."), Some("image/gif"));
        assert_eq!(sniff_image_mime(b"RIFFxxxxWEBPvp"), Some("image/webp"));
        assert_eq!(sniff_image_mime(b"<xml></xml>"), None);
        assert_eq!(sniff_image_mime(b""), None);
    }

    #[test]
    fn private_and_metadata_addresses_are_rejected() {
        for bad in [
            "http://127.0.0.1/x.png",
            "http://localhost/x.png", // resolved later; literal check must not crash
            "http://169.254.169.254/latest/meta-data",
            "http://10.0.0.4/internal.png",
            "http://192.168.1.1/cam.png",
            "http://172.16.0.9/x.png",
            "http://[::1]/x.png",
            "http://100.64.0.5/x.png",
            "file:///etc/passwd",
            "https://user:pass@example.com/x.png",
        ] {
            if bad.contains("localhost") {
                // hostnames resolve at fetch time; static validation must accept
                // the URL shape and let the resolver guard reject it.
                assert!(validate_image_url(bad).is_ok(), "{bad}");
                continue;
            }
            assert!(validate_image_url(bad).is_err(), "{bad} harus ditolak");
        }
        assert!(validate_image_url("https://example.com/x.png").is_ok());
        assert!(validate_image_url("http://8.8.8.8/x.png").is_ok());
    }

    #[tokio::test]
    async fn loopback_image_is_never_fetched() {
        let err = fetch_image_data_uri("http://127.0.0.1:1/secret.png", 1024)
            .await
            .expect_err("loopback harus ditolak sebelum jaringan");
        assert!(err.contains("bukan alamat publik"), "{err}");
    }

    #[test]
    fn the_agent_can_write_a_deck_from_scratch_and_it_persists() {
        let (path, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);

        // 1. lock the art direction
        let meta = set_deck_meta(
            &c,
            &json!({
                "title": "Kerja bagus tidak cukup",
                "styleGuide": "Editorial print, Georgia display + Arial label, aksen #b8412f",
                "palette": ["#0d0c0b", "#f2ece1", "#b8412f"]
            }),
        );
        assert!(meta.deck.is_some());

        // 2. write a slide from nothing
        let html = "<!doctype html><html><head><style>body{margin:0;width:1080px;height:1350px;background:#0d0c0b;color:#f2ece1;font-family:Georgia}</style></head><body><h1>Cover</h1></body></html>";
        let out = write_slide_inner(&c, &json!({ "title": "Cover", "html": html, "rationale": "poster" }));
        assert!(out.content.contains("slide"), "{}", out.content);

        // 3. it is on disk, not just in memory
        let stored = db.get_deck(&deck_id).expect("deck tersimpan");
        assert_eq!(stored.slides.len(), 1);
        assert_eq!(stored.slides[0].html, html);
        assert_eq!(stored.title, "Kerja bagus tidak cukup", "judul dari set_deck_meta tidak boleh ditimpa");
        assert!(stored.style_guide.contains("Editorial"));
        assert_eq!(stored.palette.len(), 3);

        // 4. save as a reusable template, then load it into a second deck
        let saved = save_template(&c, &json!({ "name": "Editorial bata", "description": "untuk cerita panjang" }));
        assert!(saved.content.contains("Editorial") || saved.content.contains("template"), "{}", saved.content);
        assert_eq!(db.list_templates().len(), 1);

        let second = Deck {
            id: "deck_2".into(),
            title: "Kedua".into(),
            caption: String::new(),
            aspect: "4:5".into(),
            slides: Vec::new(),
            style_guide: String::new(),
            palette: Vec::new(),
            brand_handle: String::new(),
            save_label: "Save this post".into(),
            from_template_id: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        db.save_deck(&second, None).unwrap();
        let tpl_id = db.list_templates()[0].id.clone();
        let c2 = ctx(&db, "deck_2");
        load_template(&c2, &json!({ "templateId": tpl_id }));
        let loaded = db.get_deck("deck_2").unwrap();
        assert_eq!(loaded.slides.len(), 1, "template harus menyalin slide");

        // 5. delete removes it again
        let c3 = ctx(&db, "deck_1");
        delete_slide(&c3, &json!({ "index": 0 }));
        assert_eq!(db.get_deck(&deck_id).unwrap().slides.len(), 0);

        let _ = std::fs::remove_file(path);
    }


    #[test]
    fn an_untitled_deck_is_named_after_its_first_slide() {
        let (path, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);
        write_slide_inner(
            &c,
            &json!({
                "title": "Kenapa brief yang jelas menang",
                "html": "<!doctype html><html><body><h1>Hi</h1></body></html>"
            }),
        );
        assert_eq!(db.get_deck(&deck_id).unwrap().title, "Kenapa brief yang jelas menang");
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn writing_an_existing_index_rewrites_instead_of_duplicating() {
        let (path, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);

        write_slide_inner(
            &c,
            &json!({ "index": 0, "title": "Cover", "html": "<!doctype html><html><body>awal</body></html>" }),
        );
        write_slide_inner(
            &c,
            &json!({ "index": 1, "title": "Isi", "html": "<!doctype html><html><body>isi</body></html>" }),
        );
        assert_eq!(db.get_deck(&deck_id).unwrap().slides.len(), 2);

        // Same index again = the lint fix the prompt asks for, not a new slide.
        write_slide_inner(
            &c,
            &json!({ "index": 0, "title": "Cover", "html": "<!doctype html><html><body>diperbaiki</body></html>" }),
        );

        let stored = db.get_deck(&deck_id).unwrap();
        assert_eq!(stored.slides.len(), 2, "rewrite tidak boleh menambah slide");
        assert_eq!(stored.slides[0].html, "<!doctype html><html><body>diperbaiki</body></html>");
        assert_eq!(stored.slides[1].title, "Isi", "slide lain tidak boleh bergeser");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn reading_one_slide_returns_its_real_html() {
        let (path, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);
        write_slide_inner(
            &c,
            &json!({
                "index": 0,
                "title": "Cover",
                "html": "<!doctype html><html><body><h1>Desain asli</h1></body></html>"
            }),
        );

        let summary = read_deck(&c, &json!({}));
        assert!(!summary.content.contains("Desain asli"), "ringkasan tidak perlu membawa html");

        let one = read_deck(&c, &json!({ "index": 0 }));
        assert!(one.content.contains("Desain asli"), "revisi butuh html aslinya: {}", one.content);

        let missing = read_deck(&c, &json!({ "index": 7 }));
        assert!(missing.content.starts_with("error:"), "{}", missing.content);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn read_deck_reports_what_exists() {
        let (path, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);
        let out = read_deck(&c, &json!({}));
        assert!(out.content.contains("4:5"), "{}", out.content);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn apply_patch_ops_edit_only_the_target() {
        let html = r#"<!doctype html><html><head><style>body{margin:0}</style></head><body><div class="pad"><h1 id="t">Lama</h1><p class="sub">sub lama</p><div class="card">satu</div></div></body></html>"#;

        let out = apply_patch(html, "set_text", "#t", "", "Judul Baru").unwrap();
        assert!(out.contains("Judul Baru"), "{out}");
        assert!(!out.contains("Lama"), "{out}");
        assert!(out.trim_start().to_lowercase().starts_with("<!doctype"), "doctype hilang: {out}");
        assert!(out.contains(r#"<p class="sub">sub lama</p>"#), "elemen lain tersentuh: {out}");

        let out = apply_patch(html, "append_html", "", r#"<p id="new">tambahan</p>"#, "").unwrap();
        assert!(out.contains("tambahan"), "{out}");

        let out = apply_patch(html, "replace_html", ".card", r#"<div class="card">DUA</div>"#, "").unwrap();
        assert!(out.contains("DUA") && !out.contains(">satu<"), "{out}");

        let out = apply_patch(html, "remove", ".sub", "", "").unwrap();
        assert!(!out.contains("sub lama"), "{out}");

        let err = apply_patch(html, "set_text", "#nope", "", "x").unwrap_err();
        assert!(err.contains("tidak ada elemen"), "{err}");

        let err = apply_patch(html, "set_text", "h1[", "", "x").unwrap_err();
        assert!(err.contains("selector CSS tidak valid"), "{err}");

        let err = apply_patch(html, "teleport", "#t", "", "x").unwrap_err();
        assert!(err.contains("op tidak dikenal"), "{err}");
    }

    #[test]
    fn rewrite_that_adds_errors_is_reverted_unless_forced() {
        let (_p, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);
        write_slide_inner(&c, &json!({"title":"A","html":"<!doctype html><html><body><h1>Bersih</h1></body></html>"}));
        let bad = "<!doctype html><html><body><h1>Kotor</h1><script>1</script></body></html>";
        let out = write_slide_inner(&c, &json!({"index":0,"html":bad}));
        assert!(out.content.contains("REWRITE DITOLAK"), "{}", out.content);
        assert!(db.get_deck(&deck_id).unwrap().slides[0].html.contains("Bersih"));
        let out = write_slide_inner(&c, &json!({"index":0,"html":bad,"force":true}));
        assert!(!out.content.contains("DITOLAK"));
        assert!(db.get_deck(&deck_id).unwrap().slides[0].html.contains("Kotor"));
    }

    #[tokio::test]
    async fn patch_slide_tool_persists_each_edit_as_it_lands() {
        let (path, db, deck_id) = temp_env();
        let c = ctx(&db, &deck_id);
        write_slide_inner(
            &c,
            &json!({
                "title": "Cover",
                "html": r#"<!doctype html><html><body><h1 id="t">Lama</h1><p class="sub">sub</p></body></html>"#
            }),
        );

        // Each patch is one visible edit: a revision is a sequence of these,
        // not one wholesale page swap.
        let out = patch_slide(&c, &json!({"index": 0, "op": "set_text", "selector": "#t", "text": "Baru"})).await;
        assert!(out.deck.is_some(), "{}", out.content);
        let stored = db.get_deck(&deck_id).unwrap();
        assert!(stored.slides[0].html.contains("Baru"), "{}", stored.slides[0].html);
        assert!(stored.slides[0].html.trim_start().to_lowercase().starts_with("<!doctype"));

        let out = patch_slide(&c, &json!({"index": 0, "op": "append_html", "html": r#"<p id="c2">kedua</p>"#})).await;
        assert!(out.deck.is_some(), "{}", out.content);
        let stored = db.get_deck(&deck_id).unwrap();
        assert!(stored.slides[0].html.contains("kedua"), "{}", stored.slides[0].html);
        assert!(stored.slides[0].html.contains("Baru"), "patch sebelumnya hilang");

        let out = patch_slide(&c, &json!({"index": 0, "op": "remove", "selector": ".sub"})).await;
        assert!(out.deck.is_some(), "{}", out.content);
        let stored = db.get_deck(&deck_id).unwrap();
        assert!(!stored.slides[0].html.contains(r#"<p class="sub">"#), "{}", stored.slides[0].html);

        // Bad input must not clobber the stored slide.
        let before = db.get_deck(&deck_id).unwrap().slides[0].html.clone();
        let bad = patch_slide(&c, &json!({"index": 9, "op": "remove", "selector": "#t"})).await;
        assert!(bad.deck.is_none());
        assert!(bad.content.starts_with("error:"), "{}", bad.content);
        let bad = patch_slide(&c, &json!({"index": 0, "op": "set_text", "selector": "#nope", "text": "x"})).await;
        assert!(bad.deck.is_none());
        assert!(bad.content.starts_with("error:"), "{}", bad.content);
        assert_eq!(db.get_deck(&deck_id).unwrap().slides[0].html, before);

        let _ = std::fs::remove_file(path);
    }
}
#[cfg(test)]mod new_asset_tests{
use super::*;
#[test]fn assets_resolve_from_current_deck_only(){let p=std::env::temp_dir().join(format!("asset-{}.db",crate::db::new_id("t")));let db=Db::open(p.clone()).unwrap();let asset=Asset {provenance:None,reference_role:String::new(),reference_status:String::new(),id:"one".into(),deck_id:Some("a".into()),name:"test".into(),mime:"image/png".into(),data:"aGVsbG8=".into(),profile:None,created_at:"2026-01-01T00:00:00Z".into()};db.add_asset(&asset).unwrap();let mut ctx=ToolContext{db:&db,deck_id:"a".into(),settings:AppSettings::default()};assert_eq!(resolve_assets(&ctx,"<img src='asset:one'>"),"<img src='data:image/png;base64,aGVsbG8='>");ctx.deck_id="b".into();assert!(resolve_assets(&ctx,"asset:one").starts_with("asset:"));drop(db);let _=std::fs::remove_file(p);}
#[test]fn tools_match_vision_and_research_settings(){let mut s=AppSettings::default();let tools=tool_specs(&s).to_string();assert!(!tools.contains("review_render"));assert!(tools.contains("import_image"));s.send_references=true;assert!(tool_specs(&s).to_string().contains("review_render"));s.enable_research=false;assert!(!tool_specs(&s).to_string().contains("import_image"));}
}
#[cfg(test)]mod compact_asset_tests{use super::*;#[test]fn read_html_keeps_assets_as_ids_not_megabytes(){let p=std::env::temp_dir().join(format!("compact-{}.db",crate::db::new_id("t")));let db=Db::open(p.clone()).unwrap();db.add_asset(&Asset {provenance:None,reference_role:String::new(),reference_status:String::new(),id:"image_1".into(),deck_id:Some("a".into()),name:"image".into(),mime:"image/png".into(),data:"aGVsbG8=".into(),profile:None,created_at:String::new()}).unwrap();let ctx=ToolContext{db:&db,deck_id:"a".into(),settings:AppSettings::default()};let html="<img src=\"data:image/png;base64,aGVsbG8=\">";let compact=compact_asset_html(&ctx,html);assert_eq!(compact,"<img src=\"asset:image_1\">");assert_eq!(resolve_assets(&ctx,&compact),html);drop(db);let _=std::fs::remove_file(p);}}

#[cfg(test)]mod unsupported_image_tests{use super::*;#[test]fn unsupported_formats_have_actionable_non_guessing_fallback(){assert!(unsupported_image_message(b"<?xml version='1.0'?><svg></svg>").contains("SVG belum didukung"));assert!(unsupported_image_message(b"<!doctype html><html>missing</html>").contains("halaman HTML"));assert!(unsupported_image_message(b"invalid").contains("PNG/JPEG/GIF/WebP"));}}

/// Prepare an existing-slide layout candidate without writing the deck/history.
pub async fn prepare_layout_candidate(ctx:&ToolContext<'_>,name:&str,args:&Value)->Result<(Deck,usize,Slide),String>{
 let deck=load_or_default(ctx);let index=args["index"].as_u64().ok_or("candidate requires existing index")? as usize;let mut slide=deck.slides.get(index).cloned().ok_or("candidate target missing")?;
 let raw=resolve_assets(ctx,&arg_str(args,"html"));let (html,_)=localize_remote_images(&raw).await;
 slide.html=if name=="patch_slide"{apply_patch(&slide.html,&arg_str(args,"op"),&arg_str(args,"selector"),&html,&arg_str(args,"text"))?}else if !html.trim().is_empty(){html}else{return Err("empty candidate".into())};
 Ok((deck,index,slide))
}

#[cfg(test)]mod asset_prefix_tests{use super::*;#[test]fn asset_resolution_does_not_replace_prefixes(){let path=std::env::temp_dir().join(format!("prefix-{}.db",crate::db::new_id("t")));let db=Db::open(path.clone()).unwrap();for(id,data)in[("a","first"),("ab","second")]{db.add_asset(&Asset{id:id.into(),deck_id:Some("d".into()),name:"fixture".into(),mime:"image/png".into(),data:data.into(),profile:None,created_at:"".into(),provenance:None,reference_role:"".into(),reference_status:"".into()}).unwrap();}let c=ToolContext{db:&db,deck_id:"d".into(),settings:AppSettings::default()};assert_eq!(resolve_assets(&c,"asset:a asset:ab asset:abc"),"data:image/png;base64,first data:image/png;base64,second asset:abc");drop(db);let _=std::fs::remove_file(path);}}

#[cfg(test)]mod commons_search_tests{use super::*;
#[test]fn candidates_keep_ranked_photos_only(){let j=r#"{"query":{"pages":{"1":{"title":"File:B.svg","index":1,"imageinfo":[{"thumburl":"t1","descriptionurl":"p1","width":2000}]},"2":{"title":"File:Kopi B.jpg","index":3,"imageinfo":[{"thumburl":"t2","descriptionurl":"p2","width":2000}]},"3":{"title":"File:Kopi A.JPG","index":2,"imageinfo":[{"thumburl":"t3","descriptionurl":"p3","width":1600}]},"4":{"title":"File:Small.jpg","index":4,"imageinfo":[{"thumburl":"t4","descriptionurl":"p4","width":300}]}}}}"#;let c=commons_candidates(j);assert_eq!(c.len(),2);assert_eq!(c[0].2,"File:Kopi A.JPG");assert_eq!(c[1].0,"t2");assert!(commons_candidates("nope").is_empty());}
#[test]fn tool_is_declared_and_dispatched(){let src=include_str!("tools.rs");assert!(src.contains("\"search_commons\" => search_commons"));assert!(src.contains("KREDIT TERVERIFIKASI"));}}

#[cfg(test)]mod judge_tests{use super::*;
#[test]fn verdict_parsing(){assert_eq!(parse_verdict("TIDAK."),Verdict::No);assert_eq!(parse_verdict(" ya"),Verdict::Yes);assert_eq!(parse_verdict("RAGU"),Verdict::Unsure);assert_eq!(parse_verdict("???"),Verdict::Unsure);}
#[test]fn prompt_carries_named_subject_and_closer_rules(){let p=judge_prompt("body slide 2: Saman","Saman, Aceh","Children in yellow costumes.jpg");assert!(p.contains("NAMA SPESIFIK")&&p.contains("penutup/ringkasan/cover")&&p.contains("komoditas")&&p.contains("Saman, Aceh")&&p.contains("Children in yellow"));}}
