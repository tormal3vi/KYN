//! "Is anything on this computer talking to known-bad servers?"
//!
//! Free, public block lists that security teams use, downloaded at most every
//! 12 hours into the app's data folder:
//!   abuse.ch Feodo Tracker   control servers of banking-trojan / botnet malware (CC0)
//!   Spamhaus DROP            networks hijacked or run by criminals
//!   Emerging Threats         machines known to be compromised and attacking others
//! The addresses your apps talk to are matched on this computer; nothing about
//! them is sent anywhere. IPv4 only (that's what the lists cover).

use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Format {
    /// one address per line, # comments
    Lines,
    /// Spamhaus: one JSON object per line, {"cidr":"1.2.3.0/24",...}
    SpamhausJson,
}

pub struct Source {
    pub name: &'static str,
    pub what: &'static str,
    pub url: &'static str,
    pub file: &'static str,
    pub format: Format,
}

pub const SOURCES: &[Source] = &[
    Source {
        name: "abuse.ch Feodo Tracker",
        what: "a control server for botnet / banking-trojan malware",
        url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt",
        file: "feodo.txt",
        format: Format::Lines,
    },
    Source {
        name: "Spamhaus DROP",
        what: "a network hijacked or run by criminals",
        url: "https://www.spamhaus.org/drop/drop_v4.json",
        file: "spamhaus-drop.json",
        format: Format::SpamhausJson,
    },
    Source {
        name: "Emerging Threats",
        what: "a machine known to be compromised and attacking others",
        url: "https://rules.emergingthreats.net/blockrules/compromised-ips.txt",
        file: "et-compromised.txt",
        format: Format::Lines,
    },
];

const MAX_AGE: Duration = Duration::from_secs(12 * 3600);

/// Addresses and address ranges from one list.
#[derive(Default, Debug)]
pub struct Matcher {
    ips: HashSet<u32>,
    nets: Vec<(u32, u32)>, // (network, mask)
}

impl Matcher {
    pub fn len(&self) -> usize {
        self.ips.len() + self.nets.len()
    }

    fn add(&mut self, entry: &str) {
        let entry = entry.trim();
        if let Some((net, prefix)) = entry.split_once('/') {
            if let (Ok(net), Ok(prefix)) = (net.parse::<Ipv4Addr>(), prefix.parse::<u32>()) {
                if prefix <= 32 {
                    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
                    self.nets.push((u32::from(net) & mask, mask));
                }
            }
        } else if let Ok(ip) = entry.parse::<Ipv4Addr>() {
            self.ips.insert(u32::from(ip));
        }
    }

    pub fn contains(&self, ip: Ipv4Addr) -> bool {
        let n = u32::from(ip);
        self.ips.contains(&n) || self.nets.iter().any(|(net, mask)| n & mask == *net)
    }
}

pub fn parse(text: &str, format: Format) -> Matcher {
    let mut m = Matcher::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        match format {
            Format::Lines => m.add(line.split_whitespace().next().unwrap_or("")),
            Format::SpamhausJson => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(cidr) = v["cidr"].as_str() {
                        m.add(cidr);
                    }
                }
            }
        }
    }
    m
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListInfo {
    pub name: &'static str,
    pub entries: usize,
    /// milliseconds since 1970 of the copy in use
    pub updated_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub ip: String,
    pub list: &'static str,
    pub what: &'static str,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub lists: Vec<ListInfo>,
    pub checked: usize,
    pub hits: Vec<Hit>,
}

fn modified_ms(path: &Path) -> Option<(SystemTime, u64)> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    Some((t, t.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis() as u64))
}

/// A download error in a few plain words.
fn short(e: &reqwest::Error) -> String {
    if let Some(status) = e.status() {
        format!("the server answered {status}")
    } else if e.is_timeout() {
        "it took too long".into()
    } else {
        "couldn't reach it".into()
    }
}

async fn refresh(client: &reqwest::Client, src: &Source, path: &Path) -> Result<(), String> {
    let text = client.get(src.url).send().await.map_err(|e| short(&e))?
        .error_for_status().map_err(|e| short(&e))?
        .text().await.map_err(|e| short(&e))?;
    if parse(&text, src.format).len() == 0 {
        return Err("the list came back empty".into());
    }
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Bring the lists up to date (when older than 12 h) and match `ips` against them.
pub async fn check(dir: &PathBuf, ips: &[String]) -> Report {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let _ = std::fs::create_dir_all(dir);
    let client = reqwest::Client::builder().user_agent("KYN (network tool)").timeout(Duration::from_secs(30)).build().ok();
    let addrs: Vec<(String, Ipv4Addr)> = ips.iter().filter_map(|s| Some((s.clone(), s.parse().ok()?))).collect();
    let mut lists = Vec::new();
    let mut hits = Vec::new();
    for src in SOURCES {
        let path = dir.join(src.file);
        let stale = modified_ms(&path).map_or(true, |(t, _)| t.elapsed().map_or(true, |age| age > MAX_AGE));
        let mut error = None;
        if stale {
            match &client {
                Some(c) => error = refresh(c, src, &path).await.err(),
                None => error = Some("no network client".into()),
            }
        }
        let matcher = std::fs::read_to_string(&path).map(|t| parse(&t, src.format)).unwrap_or_default();
        for (text, ip) in &addrs {
            if matcher.contains(*ip) {
                hits.push(Hit { ip: text.clone(), list: src.name, what: src.what });
            }
        }
        lists.push(ListInfo { name: src.name, entries: matcher.len(), updated_at: modified_ms(&path).map(|(_, ms)| ms), error });
    }
    Report { lists, checked: addrs.len(), hits }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_lists() {
        let m = parse("# Feodo Tracker\n# comment\n192.0.2.10\n198.51.100.7 # note\n\nnot-an-ip\n", Format::Lines);
        assert_eq!(m.len(), 2);
        assert!(m.contains("192.0.2.10".parse().unwrap()));
        assert!(!m.contains("192.0.2.11".parse().unwrap()));
    }

    #[test]
    fn spamhaus_ranges() {
        let t = "{\"cidr\":\"203.0.113.0/24\",\"sblid\":\"SBL1\",\"rir\":\"apnic\"}\n{\"type\":\"metadata\",\"timestamp\":1}\n";
        let m = parse(t, Format::SpamhausJson);
        assert_eq!(m.len(), 1);
        assert!(m.contains("203.0.113.99".parse().unwrap()));
        assert!(!m.contains("203.0.114.1".parse().unwrap()));
    }

    /// Uses cached copies written here, so no download is attempted.
    #[tokio::test]
    async fn matches_against_cached_lists() {
        let dir = std::env::temp_dir().join(format!("kyn-threats-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("feodo.txt"), "192.0.2.10\n").unwrap();
        std::fs::write(dir.join("spamhaus-drop.json"), "{\"cidr\":\"203.0.113.0/24\"}\n").unwrap();
        std::fs::write(dir.join("et-compromised.txt"), "198.51.100.7\n").unwrap();
        let r = check(&dir, &["192.0.2.10".into(), "203.0.113.5".into(), "8.8.8.8".into(), "2a00::1".into()]).await;
        assert_eq!(r.checked, 3);
        assert_eq!(r.hits.len(), 2);
        assert_eq!(r.hits[0].list, "abuse.ch Feodo Tracker");
        assert_eq!(r.hits[1].ip, "203.0.113.5");
        assert!(r.lists.iter().all(|l| l.error.is_none() && l.entries == 1));
        let _ = std::fs::remove_dir_all(dir);
    }
}
