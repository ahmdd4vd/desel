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
                        "aspect": { "type": "string", "enum": ["4:5", "1:1", "9:16"] },
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
                "description": "Pause and ask the user a clarifying question. Use this when the brief is genuinely ambiguous (missing subject, missing brand, unclear format). Do NOT use it to ask for permission.",
                "parameters": {
                    "type": "object",
                    "properties": { "question": { "type": "string" } },
                    "required": ["question"]
                }
            }
        }),
    ];

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
        "write_slide" => write_slide(ctx, args),
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
                "html": slide.html,
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
        if ["4:5", "1:1", "9:16"].contains(&v) {
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

fn write_slide(ctx: &ToolContext<'_>, args: &Value) -> ToolOutcome {
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

    let idx = arg_i64(args, "index", -1);
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
    let issues = crate::lint::lint(&deck.slides[inserted_at].html, w, h);
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
        let out = write_slide(&c, &json!({ "title": "Cover", "html": html, "rationale": "poster" }));
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
        write_slide(
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

        write_slide(
            &c,
            &json!({ "index": 0, "title": "Cover", "html": "<!doctype html><html><body>awal</body></html>" }),
        );
        write_slide(
            &c,
            &json!({ "index": 1, "title": "Isi", "html": "<!doctype html><html><body>isi</body></html>" }),
        );
        assert_eq!(db.get_deck(&deck_id).unwrap().slides.len(), 2);

        // Same index again = the lint fix the prompt asks for, not a new slide.
        write_slide(
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
        write_slide(
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
}