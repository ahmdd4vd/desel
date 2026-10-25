//! Native account lifecycle. Tokens never cross the IPC boundary.
use crate::chatgpt_auth::*;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Manager;
#[derive(Default)]
pub struct Accounts {
    attempt: Mutex<Option<Attempt>>,
    status: Mutex<LoginStatus>,
}
struct Attempt {
    id: String,
    cancel: Arc<AtomicBool>,
}
#[derive(Clone, Default, Serialize)]
pub struct LoginStatus {
    pub state: String,
    pub attempt_id: Option<String>,
    pub message: String,
}
#[derive(Serialize)]
pub struct AccountState {
    pub accounts: Vec<AccountSummary>,
    pub login: LoginStatus,
    pub inference_ready: bool,
    pub storage: String,
}
fn store(app: &tauri::AppHandle) -> Result<AccountStore, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot locate Desel account storage")?
        .join("chatgpt");
    Ok(AccountStore::new(root))
}
#[tauri::command]
pub fn chatgpt_accounts(
    app: tauri::AppHandle,
    state: tauri::State<'_, Accounts>,
) -> Result<AccountState, String> {
    Ok(AccountState {
        accounts: store(&app)?.summaries()?,
        login: state
            .status
            .lock()
            .map_err(|_| "Account state unavailable")?
            .clone(),
        inference_ready: false,
        storage: if cfg!(windows) {
            "Windows current-user DPAPI"
        } else {
            "Owner-only local credentials"
        }
        .into(),
    })
}
#[derive(Serialize)]
pub struct LoginStart {
    pub attempt_id: String,
    pub authorization_url: String,
}
/// Only called from an explicit user sign-in click; never from app startup.
#[tauri::command]
pub async fn chatgpt_login_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, Accounts>,
) -> Result<LoginStart, String> {
    let account_store = store(&app)?;
    let host = account_store.host_id()?;
    let listener = LoginListener::bind(None).await?;
    let url = listener.pending.authorization_url(&host)?;
    let id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut attempt = state
            .attempt
            .lock()
            .map_err(|_| "Account state unavailable")?;
        if attempt.is_some() {
            return Err("A sign-in is already in progress".into());
        }
        *attempt = Some(Attempt {
            id: id.clone(),
            cancel: cancel.clone(),
        });
        *state
            .status
            .lock()
            .map_err(|_| "Account state unavailable")? = LoginStatus {
            state: "waiting".into(),
            attempt_id: Some(id.clone()),
            message: "Complete sign-in in your browser. Inference is not enabled yet.".into(),
        };
    }
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let (pending, callback) = listener
                .receive(cancel.clone(), std::time::Duration::from_secs(300))
                .await?;
            if cancel.load(Ordering::Relaxed) {
                return Err("Sign-in cancelled".into());
            }
            let service = AuthService::new()?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "System clock unavailable")?
                .as_secs();
            let record = service.exchange(&pending, &callback, None, now).await?;
            if cancel.load(Ordering::Relaxed) {
                let _ = service.revoke(&record).await;
                return Err("Sign-in cancelled before saving account".into());
            }
            account_store.save_validated(&record)?;
            Ok::<(), String>(())
        }
        .await;
        let state = app.state::<Accounts>();
        if let Ok(mut attempt) = state.attempt.lock() {
            if attempt.as_ref().map(|a| a.id.as_str()) == Some(task_id.as_str()) {
                *attempt = None;
                if let Ok(mut status) = state.status.lock() {
                    *status = LoginStatus {
                        state: if result.is_ok() { "connected" } else { "error" }.into(),
                        attempt_id: None,
                        message: result.err().unwrap_or_else(|| {
                            "Account verified and saved. Model inference is not enabled yet.".into()
                        }),
                    };
                }
            }
        };
    });
    Ok(LoginStart {
        attempt_id: id,
        authorization_url: url,
    })
}
#[tauri::command]
pub fn chatgpt_login_cancel(
    state: tauri::State<'_, Accounts>,
    attempt_id: String,
) -> Result<(), String> {
    let attempt = state
        .attempt
        .lock()
        .map_err(|_| "Account state unavailable")?;
    let attempt = attempt.as_ref().ok_or("No sign-in in progress")?;
    if attempt.id != attempt_id {
        return Err("Sign-in attempt mismatch".into());
    }
    attempt.cancel.store(true, Ordering::Relaxed);
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_sign_out(app: tauri::AppHandle, id: String) -> Result<SignoutResult, String> {
    store(&app)?.sign_out(&id, &AuthService::new()?).await
}
