#[path="../../../src-tauri/src/model.rs"]mod model;
#[path="../../../src-tauri/src/palette.rs"]mod palette;
#[path="../../../src-tauri/src/capabilities.rs"]mod capabilities;
#[path="../../../src-tauri/src/db.rs"]mod db;
#[path="../../../src-tauri/src/creator.rs"]mod creator;
#[path="../../../src-tauri/src/agent.rs"]mod agent;
#[path="../../../src-tauri/src/tools.rs"]mod tools;
#[path="../../../src-tauri/src/tokens.rs"]mod tokens;
#[path="../../../src-tauri/src/research.rs"]mod research;
#[path="../../../src-tauri/src/lint.rs"]mod lint;
#[path="../../../src-tauri/src/response_protocol.rs"]mod response_protocol;
#[path="../../../src-tauri/src/project_file.rs"]mod project_file;
#[cfg(test)]
mod variant_fixture_tests {
    use super::*;
    use project_file::*;
    fn db() -> db::Db {
        db::Db::open(std::env::temp_dir().join(format!(
            "desel-variant-fixture-{}.db",
            uuid::Uuid::new_v4()
        )))
        .unwrap()
    }
    const BASE: &str = include_str!("../fixtures/base-project.desel.json");
    const VARIANT: &str = include_str!("../fixtures/variant-16x9.desel.json");

    #[test]
    fn ts_canonical_file_imports_as_new_project() {
        let db = db();
        let deck = import(&db, BASE).unwrap();
        assert_eq!(deck.title, "Fixture deck");
        assert_eq!(deck.slides.len(), 2);
        let variant = import(&db, VARIANT).unwrap();
        assert_eq!(variant.aspect, "16:9");
        assert_eq!(variant.title, "Fixture deck · 16:9");
        assert_eq!(variant.slides.len(), 2);
        assert!(variant.slides[0].html.contains("desel-reflow-stage"));
        assert!(variant.slides[0].html.contains("scale(0.8)"));
        // Import inlines asset references.
        assert!(variant.slides[0].html.contains("data:image/png;base64,"));
        // Workspace survives with remapped lock IDs (no ghost locks).
        let w = db.creator_workspace(&variant.id).unwrap();
        let locked = w["lockedSlideIds"].as_array().unwrap();
        assert_eq!(locked.len(), 1);
        assert!(variant.slides.iter().any(|s| &s.id == locked[0].as_str().unwrap()));
        let objects = w["lockedObjects"].as_array().unwrap();
        assert_eq!(objects.len(), 1);
        assert!(variant.slides.iter().any(|s| s.id == objects[0]["slideId"].as_str().unwrap()));
    }

    #[test]
    fn ts_canonical_file_with_tampered_payload_fails_checksum() {
        let db = db();
        let mut v: serde_json::Value = serde_json::from_str(VARIANT).unwrap();
        v["payload"]["deck"]["title"] = "tampered".into();
        assert!(import(&db, &v.to_string()).is_err());
        assert!(db.list_decks().is_empty());
    }

    #[test]
    fn native_export_of_ts_canonical_import_matches_byte_for_byte() {
        // The TS canonical writer must match serde_json::to_vec exactly: export
        // the same payload natively and compare the payload bytes. New ids and
        // timestamps from import make file-level comparison meaningless, so
        // compare digests of the stored payload via a manual snapshot.
        let db = db();
        let file: ProjectFile = serde_json::from_str(BASE).unwrap();
        let digest_before = file.checksum.clone();
        let payload = file.payload;
        db.import_project_atomic(&payload.deck, &payload.assets, &payload.comments)
            .unwrap();
        if let Some(w) = &payload.workspace {
            db.save_creator_workspace(&payload.deck.id, w).unwrap();
        }
        let text = export(&db, &payload.deck.id).unwrap();
        let re: ProjectFile = serde_json::from_str(&text).unwrap();
        assert_eq!(re.checksum, digest_before, "TS canonical bytes diverge from serde");
        assert_eq!(re.payload.deck.title, "Fixture deck");
        assert_eq!(re.payload.comments.len(), 1);
        assert!((re.payload.comments[0].x - 120.0).abs() < f64::EPSILON);
    }
}

#[cfg(test)] mod recovery_workspace_test {
 use super::*;
 #[test] fn recovery_copy_preserves_workspace_with_remapped_locks() {
  let p=std::env::temp_dir().join(format!("recovery-{}.db",uuid::Uuid::new_v4()));
  let db=db::Db::open(p.clone()).unwrap();
  let deck:model::Deck=serde_json::from_value(serde_json::json!({"id":"d","slides":[{"id":"s","html":"<body><p id=keep>keep</p></body>"}]})).unwrap();
  db.save_deck(&deck,None).unwrap();
  db.save_creator_workspace("d",&serde_json::json!({"draft":"unsent","queue":[],"memory":[],"lockedSlideIds":["s"],"lockedObjects":[{"slideId":"s","selector":"#keep","label":"Keep"}]})).unwrap();
  let mut unsaved=deck.clone();unsaved.title="Unsaved title".into();
  let copy=project_file::recovery_copy(&db,unsaved).unwrap();
  assert_eq!(copy.title,"Unsaved title (local recovery)");
  let w=db.creator_workspace(&copy.id).unwrap();assert_eq!(w["draft"],"unsent");
  assert_eq!(w["lockedSlideIds"][0],copy.slides[0].id);assert_eq!(w["lockedObjects"][0]["slideId"],copy.slides[0].id);
  assert_eq!(db.get_deck("d").unwrap().title,deck.title);
  drop(db);let _=std::fs::remove_file(p);
 }
}
#[path="../../../src-tauri/src/chatgpt_auth.rs"]mod chatgpt_auth;
#[path="../../../src-tauri/src/credential_storage.rs"]mod credential_storage;
