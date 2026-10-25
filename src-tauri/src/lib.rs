//! Desel — AI carousel studio.
//!
//! Backend responsibilities:
//! - persist everything (settings, decks, chat, templates, comments) in SQLite
//! - drive an agent loop against any OpenAI-compatible provider
//! - expose web research + filesystem export as tools/commands

mod creator;
mod response_protocol;
mod project_file;
mod export_files;
mod agent;
mod chatgpt_auth;
mod chatgpt_accounts;
mod credential_storage;
mod capabilities;
mod commands;
mod db;
mod lint;
mod model;
mod provider_runtime;
mod palette;
mod research;
mod tools;
mod tokens;

use tauri::Manager;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(provider_runtime::ProviderRuntime::default())
        .manage(chatgpt_accounts::Accounts::default())
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
            app.manage(AppState { db, geometry: std::sync::Mutex::new(std::collections::HashMap::new()), cancel: std::sync::Mutex::new(std::collections::HashMap::new()) });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chatgpt_accounts::chatgpt_accounts,
            provider_runtime::provider_management,
            provider_runtime::provider_runtime_status,
            provider_runtime::provider_runtime_start,
            provider_runtime::provider_runtime_stop,
            provider_runtime::provider_runtime_manage,
            project_file::save_recovery_copy,
            project_file::export_project,
            project_file::import_project,
            commands::get_settings,
            commands::save_settings,
            commands::list_models,
            commands::discover_models,
            commands::test_connection,
            commands::list_decks,
            commands::get_deck,
            commands::create_deck,
            commands::save_deck,
            commands::deck_history_counts,
            commands::step_deck_history,
            commands::delete_deck,
            commands::duplicate_deck,
            commands::list_messages,
            commands::clear_messages,
            commands::get_chat_branches,
            commands::creator_resume_plan,
            commands::get_creator_workspace,
            commands::save_creator_workspace,
            commands::save_chat_branches,
            commands::append_message,
            commands::send_to_agent,
            commands::creator_runs,
            commands::report_geometry_lints,
            commands::submit_render_review,
            commands::cancel_agent,
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
            commands::set_reference_intent,
            commands::set_asset_provenance,
            commands::list_asset_library,
            commands::list_brands,
            commands::save_brand,
            commands::delete_brand,
            commands::asset_by_id,
            commands::copy_library_asset,
            commands::add_reference_paths,
            commands::add_reference_url,
            commands::add_reference_data,
            commands::delete_reference,
            commands::reference_data,
        ])
        .build(tauri::generate_context!())
        .expect("error saat menjalankan Desel").run(|app,event|{if matches!(event,tauri::RunEvent::Exit){app.state::<provider_runtime::ProviderRuntime>().stop();}});
}
