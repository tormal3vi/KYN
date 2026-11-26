//! Bonjour / mDNS listening: many devices announce themselves on the local
//! network ("I'm Living Room TV, I accept AirPlay, model AppleTV11,1").
//! We ask for a list of common service types and collect the answers for a
//! few seconds. Read-only: we never connect to the services.

use std::collections::{BTreeSet, HashMap};
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};

const SERVICE_TYPES: &[&str] = &[
    "_airplay._tcp", "_raop._tcp", "_companion-link._tcp", "_apple-mobdev2._tcp",
    "_googlecast._tcp", "_androidtvremote2._tcp", "_amzn-wplay._tcp", "_spotify-connect._tcp",
    "_sonos._tcp", "_ipp._tcp", "_printer._tcp", "_pdl-datastream._tcp", "_hap._tcp",
    "_hue._tcp", "_matter._tcp", "_esphomelib._tcp", "_arduino._tcp", "_smb._tcp",
    "_afpovertcp._tcp", "_ssh._tcp", "_workstation._tcp", "_http._tcp",
];

/// TXT keys that carry a model name, depending on the service.
const MODEL_KEYS: &[&str] = &["model", "md", "am", "rpMd", "ty", "product", "usb_MDL"];

#[derive(Default, Debug, Clone)]
pub struct Info {
    pub names: BTreeSet<String>,
    pub services: BTreeSet<String>,
    pub model: Option<String>,
}

/// Listen for `wait`, return what each IPv4 address announced.
/// Blocking: call it from a background thread.
pub fn browse(wait: Duration) -> HashMap<Ipv4Addr, Info> {
    let mut found: HashMap<Ipv4Addr, Info> = HashMap::new();
    let Ok(daemon) = ServiceDaemon::new() else { return found };
    let receivers: Vec<_> = SERVICE_TYPES
        .iter()
        .filter_map(|ty| daemon.browse(&format!("{ty}.local.")).ok().map(|rx| (*ty, rx)))
        .collect();

    let deadline = Instant::now() + wait;
    while Instant::now() < deadline {
        let mut idle = true;
        for (ty, rx) in &receivers {
            while let Ok(event) = rx.try_recv() {
                idle = false;
                if let ServiceEvent::ServiceResolved(svc) = event {
                    let instance = svc
                        .get_fullname()
                        .strip_suffix(&format!(".{ty}.local."))
                        .unwrap_or("")
                        .replace("\\032", " ")
                        .replace('\\', "");
                    let host = svc.get_hostname().trim_end_matches('.').to_string();
                    let model = MODEL_KEYS
                        .iter()
                        .find_map(|k| svc.get_property_val_str(k))
                        .filter(|m| !m.is_empty())
                        .map(str::to_string);
                    for ip in svc.get_addresses_v4() {
                        let info = found.entry(ip).or_default();
                        info.services.insert((*ty).to_string());
                        if !instance.is_empty() { info.names.insert(instance.clone()); }
                        if !host.is_empty() { info.names.insert(host.clone()); }
                        if info.model.is_none() { info.model = model.clone(); }
                    }
                }
            }
        }
        if idle {
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    let _ = daemon.shutdown();
    found
}
