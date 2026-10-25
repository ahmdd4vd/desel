//! Portable local project, no credentials, connection settings or raw reasoning.
use crate::{
    db::{new_id, Db},
    model::*,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectPayload {
    pub deck: Deck,
    pub assets: Vec<Asset>,
    pub comments: Vec<Comment>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFile {
    pub format: String,
    pub version: u32,
    pub checksum: String,
    pub payload: ProjectPayload,
}
fn digest(p: &ProjectPayload) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(p).map_err(|_| "Cannot encode project")?)
    ))
}
fn validate(p: &ProjectPayload) -> Result<(), String> {
    use base64::Engine;
    if p.deck.slides.len() > 200 || p.assets.len() > 200 || p.comments.len() > 2000 {
        return Err("Project exceeds item limits".into());
    }
    if !["4:5", "1:1", "9:16", "16:9"].contains(&p.deck.aspect.as_str()) {
        return Err("Unsupported project aspect".into());
    }
    let mut ids = std::collections::HashSet::new();
    let unsafe_html = regex::Regex::new(
        r#"(?i)<\s*(script|iframe|object|embed|base|link)\b|\bon[a-z]+\s*=|javascript\s*:|<\s*meta[^>]*http-equiv\s*="#,
    )
    .unwrap();
    for s in &p.deck.slides {
        if s.id.is_empty()
            || !ids.insert(s.id.as_str())
            || s.html.len() > 4 * 1024 * 1024
            || unsafe_html.is_match(&s.html)
        {
            return Err("Project has duplicate slide IDs or unsafe slide HTML".into());
        }
    }
    let mut assets = std::collections::HashSet::new();
    for a in &p.assets {
        if let Some(note)=&a.provenance{note.validate()?;}
        if a.id.is_empty()
            || !assets.insert(a.id.as_str())
            || a.deck_id.as_deref() != Some(&p.deck.id)
            || !matches!(
                a.mime.as_str(),
                "image/png" | "image/jpeg" | "image/webp" | "image/gif"
            )
        {
            return Err("Invalid project asset identity or image format".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&a.data)
            .map_err(|_| "Invalid project image encoding")?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("Oversized project image".into());
        }
        let reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(|_| "Invalid image")?;
        let expected = match a.mime.as_str() {
            "image/png" => image::ImageFormat::Png,
            "image/jpeg" => image::ImageFormat::Jpeg,
            "image/webp" => image::ImageFormat::WebP,
            _ => image::ImageFormat::Gif,
        };
        if reader.format() != Some(expected) {
            return Err("Project image MIME does not match bytes".into());
        }
        let (w, h) = reader
            .into_dimensions()
            .map_err(|_| "Invalid project image")?;
        if w == 0 || h == 0 || w > 16000 || h > 16000 || u64::from(w) * u64::from(h) > 40_000_000 {
            return Err("Project image dimensions exceed safe limits".into());
        }
        let mut decoder = image::ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(|_| "Invalid image")?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(16000);
        limits.max_image_height = Some(16000);
        limits.max_alloc = Some(192 * 1024 * 1024);
        decoder.limits(limits);
        decoder
            .decode()
            .map_err(|_| "Project image is damaged or exceeds decode limits")?;
    }
    for slide in &p.deck.slides {
        for capture in regex::Regex::new(r"asset:([A-Za-z0-9_-]+)")
            .unwrap()
            .captures_iter(&slide.html)
        {
            if !assets.contains(&capture[1]) {
                return Err("Slide refers to missing project asset".into());
            }
        }
    }
    let mut comment_ids = std::collections::HashSet::new();
    for c in &p.comments {
        if c.id.is_empty()
            || !comment_ids.insert(c.id.as_str())
            || c.deck_id != p.deck.id
            || !ids.contains(c.slide_id.as_str())
            || !c.x.is_finite()
            || !c.y.is_finite()
        {
            return Err("Invalid project comment target".into());
        }
    }
    Ok(())
}
pub fn export(db: &Db, id: &str) -> Result<String, String> {
    let (deck, assets, comments) = db.portable_snapshot(id)?;
    let payload = ProjectPayload {
        deck,
        assets,
        comments,
    };
    validate(&payload)?;
    let file = ProjectFile {
        format: "desel-project".into(),
        version: 1,
        checksum: digest(&payload)?,
        payload,
    };
    let text = serde_json::to_string(&file).map_err(|_| "Cannot encode project")?;
    if text.len() > 32 * 1024 * 1024 {
        return Err("Project exceeds32MB portable file limit".into());
    }
    Ok(text)
}
pub fn import(db: &Db, text: &str) -> Result<Deck, String> {
    if text.len() > 32 * 1024 * 1024 {
        return Err("Project file exceeds32MB limit".into());
    }
    let file: ProjectFile = serde_json::from_str(text).map_err(|_| "Invalid Desel project file")?;
    if file.format != "desel-project" || file.version != 1 {
        return Err("Unsupported project format/version".into());
    }
    if digest(&file.payload)? != file.checksum {
        return Err("Project checksum mismatch; file may be damaged".into());
    }
    validate(&file.payload)?;
    clone_payload(db, file.payload)
}
pub fn duplicate(db: &Db, id: &str) -> Result<Deck, String> {
    let (deck, assets, comments) = db.portable_snapshot(id)?;
    let mut p = ProjectPayload {
        deck,
        assets,
        comments,
    };
    p.deck.title = format!("{} (copy)", p.deck.title);
    clone_payload(db, p)
}
fn clone_payload(db: &Db, mut p: ProjectPayload) -> Result<Deck, String> {
    let mut remap = std::collections::HashMap::new();
    p.deck.id = new_id("deck");
    p.deck.from_template_id = None;
    let now = chrono::Utc::now().to_rfc3339();
    p.deck.created_at = now.clone();
    p.deck.updated_at = now;
    for s in &mut p.deck.slides {
        let old = s.id.clone();
        s.id = new_id("slide");
        remap.insert(old, s.id.clone());
    }
    let mut asset_remap = std::collections::HashMap::new();
    for a in &mut p.assets {
        let old = a.id.clone();
        a.id = new_id("asset");
        a.deck_id = Some(p.deck.id.clone());
        asset_remap.insert(old, a.id.clone());
    }
    let asset_pattern = regex::Regex::new(r"asset:([A-Za-z0-9_-]+)").unwrap();
    let mut expanded_bytes = 0usize;
    for slide in &mut p.deck.slides {
        let mut expected = slide.html.len();
        for caps in asset_pattern.captures_iter(&slide.html) {
            if let Some(a) = asset_remap
                .get(&caps[1])
                .and_then(|id| p.assets.iter().find(|a| &a.id == id))
            {
                expected = expected
                    .saturating_add(a.data.len() + a.mime.len() + 13)
                    .saturating_sub(caps[0].len());
            }
        }
        expanded_bytes = expanded_bytes.saturating_add(expected);
        if expected > 4 * 1024 * 1024 || expanded_bytes > 32 * 1024 * 1024 {
            return Err("Project images expand beyond safe slide limits".into());
        }
        slide.html = asset_pattern
            .replace_all(&slide.html, |caps: &regex::Captures| {
                asset_remap
                    .get(&caps[1])
                    .and_then(|new| p.assets.iter().find(|a| &a.id == new))
                    .map(|a| format!("data:{};base64,{}", a.mime, a.data))
                    .unwrap_or_else(|| caps[0].to_string())
            })
            .into_owned();
    }
    for c in &mut p.comments {
        c.id = new_id("comment");
        c.deck_id = p.deck.id.clone();
        c.slide_id = remap
            .get(&c.slide_id)
            .ok_or("Missing slide mapping")?
            .clone();
    }

    db.import_project_atomic(&p.deck, &p.assets, &p.comments)?;
    Ok(p.deck)
}
#[tauri::command]
pub fn export_project(
    state: tauri::State<'_, crate::commands::AppState>,
    deck_id: String,
) -> Result<String, String> {
    export(&state.db, &deck_id)
}
#[tauri::command]
pub fn import_project(
    state: tauri::State<'_, crate::commands::AppState>,
    content: String,
) -> Result<Deck, String> {
    import(&state.db, &content)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Db {
        Db::open(std::env::temp_dir().join(format!("desel-portable-{}.db", uuid::Uuid::new_v4())))
            .unwrap()
    }
    fn deck() -> Deck {
        serde_json::from_value(serde_json::json!({"id":"original","title":"Local fixture","slides":[{"id":"s","title":"cover","html":"<body><h1>Safe content</h1></body>"}]})).unwrap()
    }
    #[test]
    fn portable_roundtrip_is_new_project_and_preserves_original() {
        let db = db();
        db.save_deck(&deck(), None).unwrap();
        let text = export(&db, "original").unwrap();
        assert!(!text.contains("apiKey"));
        let copy = import(&db, &text).unwrap();
        assert_ne!(copy.id, "original");
        assert_ne!(copy.slides[0].id, "s");
        assert_eq!(copy.slides[0].html, deck().slides[0].html);
        assert!(db.get_deck("original").is_some());
    }
    #[test]
    fn tamper_version_unsafe_and_size_fail_before_mutation() {
        let db = db();
        db.save_deck(&deck(), None).unwrap();
        let text = export(&db, "original").unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&text).unwrap();
        v["payload"]["deck"]["title"] = "tampered".into();
        assert!(import(&db, &v.to_string()).is_err());
        v["version"] = 2.into();
        assert!(import(&db, &v.to_string()).is_err());
        let mut p = ProjectPayload {
            deck: deck(),
            assets: vec![],
            comments: vec![],
        };
        p.deck.slides[0].html = "<img onerror='steal()'>".into();
        assert!(validate(&p).is_err());
        assert_eq!(db.list_decks().len(), 1);
    }
}

#[cfg(test)]
mod asset_tests {
    use super::*;
    #[test]
    fn assets_and_pins_roundtrip_and_database_failure_rolls_back() {
        use base64::Engine;
        let path =
            std::env::temp_dir().join(format!("desel-asset-roundtrip-{}.db", uuid::Uuid::new_v4()));
        let db = Db::open(path.clone()).unwrap();
        let mut d:Deck=serde_json::from_value(serde_json::json!({"id":"source","slides":[{"id":"slide","html":"<body><img src='asset:pic'></body>"}]})).unwrap();
        db.save_deck(&d, None).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let a = Asset {
            id: "pic".into(),
            deck_id: Some(d.id.clone()),
            name: "local fixture".into(),
            mime: "image/png".into(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes.into_inner()),
            profile: None,
            created_at: String::new(),
            provenance:Some(AssetProvenance{creator:"Fixture creator".into(),rights_note:"Unverified fixture note".into(),..Default::default()}),reference_role: "cover".into(),
            reference_status: "approved".into(),
        };
        db.add_asset(&a).unwrap();
        db.add_comment(&Comment {
            id: "pin".into(),
            deck_id: d.id.clone(),
            slide_id: "slide".into(),
            x: 10.,
            y: 20.,
            body: "Keep".into(),
            author: "user".into(),
            status: "open".into(),
            selector: "img".into(),
            created_at: String::new(),
        })
        .unwrap();
        let copy = import(&db, &export(&db, &d.id).unwrap()).unwrap();
        let assets = db.list_assets(&copy.id);
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].reference_status, "approved");
        assert_eq!(assets[0].provenance.as_ref().unwrap().creator,"Fixture creator");
        assert!(copy.slides[0].html.contains(&format!(
            "data:{};base64,{}",
            assets[0].mime, assets[0].data
        )));
        let pins = db.list_comments(&copy.id);
        assert_eq!(pins[0].slide_id, copy.slides[0].id);
        assert_eq!(pins[0].body, "Keep");
        d.id = "rollback".into();
        let mut conflict = a.clone();
        conflict.deck_id = Some(d.id.clone());
        assert!(db.import_project_atomic(&d, &[conflict], &[]).is_err());
        assert!(db.get_deck("rollback").is_none());
        drop(db);
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod validation_tests {
    use super::*;
    #[test]
    fn charset_metadata_allowed_but_active_payloads_and_missing_assets_rejected() {
        let mut p=ProjectPayload{deck:serde_json::from_value(serde_json::json!({"id":"d","slides":[{"id":"s","html":"<!doctype html><html><head><meta charset='utf-8'></head><body>Hi</body></html>"}]})).unwrap(),assets:vec![],comments:vec![]};
        assert!(validate(&p).is_ok());
        for html in [
            "<script>alert(1)</script>",
            "<meta http-equiv='refresh' content='0;url=https://example.invalid'>",
            "<img src='asset:missing'>",
            "<a href='javascript:alert(1)'>x</a>",
        ] {
            p.deck.slides[0].html = html.into();
            assert!(validate(&p).is_err(), "{html}");
        }
    }
}

#[cfg(test)]
mod duplication_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn duplicate_uses_fresh_slide_ids_and_preserves_original() {
        let path = std::env::temp_dir().join(format!("duplicate-{}.db", new_id("t")));
        let db = Db::open(path.clone()).unwrap();
        let d: Deck = serde_json::from_value(
            json!({"id":"d","title":"source","slides":[{"id":"s","html":"<body>hello</body>"}]}),
        )
        .unwrap();
        db.save_deck(&d, None).unwrap();
        let copy = duplicate(&db, "d").unwrap();
        assert_ne!(copy.id, d.id);
        assert_ne!(copy.slides[0].id, d.slides[0].id);
        assert_eq!(copy.slides[0].html, d.slides[0].html);
        assert_eq!(db.get_deck("d").unwrap().title, "source");
        assert_eq!(copy.title, "source (copy)");
        assert_eq!(db.deck_history_counts(&copy.id), [0, 0]);
        drop(db);
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn save_recovery_copy(
    state: tauri::State<'_, crate::commands::AppState>,
    deck: Deck,
) -> Result<Deck, String> {
    let (_, assets, comments) = state.db.portable_snapshot(&deck.id)?;
    let ids: std::collections::HashSet<_> = deck.slides.iter().map(|s| s.id.as_str()).collect();
    let comments = comments
        .into_iter()
        .filter(|c| ids.contains(c.slide_id.as_str()))
        .collect();
    let mut p = ProjectPayload {
        deck,
        assets,
        comments,
    };
    p.deck.title = format!("{} (local recovery)", p.deck.title);
    clone_payload(&state.db, p)
}

#[cfg(test)]
mod image_boundary_tests {
    use super::*;
    use base64::Engine;
    use serde_json::json;
    #[test]
    fn mime_corruption_and_expansion_are_rejected_before_insert() {
        let path = std::env::temp_dir().join(format!("image-boundary-{}.db", new_id("t")));
        let db = Db::open(path.clone()).unwrap();
        let deck:Deck=serde_json::from_value(json!({"id":"d","slides":[{"id":"s","html":"<img src='asset:a'><img src='asset:ab'>"}]})).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let asset = Asset {
            id: "a".into(),
            deck_id: Some("d".into()),
            name: "fixture".into(),
            mime: "image/png".into(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes.into_inner()),
            profile: None,
            created_at: String::new(),
            provenance:None,reference_role: String::new(),
            reference_status: String::new(),
        };
        let mut b = asset.clone();
        b.id = "ab".into();
        let mut p = ProjectPayload {
            deck,
            assets: vec![asset, b],
            comments: vec![],
        };
        assert!(validate(&p).is_ok());
        p.assets[0].mime = "image/jpeg".into();
        assert!(validate(&p).is_err());
        p.assets[0].mime = "image/png".into();
        p.assets[0].data = base64::engine::general_purpose::STANDARD.encode(b"not an image");
        assert!(validate(&p).is_err());
        p.assets[0].data = p.assets[1].data.clone();
        let restored = clone_payload(&db, p).unwrap();
        assert_eq!(
            restored.slides[0]
                .html
                .matches("data:image/png;base64,")
                .count(),
            2
        );
        assert!(!restored.slides[0].html.contains("asset:"));
        let mut giant: ProjectPayload = ProjectPayload {
            deck: restored,
            assets: vec![],
            comments: vec![],
        };
        giant.deck.slides[0].html = "<img src='asset:huge'>".repeat(60);
        let mut a = db.list_assets(&giant.deck.id).first().unwrap().clone();
        a.id = "huge".into();
        a.data = "A".repeat(100000);
        giant.assets.push(a);
        assert!(clone_payload(&db, giant).is_err());
        assert_eq!(db.list_decks().len(), 1);
        drop(db);
        let _ = std::fs::remove_file(path);
    }
}

/// Templates must not depend on the source project's asset IDs surviving.
pub fn template_snapshot(db:&Db,deck:&Deck)->Result<Deck,String>{
 let assets=db.list_assets(&deck.id).into_iter().map(|a|(a.id.clone(),a)).collect::<std::collections::HashMap<_,_>>();let pattern=regex::Regex::new(r"asset:([A-Za-z0-9_-]+)").unwrap();let mut copy=deck.clone();let mut total=0usize;
 for s in &mut copy.slides{let mut expected=s.html.len();for caps in pattern.captures_iter(&s.html){let a=assets.get(&caps[1]).ok_or("Template contains missing asset; attach it before saving")?;expected=expected.saturating_add(a.data.len()+a.mime.len()+13).saturating_sub(caps[0].len());}total=total.saturating_add(expected);if expected>4*1024*1024||total>32*1024*1024{return Err("Template images exceed safe inline limits".into())}s.html=pattern.replace_all(&s.html,|c:&regex::Captures|{let a=&assets[&c[1]];format!("data:{};base64,{}",a.mime,a.data)}).into_owned();}Ok(copy)
}
#[cfg(test)]mod template_asset_tests{use super::*;use serde_json::json;
#[test]fn template_pixels_survive_source_deletion_and_missing_refs_reject(){let p=std::env::temp_dir().join(format!("template-assets-{}",new_id("t")));let db=Db::open(p.clone()).unwrap();let d:Deck=serde_json::from_value(json!({"id":"d","slides":[{"id":"s","html":"<img src='asset:a'>"}]})).unwrap();db.save_deck(&d,None).unwrap();let a:Asset=serde_json::from_value(json!({"id":"a","deckId":"d","mime":"image/png","data":"aW1hZ2U="})).unwrap();db.add_asset(&a).unwrap();let snapshot=template_snapshot(&db,&d).unwrap();assert!(snapshot.slides[0].html.contains("data:image/png;base64,aW1hZ2U="));db.delete_deck("d").unwrap();assert!(snapshot.slides[0].html.contains("data:image/png"));assert!(template_snapshot(&db,&d).is_err());drop(db);let _=std::fs::remove_file(p);}}
