//! KYN native core.
//!
//! How the app is split:
//! - The web UI in `../src` (HTML/CSS/JS) draws everything you see.
//! - This Rust side does what a web page is not allowed to do on its own:
//!   right now, reading basic system info. Next, scanning *your own* local
//!   network for the Network Map module.
//!
//! JavaScript calls a Rust function with `invoke("function_name")`. The
//! function must be marked `#[tauri::command]` and listed in
//! `generate_handler![...]` below.

use serde::Serialize;

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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![system_info])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
