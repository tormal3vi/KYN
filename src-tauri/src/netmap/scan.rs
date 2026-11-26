//! The scan itself. Four steps, about 6–9 seconds on a home network:
//!
//! 1. Sweep: knock once on every address in your subnet (a tiny UDP packet and
//!    a TCP connection attempt to port 80/443). Doing that makes your computer
//!    ask "who has this address?" on the network (ARP), and every device
//!    that's switched on answers with its MAC address, even if it ignores
//!    the knock itself.
//! 2. Read the computer's ARP table to get those IP → MAC answers. Then knock
//!    once more on the addresses that stayed silent (sleepy phones often only
//!    answer the second time) and read the table again.
//! 3. Meanwhile, listen for Bonjour announcements (mdns.rs).
//! 4. Identify each device that answered: its name from your router (reverse
//!    DNS) and a quick check of ~15 well-known ports that hint at what it is.
//!
//! Nothing here sends data to devices or logs in to anything; it is the same
//! kind of traffic a computer makes when you open a network folder.

use std::collections::{BTreeSet, HashMap};
use std::io::ErrorKind;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::{arp, mdns, scope};

/// Ports that hint at what a device is (see classify.rs).
pub const ID_PORTS: &[u16] = &[22, 80, 443, 445, 548, 554, 631, 1400, 3389, 5000, 8008, 8009, 8080, 9100, 62078];

/// Everything learned about one address, before it's classified.
#[derive(Debug, Clone)]
pub struct Found {
    pub ip: Ipv4Addr,
    pub mac: Option<[u8; 6]>,
    pub names: BTreeSet<String>,
    pub services: BTreeSet<String>,
    pub model: Option<String>,
    pub ports: Vec<u16>,
    pub is_gateway: bool,
    pub is_self: bool,
}

pub struct Target {
    pub ip: Ipv4Addr,
    pub prefix: u8,
    pub own_mac: Option<[u8; 6]>,
    pub gateway: Option<Ipv4Addr>,
    pub hostname: String,
    pub mdns_wait: Duration,
}

pub struct Progress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

/// Some(true) = port open, Some(false) = host answered "closed", None = silence.
async fn knock(ip: Ipv4Addr, port: u16, wait: Duration) -> Option<bool> {
    match timeout(wait, TcpStream::connect((ip, port))).await {
        Ok(Ok(_)) => Some(true),
        Ok(Err(e)) if e.kind() == ErrorKind::ConnectionRefused => Some(false),
        _ => None,
    }
}

async fn reverse_dns(ip: Ipv4Addr) -> Option<String> {
    let lookup = tokio::task::spawn_blocking(move || dns_lookup::lookup_addr(&ip.into()).ok());
    let name = timeout(Duration::from_millis(1500), lookup).await.ok()?.ok()??;
    (name != ip.to_string()).then_some(name)
}

pub async fn run(
    t: &Target,
    on_progress: impl Fn(Progress),
    on_found: impl Fn(Found),
) -> Result<Vec<Found>, String> {
    scope::allowed(t.ip)?;
    let prefix = scope::scan_prefix(t.prefix);
    let net = scope::network(t.ip, prefix);
    let in_net = |ip: Ipv4Addr| scope::network(ip, prefix) == net;
    let targets = scope::hosts(t.ip, prefix, &[t.ip]);
    let total = targets.len();

    // 3. Bonjour listening runs in the background during the sweep.
    let wait = t.mdns_wait;
    let bonjour = tokio::task::spawn_blocking(move || {
        if wait.is_zero() { HashMap::new() } else { mdns::browse(wait) }
    });

    // 1. Sweep.
    on_progress(Progress { phase: "sweep", done: 0, total });
    let udp = Arc::new(UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?);
    let mut answered: BTreeSet<Ipv4Addr> = BTreeSet::new();
    let mut sweep = stream::iter(targets)
        .map(|ip| {
            let udp = udp.clone();
            async move {
                let _ = udp.send_to(&[0], (ip, 9)); // port 9 = "discard": ignored by everyone
                let wait = Duration::from_millis(700);
                let (a, b) = tokio::join!(knock(ip, 80, wait), knock(ip, 443, wait));
                (ip, a.is_some() || b.is_some())
            }
        })
        .buffer_unordered(64);
    let mut done = 0;
    while let Some((ip, alive)) = sweep.next().await {
        done += 1;
        if alive { answered.insert(ip); }
        if done % 8 == 0 || done == total {
            on_progress(Progress { phase: "sweep", done, total });
        }
    }

    // 2. ARP table (give late answers a moment to arrive first).
    tokio::time::sleep(Duration::from_millis(600)).await;
    let mut macs: HashMap<Ipv4Addr, [u8; 6]> = HashMap::new();
    let read_arp = |macs: &mut HashMap<Ipv4Addr, [u8; 6]>, answered: &mut BTreeSet<Ipv4Addr>, entries: Vec<arp::Entry>| {
        for e in entries {
            if in_net(e.ip) && e.ip != t.ip {
                macs.insert(e.ip, e.mac);
                answered.insert(e.ip);
            }
        }
    };
    read_arp(&mut macs, &mut answered, arp::read_table().await);

    // Second chance: phones and tablets that were asleep often wake up on the
    // first knock and only answer the next one. Knock again on the silent
    // addresses (UDP only, instant), wait a moment, read the table again.
    let silent: Vec<Ipv4Addr> = scope::hosts(t.ip, prefix, &[t.ip]).into_iter().filter(|ip| !answered.contains(ip)).collect();
    if !silent.is_empty() {
        for ip in &silent {
            let _ = udp.send_to(&[0], (*ip, 9));
        }
        tokio::time::sleep(Duration::from_millis(1200)).await;
        read_arp(&mut macs, &mut answered, arp::read_table().await);
    }
    if let Some(gw) = t.gateway.filter(|g| in_net(*g)) {
        answered.insert(gw);
    }
    answered.insert(t.ip); // this computer

    let bonjour = bonjour.await.unwrap_or_default();
    for ip in bonjour.keys() {
        if in_net(*ip) { answered.insert(*ip); }
    }

    // 4. Identify everyone who answered.
    let total = answered.len();
    on_progress(Progress { phase: "identify", done: 0, total });
    let mut identify = stream::iter(answered.into_iter())
        .map(|ip| {
            let mac = if ip == t.ip { t.own_mac } else { macs.get(&ip).copied() };
            let info = bonjour.get(&ip).cloned().unwrap_or_default();
            async move {
                let probes = ID_PORTS.iter().map(|&p| async move { (p, knock(ip, p, Duration::from_millis(500)).await) });
                let (ports, name) = tokio::join!(futures::future::join_all(probes), reverse_dns(ip));
                let mut names = info.names;
                if ip == t.ip { names.insert(t.hostname.clone()); }
                names.extend(name);
                Found {
                    ip,
                    mac,
                    names,
                    services: info.services,
                    model: info.model,
                    ports: ports.into_iter().filter(|(_, s)| *s == Some(true)).map(|(p, _)| p).collect(),
                    is_gateway: Some(ip) == t.gateway,
                    is_self: ip == t.ip,
                }
            }
        })
        .buffer_unordered(16);
    let mut all = Vec::new();
    let mut done = 0;
    while let Some(found) = identify.next().await {
        done += 1;
        on_progress(Progress { phase: "identify", done, total });
        on_found(found.clone());
        all.push(found);
    }
    all.sort_by_key(|f| f.ip);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Runs the whole pipeline against this machine's own loopback address
    /// (127.0.0.1/32): no other network is touched.
    #[tokio::test]
    async fn scans_loopback_only() {
        let target = Target {
            ip: Ipv4Addr::LOCALHOST,
            prefix: 32,
            own_mac: None,
            gateway: None,
            hostname: "test-host".into(),
            mdns_wait: Duration::ZERO,
        };
        let progress = AtomicUsize::new(0);
        let found = run(&target, |_| { progress.fetch_add(1, Ordering::SeqCst); }, |_| {}).await.unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].is_self);
        assert!(found[0].names.contains("test-host"));
        assert!(progress.load(Ordering::SeqCst) >= 2);
    }

    #[tokio::test]
    async fn refuses_public_ranges() {
        let target = Target {
            ip: "8.8.8.8".parse().unwrap(),
            prefix: 24,
            own_mac: None,
            gateway: None,
            hostname: String::new(),
            mdns_wait: Duration::ZERO,
        };
        assert!(run(&target, |_| {}, |_| {}).await.is_err());
    }
}
