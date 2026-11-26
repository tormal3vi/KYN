//! Auto-updates.
//!
//! How it works: every release published on GitHub (see docs/UPDATES.md)
//! includes a small `latest.json` saying "the newest version is X, download it
//! here, and here is its signature". The app reads that file, and if X is newer
//! than itself it downloads the update, checks the signature against the public
//! key in tauri.conf.json (so only updates signed with *your* private key are
//! accepted), installs it and restarts.
//!
//! Updates are switched off in development builds (`npm run dev`), so your
//! working copy never tries to replace itself.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// "dev" (development build), "unconfigured" (no signing key set up yet),
    /// "current" (up to date) or "available".
    pub state: &'static str,
    pub current: String,
    pub version: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

fn status(state: &'static str, current: String) -> UpdateStatus {
    UpdateStatus { state, current, version: None, notes: None }
}

#[tauri::command]
pub async fn update_check<R: Runtime>(app: AppHandle<R>) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();
    if cfg!(debug_assertions) {
        return Ok(status("dev", current));
    }
    if !configured(&app) {
        return Ok(status("unconfigured", current));
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(u) => UpdateStatus { state: "available", current, version: Some(u.version.clone()), notes: u.body.clone() },
        None => status("current", current),
    })
}

/// Download, verify and install the update, then restart into it.
/// Streams `update:progress` events while downloading.
#[tauri::command]
pub async fn update_install<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Updates are off in development builds.".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Already up to date.")?;
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("update:progress", Progress { downloaded, total });
            },
            || {
                let _ = app.emit("update:installing", ());
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
