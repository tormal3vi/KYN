//! OPS: one-key security checks for the situation you're in ("I just joined a
//! hotel Wi-Fi", "lock this Mac down", "who's on my Wi-Fi?"). The ops
//! themselves are put together in the UI (src/js/ops/catalog.js) from these
//! building blocks plus the other modules' commands:
//!
//!   ops_posture       built-in protections of this computer (posture.rs)
//!   ops_network       the network this computer uses right now: VPN, DNS servers
//!   ops_captive       is a login page in the way?
//!   ops_dns           are name lookups honest?
//!   ops_tls           is anyone reading this computer's HTTPS traffic?
//!   ops_threats       match addresses against public threat lists (threats.rs)
//!   ops_history_load / ops_history_save   past runs, so ops can say what changed
//!
//! Everything here looks at this computer and its own traffic only.

pub(crate) mod netcheck;
pub(crate) mod posture;
pub(crate) mod threats;

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

pub struct OpsState {
    dir: PathBuf,
}

impl OpsState {
    pub fn new(app: &AppHandle) -> Self {
        OpsState { dir: app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir()) }
    }
}

#[tauri::command]
pub async fn ops_posture() -> posture::Posture {
    posture::posture().await
}

#[tauri::command]
pub fn ops_network() -> netcheck::NetInfo {
    netcheck::net_info()
}

#[tauri::command]
pub async fn ops_captive() -> netcheck::Captive {
    netcheck::captive().await
}

#[tauri::command]
pub async fn ops_dns() -> netcheck::DnsCheck {
    netcheck::dns().await
}

#[tauri::command]
pub async fn ops_tls() -> Result<Vec<netcheck::TlsProbe>, String> {
    netcheck::tls().await
}

#[tauri::command]
pub async fn ops_threats(state: State<'_, OpsState>, ips: Vec<String>) -> Result<threats::Report, String> {
    Ok(threats::check(&state.dir.join("threats"), &ips).await)
}

#[tauri::command]
pub fn ops_history_load(state: State<'_, OpsState>) -> serde_json::Value {
    std::fs::read_to_string(state.dir.join("ops.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[tauri::command]
pub fn ops_history_save(state: State<'_, OpsState>, data: serde_json::Value) -> Result<(), String> {
    let text = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    if text.len() > 2_000_000 {
        return Err("history too large".into());
    }
    std::fs::create_dir_all(&state.dir).map_err(|e| e.to_string())?;
    let tmp = state.dir.join("ops.json.part");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, state.dir.join("ops.json")).map_err(|e| e.to_string())
}
