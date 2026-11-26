//! Port Audit: which "doors" (TCP ports) are open on your own devices.
//!
//! Commands the UI calls (see src/js/portaudit/api.js):
//!   portaudit_scan    knock on a list of ports (or all 65,535) of one device;
//!                     streams `portaudit:progress` and `portaudit:open`
//!   portaudit_cancel  stop a running scan
//!   portaudit_local   this computer: which app listens on which port, whether
//!                     it is reachable from the network, and the firewall state
//!
//! A "knock" is a normal TCP connection attempt: if the device accepts it, the
//! port is open, and we close the connection straight away. Nothing is sent,
//! nothing is logged in to. What each port means (and how risky it is) is
//! explained in the UI, from src/js/portaudit/knowledge.js.
//!
//! Scope: only this computer, or devices on the network you approved in
//! Network Map. Anything else is refused.

mod local;

use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use futures::stream::{self, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::netmap::{self, scope, NetmapState};

#[derive(Default)]
pub struct PortauditState {
    running: AtomicBool,
    cancel: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub ip: String,
    pub open: Vec<u16>,
    pub scanned: usize,
    pub millis: u64,
    pub cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalReport {
    pub listeners: Vec<local::Listener>,
    pub firewall: Option<bool>,
    pub os: &'static str,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
    open: usize,
}

/// May KYN knock on this address? This computer and devices on your approved
/// network only.
///   own:     this computer's address on the network (if known)
///   network: (network address, prefix, approved) of the current network
pub fn target_allowed(target: Ipv4Addr, own: Option<Ipv4Addr>, network: Option<(Ipv4Addr, u8, bool)>) -> Result<(), String> {
    if target.is_loopback() || Some(target) == own {
        return Ok(());
    }
    scope::allowed(target)?;
    match network {
        Some((net, prefix, approved)) if scope::network(target, prefix) == net => {
            if approved {
                Ok(())
            } else {
                Err("Confirm in Network Map that this network is yours first.".into())
            }
        }
        _ => Err(format!("{target} is not on your current network. Port Audit only checks your own devices.")),
    }
}

/// True if the port accepted a connection (we close it again right away).
async fn knock(ip: Ipv4Addr, port: u16, wait: Duration) -> bool {
    matches!(timeout(wait, TcpStream::connect((ip, port))).await, Ok(Ok(_)))
}

/// Knock on `ports` of `ip`, at most `parallel` at a time. Calls `on_open`
/// for each open port and `on_progress(done)` now and then; stops early when
/// `cancelled()` turns true.
pub async fn scan_ports(
    ip: Ipv4Addr,
    ports: Vec<u16>,
    parallel: usize,
    wait: Duration,
    cancelled: impl Fn() -> bool,
    on_open: impl Fn(u16),
    on_progress: impl Fn(usize),
) -> (Vec<u16>, usize) {
    let done = AtomicUsize::new(0);
    let mut open = Vec::new();
    let mut knocks = stream::iter(ports)
        .map(|port| async move { (port, knock(ip, port, wait).await) })
        .buffer_unordered(parallel);
    let mut last = Instant::now();
    while let Some((port, is_open)) = knocks.next().await {
        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
        if is_open {
            open.push(port);
            on_open(port);
        }
        if last.elapsed() > Duration::from_millis(120) {
            last = Instant::now();
            on_progress(n);
        }
        if cancelled() {
            break;
        }
    }
    open.sort_unstable();
    (open, done.load(Ordering::Relaxed))
}

#[tauri::command]
pub async fn portaudit_scan(
    app: AppHandle,
    state: State<'_, PortauditState>,
    netmap_state: State<'_, NetmapState>,
    ip: String,
    ports: Option<Vec<u16>>,
) -> Result<ScanResult, String> {
    let target: Ipv4Addr = ip.trim().parse().map_err(|_| format!("\"{ip}\" is not an IPv4 address."))?;
    let net = netmap::current_network(&netmap_state).ok();
    let own = net.as_ref().and_then(|n| n.ip.parse().ok());
    let network = net.as_ref().and_then(|n| {
        let (addr, prefix) = n.scan_cidr.split_once('/')?;
        Some((addr.parse().ok()?, prefix.parse().ok()?, n.approved))
    });
    target_allowed(target, own, network)?;

    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A check is already running.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);

    let ports: Vec<u16> = match ports {
        Some(list) if !list.is_empty() => list,
        _ => (1..=u16::MAX).collect(), // full check
    };
    let total = ports.len();
    let local = target.is_loopback() || Some(target) == own;
    // Your own computer answers instantly; other devices get a moment longer.
    // 128 at a time stays well under macOS' default limit of 256 open files.
    let wait = Duration::from_millis(if local { 150 } else { 400 });
    let started = Instant::now();
    let found = AtomicUsize::new(0);
    let _ = app.emit("portaudit:progress", Progress { done: 0, total, open: 0 });
    let (open, scanned) = scan_ports(
        target,
        ports,
        128,
        wait,
        || state.cancel.load(Ordering::SeqCst),
        |port| {
            found.fetch_add(1, Ordering::Relaxed);
            let _ = app.emit("portaudit:open", port);
        },
        |done| {
            let _ = app.emit("portaudit:progress", Progress { done, total, open: found.load(Ordering::Relaxed) });
        },
    )
    .await;
    let cancelled = state.cancel.load(Ordering::SeqCst);
    let _ = app.emit("portaudit:progress", Progress { done: scanned, total, open: open.len() });
    state.running.store(false, Ordering::SeqCst);
    Ok(ScanResult { ip: target.to_string(), open, scanned, millis: started.elapsed().as_millis() as u64, cancelled })
}

#[tauri::command]
pub fn portaudit_cancel(state: State<'_, PortauditState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn portaudit_local() -> Result<LocalReport, String> {
    let (listeners, firewall) = tokio::join!(local::listeners(), local::firewall_on());
    Ok(LocalReport { listeners, firewall, os: std::env::consts::OS })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NET: Option<(Ipv4Addr, u8, bool)> = Some((Ipv4Addr::new(192, 168, 1, 0), 24, true));
    const ME: Option<Ipv4Addr> = Some(Ipv4Addr::new(192, 168, 1, 20));

    #[test]
    fn own_devices_are_allowed() {
        assert!(target_allowed(Ipv4Addr::LOCALHOST, None, None).is_ok());
        assert!(target_allowed("192.168.1.20".parse().unwrap(), ME, NET).is_ok());
        assert!(target_allowed("192.168.1.1".parse().unwrap(), ME, NET).is_ok());
    }

    #[test]
    fn everything_else_is_refused() {
        // public address
        assert!(target_allowed("8.8.8.8".parse().unwrap(), ME, NET).is_err());
        // private, but another network
        assert!(target_allowed("10.0.0.5".parse().unwrap(), ME, NET).is_err());
        // right network, but not confirmed as yours
        let unapproved = Some((Ipv4Addr::new(192, 168, 1, 0), 24, false));
        assert!(target_allowed("192.168.1.1".parse().unwrap(), ME, unapproved).is_err());
        // no network info at all
        assert!(target_allowed("192.168.1.1".parse().unwrap(), None, None).is_err());
    }

    /// Opens a real listening socket on this machine and checks the scanner
    /// finds exactly it, among a range of ports on 127.0.0.1 only.
    #[tokio::test]
    async fn finds_an_open_port_on_this_machine() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let ports: Vec<u16> = (port.saturating_sub(20)..=port.saturating_add(20)).collect();
        let total = ports.len();
        let reported = std::sync::Mutex::new(Vec::new());
        let (open, scanned) = scan_ports(
            Ipv4Addr::LOCALHOST,
            ports,
            32,
            Duration::from_millis(200),
            || false,
            |p| reported.lock().unwrap().push(p),
            |_| {},
        )
        .await;
        assert_eq!(scanned, total);
        assert!(open.contains(&port));
        assert_eq!(reported.lock().unwrap().contains(&port), true);
        drop(listener);
    }

    #[tokio::test]
    async fn lists_this_machines_listeners() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let found = local::listeners().await;
        let me = found.iter().find(|l| l.port == port).expect("our own test socket should be listed");
        assert!(!me.exposed, "bound to 127.0.0.1, so local only");
        assert!(me.process.is_some());
    }
}
