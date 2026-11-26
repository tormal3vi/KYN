//! KYN native core.
//!
//! How the app is split:
//! - The web UI in `../src` (HTML/CSS/JS) draws everything you see.
//! - This Rust side does what a web page is not allowed to do on its own:
//!   reading basic system info, scanning *your own* local network (netmap/),
//!   checking your own devices' open ports (portaudit/), and listing which
//!   apps on this computer talk to where (traffic/).
//!
//! JavaScript calls a Rust function with `invoke("function_name")`. The
//! function must be marked `#[tauri::command]` and listed in
//! `generate_handler![...]` below.

use serde::Serialize;
use tauri::Manager;

mod netmap;
mod portaudit;
mod traffic;
mod updater;

/// Basic facts about the machine the app is running on.
/// `Serialize` lets Tauri send this struct to JavaScript as JSON.
#[derive(Serialize)]
pub struct SystemInfo {
    hostname: String,
    os: String,
    arch: String,
}

/// Called from JavaScript as `invoke("system_info")`. Read-only, touches
/// nothing outside this machine.
#[tauri::command]
fn system_info() -> SystemInfo {
    SystemInfo {
        hostname: gethostname::gethostname().to_string_lossy().into_owned(),
        os: std::env::consts::OS.to_string(),     // "macos", "windows", "linux"
        arch: std::env::consts::ARCH.to_string(), // "aarch64" (Apple Silicon), "x86_64"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Auto-updates (see updater.rs and docs/UPDATES.md). Desktop only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            // Network Map keeps its memory (device names, approved networks) in the app data folder.
            app.manage(netmap::NetmapState::new(app.handle()));
            app.manage(portaudit::PortauditState::default());
            // Traffic Monitor keeps the downloaded location database there too.
            app.manage(traffic::TrafficState::new(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            netmap::netmap_network,
            netmap::netmap_approve,
            netmap::netmap_devices,
            netmap::netmap_scan,
            netmap::netmap_set_label,
            netmap::netmap_set_known,
            portaudit::portaudit_scan,
            portaudit::portaudit_cancel,
            portaudit::portaudit_local,
            traffic::traffic_snapshot,
            traffic::traffic_geo_status,
            traffic::traffic_geo_download,
            traffic::traffic_geo_lookup,
            updater::update_check,
            updater::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
