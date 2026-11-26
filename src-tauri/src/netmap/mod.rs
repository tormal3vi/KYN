//! Network Map: find the devices on *your own* local network.
//!
//! Commands the UI calls (see src/js/netmap/api.js):
//!   netmap_network      which network you're on, and whether you approved it
//!   netmap_approve      "yes, this network is mine" (remembered)
//!   netmap_devices      devices remembered from earlier scans (shown offline)
//!   netmap_scan         run a scan; streams `netmap:progress` / `netmap:device`
//!   netmap_set_label    give a device your own name
//!   netmap_set_known    mark a device as known (so unknown ones stand out)

mod arp;
mod classify;
mod mdns;
mod oui;
mod scan;
pub(crate) mod scope;
mod store;

use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use store::{Saved, Store};

pub struct NetmapState {
    path: PathBuf,
    store: Mutex<Store>,
    scanning: AtomicBool,
}

impl NetmapState {
    pub fn new(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("netmap.json");
        let store = Mutex::new(Store::load(&path));
        NetmapState { path, store, scanning: AtomicBool::new(false) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    /// Stable id for this network: the router's MAC, or the subnet.
    pub id: String,
    pub interface: String,
    pub ip: String,
    pub prefix: u8,
    /// What we'll actually scan, e.g. "192.168.1.0/24".
    pub scan_cidr: String,
    pub host_count: usize,
    /// True if the network was bigger than a /24 and we only scan our part.
    pub capped: bool,
    pub gateway_ip: Option<String>,
    pub gateway_mac: Option<String>,
    pub own_mac: Option<String>,
    pub approved: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub ip: String,
    pub mac: Option<String>,
    pub vendor: Option<String>,
    pub randomized: bool,
    pub names: Vec<String>,
    pub model: Option<String>,
    pub services: Vec<String>,
    pub ports: Vec<u16>,
    pub kind: String,
    pub reason: String,
    pub is_gateway: bool,
    pub is_self: bool,
    pub online: bool,
    pub label: Option<String>,
    pub known: bool,
    pub first_seen: u64,
    pub last_seen: u64,
    pub is_new: bool,
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    phase: &'static str,
    done: usize,
    total: usize,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mac_bytes(mac: &netdev::MacAddr) -> Option<[u8; 6]> {
    let o = mac.octets();
    (o != [0; 6]).then_some(o)
}

/// Look at the active network connection.
fn detect(store: &Store) -> Result<(NetworkInfo, scan::Target), String> {
    let iface = netdev::get_default_interface()
        .map_err(|_| "No active network connection found. Are you on Wi-Fi or Ethernet?".to_string())?;
    let net = iface.ipv4.first().ok_or("The active connection has no IPv4 address.")?;
    let ip = net.addr();
    scope::allowed(ip)?;
    let prefix = net.prefix_len();
    let scan_prefix = scope::scan_prefix(prefix);
    let gateway = iface.gateway.as_ref();
    let gateway_ip = gateway.and_then(|g| g.ipv4.first().copied());
    let gateway_mac = gateway.and_then(|g| mac_bytes(&g.mac_addr));
    let own_mac = iface.mac_addr.as_ref().and_then(mac_bytes);
    let cidr = format!("{}/{}", scope::network(ip, scan_prefix), scan_prefix);
    let id = gateway_mac.map(|m| arp::format_mac(&m)).unwrap_or_else(|| cidr.clone());
    let approved = store.networks.get(&id).is_some_and(|n| n.approved);
    let info = NetworkInfo {
        id,
        interface: iface.friendly_name.clone().unwrap_or_else(|| iface.name.clone()),
        ip: ip.to_string(),
        prefix,
        scan_cidr: cidr,
        host_count: scope::hosts(ip, scan_prefix, &[]).len(),
        capped: prefix < scan_prefix,
        gateway_ip: gateway_ip.map(|g| g.to_string()),
        gateway_mac: gateway_mac.map(|m| arp::format_mac(&m)),
        own_mac: own_mac.map(|m| arp::format_mac(&m)),
        approved,
    };
    let target = scan::Target {
        ip,
        prefix,
        own_mac,
        gateway: gateway_ip,
        hostname: gethostname::gethostname().to_string_lossy().into_owned(),
        mdns_wait: Duration::from_millis(4500),
    };
    Ok((info, target))
}

/// Turn raw scan findings into a Device, and update what we remember.
fn merge(f: &scan::Found, saved: Option<&mut Saved>, baseline: bool, t: u64) -> (Device, Saved) {
    let vendor = f.mac.as_ref().and_then(oui::vendor).map(str::to_string);
    let randomized = f.mac.as_ref().is_some_and(oui::is_randomized);
    let names: Vec<String> = f.names.iter().cloned().collect();
    let guess = classify::classify(&classify::Clues {
        is_gateway: f.is_gateway,
        is_self: f.is_self,
        vendor: vendor.as_deref(),
        names: names.clone(),
        services: f.services.iter().cloned().collect(),
        model: f.model.as_deref(),
        ports: f.ports.clone(),
        randomized,
    });
    let id = f.mac.map(|m| arp::format_mac(&m)).unwrap_or_else(|| format!("ip:{}", f.ip));
    let is_new = saved.is_none() && !baseline;
    let mut s = saved.map(|s| s.clone()).unwrap_or(Saved { first_seen: t, ..Default::default() });
    s.last_seen = t;
    s.last_ip = f.ip.to_string();
    s.kind = guess.kind.to_string();
    s.vendor = vendor.clone();
    s.name = names.first().cloned();
    let device = Device {
        id,
        ip: f.ip.to_string(),
        mac: f.mac.map(|m| arp::format_mac(&m)),
        vendor,
        randomized,
        names,
        model: f.model.clone(),
        services: f.services.iter().cloned().collect(),
        ports: f.ports.clone(),
        kind: guess.kind.to_string(),
        reason: guess.reason,
        is_gateway: f.is_gateway,
        is_self: f.is_self,
        online: true,
        label: s.label.clone(),
        known: s.known || f.is_self || f.is_gateway,
        first_seen: s.first_seen,
        last_seen: t,
        is_new,
    };
    (device, s)
}

/// A remembered device that didn't answer this time.
fn offline(id: &str, s: &Saved) -> Device {
    Device {
        id: id.to_string(),
        ip: s.last_ip.clone(),
        mac: (!id.starts_with("ip:")).then(|| id.to_string()),
        vendor: s.vendor.clone(),
        randomized: false,
        names: s.name.clone().into_iter().collect(),
        model: None,
        services: vec![],
        ports: vec![],
        kind: if s.kind.is_empty() { "unknown".into() } else { s.kind.clone() },
        reason: "remembered from an earlier scan".into(),
        is_gateway: false,
        is_self: false,
        online: false,
        label: s.label.clone(),
        known: s.known,
        first_seen: s.first_seen,
        last_seen: s.last_seen,
        is_new: false,
    }
}

fn sort(devices: &mut [Device]) {
    devices.sort_by_key(|d| (!d.online, d.ip.parse::<Ipv4Addr>().map(u32::from).unwrap_or(u32::MAX)));
}

/// The network this computer is on right now (used by Port Audit's scope check).
pub(crate) fn current_network(state: &NetmapState) -> Result<NetworkInfo, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    detect(&store).map(|(info, _)| info)
}

#[tauri::command]
pub fn netmap_network(state: State<'_, NetmapState>) -> Result<NetworkInfo, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    detect(&store).map(|(info, _)| info)
}

#[tauri::command]
pub fn netmap_approve(state: State<'_, NetmapState>, id: String) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.network(&id).approved = true;
    store.save(&state.path)
}

#[tauri::command]
pub fn netmap_devices(state: State<'_, NetmapState>, network: String) -> Result<Vec<Device>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let mut list: Vec<Device> = store
        .networks
        .get(&network)
        .map(|n| n.devices.iter().map(|(id, s)| offline(id, s)).collect())
        .unwrap_or_default();
    sort(&mut list);
    Ok(list)
}

#[tauri::command]
pub async fn netmap_scan(app: AppHandle, state: State<'_, NetmapState>) -> Result<Vec<Device>, String> {
    let (info, target) = {
        let store = state.store.lock().map_err(|e| e.to_string())?;
        detect(&store)?
    };
    if !info.approved {
        return Err("Confirm that this network is yours before scanning it.".into());
    }
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running.".into());
    }

    let t = now();
    let baseline = {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        store.network(&info.id).devices.is_empty()
    };
    let result = scan::run(
        &target,
        |p| {
            let _ = app.emit("netmap:progress", ProgressEvent { phase: p.phase, done: p.done, total: p.total });
        },
        |found| {
            if let Ok(mut store) = state.store.lock() {
                let net = store.network(&info.id);
                let id = found.mac.map(|m| arp::format_mac(&m)).unwrap_or_else(|| format!("ip:{}", found.ip));
                let (device, saved) = merge(&found, net.devices.get_mut(&id), baseline, t);
                net.devices.insert(id, saved);
                let _ = app.emit("netmap:device", device);
            }
        },
    )
    .await;
    state.scanning.store(false, Ordering::SeqCst);
    let found = result?;

    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let net = store.network(&info.id);
    let mut devices: Vec<Device> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for f in &found {
        let id = f.mac.map(|m| arp::format_mac(&m)).unwrap_or_else(|| format!("ip:{}", f.ip));
        // already merged and saved while streaming; build the final record again
        let saved = net.devices.get(&id).cloned();
        let was_new = saved.as_ref().is_some_and(|s| s.first_seen == t) && !baseline;
        let (mut d, _) = merge(f, saved.clone().as_mut(), baseline, t);
        d.is_new = was_new && !d.known;
        seen.insert(id);
        devices.push(d);
    }
    for (id, s) in &net.devices {
        if !seen.contains(id) {
            devices.push(offline(id, s));
        }
    }
    store.save(&state.path)?;
    sort(&mut devices);
    Ok(devices)
}

#[tauri::command]
pub fn netmap_set_label(state: State<'_, NetmapState>, network: String, id: String, label: Option<String>) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let label = label.map(|l| l.trim().chars().take(32).collect::<String>()).filter(|l| !l.is_empty());
    store.network(&network).devices.entry(id).or_default().label = label;
    store.save(&state.path)
}

#[tauri::command]
pub fn netmap_set_known(state: State<'_, NetmapState>, network: String, id: String, known: bool) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.network(&network).devices.entry(id).or_default().known = known;
    store.save(&state.path)
}
