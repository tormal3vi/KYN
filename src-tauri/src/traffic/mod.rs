//! Traffic Monitor: which app on this computer talks to where, and how much.
//!
//! Commands the UI calls (see src/js/traffic/api.js):
//!   traffic_snapshot      this computer's open connections per app, plus data
//!                         used per app and per connection where the system
//!                         reports it (macOS)
//!   traffic_geo_status    is the location database downloaded?
//!   traffic_geo_download  download it once (~37 MB); streams `traffic:geo-progress`
//!   traffic_geo_lookup    for a list of addresses: rough place, owner, server name
//!
//! Scope: only this computer's own connections, read from the operating
//! system's own lists (the same thing Activity Monitor shows). Nothing here
//! captures packets or reads the contents of any connection, and nothing
//! looks at other devices' traffic.

pub(crate) mod conns;
pub(crate) mod geo;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct TrafficState {
    dir: PathBuf,
    geo: geo::Cache,
    downloading: AtomicBool,
}

impl TrafficState {
    pub fn new(app: &AppHandle) -> Self {
        let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("geo");
        TrafficState { dir, geo: geo::Cache::default(), downloading: AtomicBool::new(false) }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub conns: Vec<conns::Conn>,
    /// None where the system doesn't report data used (Windows, Linux)
    pub usage: Option<conns::Usage>,
    /// milliseconds since 1970, so the UI can turn two snapshots into a speed
    pub at: u64,
    pub os: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoStatus {
    pub ready: bool,
    pub downloading: bool,
    pub meta: Option<geo::Meta>,
}

#[derive(Serialize, Clone)]
struct GeoProgress {
    /// "city" (places) or "asn" (owners)
    part: &'static str,
    done: u64,
    total: u64,
}

#[tauri::command]
pub async fn traffic_snapshot() -> Snapshot {
    let (conns, usage) = tokio::join!(conns::connections(), conns::usage());
    Snapshot { conns, usage, at: now_ms(), os: std::env::consts::OS }
}

fn status(state: &TrafficState) -> GeoStatus {
    let ready = geo::ready(&state.dir);
    GeoStatus { ready, downloading: state.downloading.load(Ordering::SeqCst), meta: geo::read_meta(&state.dir).filter(|_| ready) }
}

#[tauri::command]
pub fn traffic_geo_status(state: State<'_, TrafficState>) -> GeoStatus {
    status(&state)
}

#[tauri::command]
pub async fn traffic_geo_download(app: AppHandle, state: State<'_, TrafficState>) -> Result<GeoStatus, String> {
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("The download is already running.".into());
    }
    let result = download(&app, &state).await;
    state.downloading.store(false, Ordering::SeqCst);
    result.map(|_| status(&state))
}

async fn download(app: &AppHandle, state: &TrafficState) -> Result<(), String> {
    let mut meta = geo::Meta::default();
    for (part, package, files) in [("city", geo::CITY_PACKAGE, geo::city_files()), ("asn", geo::ASN_PACKAGE, geo::asn_files())] {
        let got = geo::fetch_package(package, |done, total| {
            let _ = app.emit("traffic:geo-progress", GeoProgress { part, done, total });
        })
        .await?;
        let dir = state.dir.clone();
        let bytes = got.bytes;
        tokio::task::spawn_blocking(move || geo::extract(&bytes, files, &dir)).await.map_err(|e| e.to_string())??;
        match part {
            "city" => meta.city_version = got.version,
            _ => meta.asn_version = got.version,
        }
    }
    meta.downloaded_at = now_ms();
    geo::write_meta(&state.dir, &meta)?;
    // open the fresh files next time
    *state.geo.readers.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Place, owner and server name for each address. Works without the
/// database too (then only "local or not" and the server name are known).
#[tauri::command]
pub async fn traffic_geo_lookup(state: State<'_, TrafficState>, ips: Vec<String>, names: Option<bool>) -> Result<Vec<geo::GeoInfo>, String> {
    let readers = if geo::ready(&state.dir) { Some(state.geo.readers(&state.dir)?) } else { None };
    let mut out: Vec<geo::GeoInfo> = ips
        .iter()
        .take(500)
        .map(|ip| match &readers {
            Some(r) => geo::lookup(r, ip),
            None => geo::lookup_scope_only(ip),
        })
        .collect();
    if names.unwrap_or(true) {
        // 16 at a time; each answer is remembered for next time
        for chunk in out.chunks_mut(16) {
            let jobs: Vec<_> = chunk
                .iter()
                .map(|g| {
                    let (dns, ip, public) = (state.geo.dns.clone(), g.ip.clone(), g.scope == "public");
                    async move { if public { geo::reverse_dns(&dns, &ip).await } else { None } }
                })
                .collect();
            for (g, h) in chunk.iter_mut().zip(futures::future::join_all(jobs).await) {
                g.host = h;
            }
        }
    }
    Ok(out)
}
