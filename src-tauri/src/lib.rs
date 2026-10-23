//! Desel — AI carousel studio.
//!
//! Backend responsibilities:
//! - persist everything (settings, decks, chat, templates, comments) in SQLite
//! - drive an agent loop against any OpenAI-compatible provider
//! - expose web research + filesystem export as tools/commands

mod agent;
mod commands;
mod db;
mod lint;
mod model;
mod palette;
mod research;
mod tools;

use tauri::Manager;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("app data dir harus tersedia");
            std::fs::create_dir_all(&dir).ok();

            let db_path = dir.join("desel.db");
            let db = db::Db::open(db_path).expect("gagal membuka database");
            app.manage(AppState { db });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::list_models,
            commands::test_connection,
            commands::list_decks,
            commands::get_deck,
            commands::create_deck,
            commands::save_deck,
            commands::delete_deck,
            commands::duplicate_deck,
            commands::list_messages,
            commands::clear_messages,
            commands::append_message,
            commands::send_to_agent,
            commands::list_templates,
            commands::save_template,
            commands::delete_template,
            commands::list_comments,
            commands::add_comment,
            commands::set_comment_status,
            commands::delete_comment,
            commands::export_default_dir,
            commands::write_export,
            commands::reveal_path,
            commands::storage_info,
            commands::lint_deck,
            commands::list_revisions,
            commands::restore_revision,
            commands::list_references,
            commands::add_reference_paths,
            commands::add_reference_url,
            commands::add_reference_data,
            commands::delete_reference,
            commands::reference_data,
        ])
        .run(tauri::generate_context!())
        .expect("error saat menjalankan Desel");
}
