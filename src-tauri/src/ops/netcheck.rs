//! "Is the network I'm on honest with me?" Checks that only look at this
//! computer's own traffic, so they're fine on any network (café, hotel, work):
//!
//!   vpn       is the internet going through a VPN tunnel?
//!   captive   is a login page ("captive portal") in the way?
//!   dns       do name lookups give the right answers? Three names whose
//!             addresses never change are looked up through the network's DNS;
//!             a made-up name must not exist.
//!   tls       is anyone reading your encrypted (HTTPS) traffic? Three
//!             well-known sites are opened twice: once trusting what this
//!             computer trusts, once trusting only Mozilla's public list of
//!             certificate authorities. Interception shows up as a difference.
//!
//! Nothing here scans or touches any other device.

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetInfo {
    pub interface: Option<String>,
    pub kind: Option<String>,
    pub vpn: Option<bool>,
    pub gateway: Option<String>,
    pub dns_servers: Vec<String>,
}

/// Interface names VPN apps use (macOS / Linux; Windows uses its type).
pub fn looks_like_vpn(name: &str, friendly: Option<&str>) -> bool {
    let n = name.to_lowercase();
    let f = friendly.unwrap_or("").to_lowercase();
    ["utun", "ipsec", "ppp", "tun", "tap", "wg", "tailscale", "zt"].iter().any(|p| n.starts_with(p))
        || ["vpn", "wireguard", "openvpn", "nordlynx", "tailscale", "tap-windows", "wintun"].iter().any(|w| f.contains(w))
}

pub fn net_info() -> NetInfo {
    match netdev::get_default_interface() {
        Ok(i) => {
            let vpn = looks_like_vpn(&i.name, i.friendly_name.as_deref())
                || matches!(i.if_type, netdev::interface::types::InterfaceType::Tunnel | netdev::interface::types::InterfaceType::Ppp);
            let kind = match i.if_type {
                netdev::interface::types::InterfaceType::Wireless80211 => Some("Wi-Fi".to_string()),
                netdev::interface::types::InterfaceType::Ethernet => Some("Ethernet".to_string()),
                _ if vpn => Some("VPN tunnel".to_string()),
                _ => None,
            };
            NetInfo {
                interface: Some(i.friendly_name.clone().filter(|f| !f.is_empty()).map_or(i.name.clone(), |f| format!("{f} ({})", i.name))),
                kind,
                vpn: Some(vpn),
                gateway: i.gateway.as_ref().and_then(|g| g.ipv4.first().map(|a| a.to_string())),
                dns_servers: i.dns_servers.iter().map(|a| a.to_string()).collect(),
            }
        }
        Err(_) => NetInfo { interface: None, kind: None, vpn: None, gateway: None, dns_servers: Vec::new() },
    }
}

fn ensure_crypto() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

// ── captive portal ─────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Captive {
    /// "open" (straight to the internet), "portal" (a login page answered
    /// instead), "offline" (no answer at all)
    pub state: &'static str,
    pub detail: Option<String>,
}

pub fn read_captive(status: u16, body: &str) -> &'static str {
    if status == 200 && body.contains("Success") { "open" } else { "portal" }
}

pub async fn captive() -> Captive {
    ensure_crypto();
    let client = match reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(6)).build() {
        Ok(c) => c,
        Err(e) => return Captive { state: "offline", detail: Some(e.to_string()) },
    };
    match client.get("http://captive.apple.com/hotspot-detect.html").send().await {
        Ok(r) => {
            let status = r.status().as_u16();
            let location = r.headers().get("location").and_then(|v| v.to_str().ok()).map(str::to_string);
            let body = r.text().await.unwrap_or_default();
            Captive { state: read_captive(status, &body), detail: location }
        }
        Err(e) => Captive { state: "offline", detail: Some(e.to_string()) },
    }
}

// ── DNS honesty ────────────────────────────────────────────────────────────

/// Names whose addresses never change (they are the public DNS services
/// themselves), with every address they may have.
pub const FIXED_NAMES: &[(&str, &[&str])] = &[
    ("one.one.one.one", &["1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"]),
    ("dns.google", &["8.8.8.8", "8.8.4.4", "2001:4860:4860::8888", "2001:4860:4860::8844"]),
    ("dns.quad9.net", &["9.9.9.9", "149.112.112.112", "2620:fe::fe", "2620:fe::9"]),
];

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DnsCheck {
    /// names that got an answer
    pub answered: usize,
    /// of those, how many were right
    pub honest: usize,
    /// "name → wrong address" for the ones that weren't
    pub wrong: Vec<String>,
    /// a made-up name got an address (it shouldn't exist)
    pub made_up_answered: Option<String>,
}

/// Compare what the network answered with the known addresses.
pub fn judge_dns(answers: &[(&str, Option<Vec<IpAddr>>)], made_up: Option<Vec<IpAddr>>) -> DnsCheck {
    let mut c = DnsCheck::default();
    for (name, got) in answers {
        let Some(got) = got else { continue };
        if got.is_empty() {
            continue;
        }
        c.answered += 1;
        let allowed: HashSet<IpAddr> = FIXED_NAMES.iter().find(|(n, _)| n == name).map(|(_, a)| a.iter().filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
        let bad: Vec<&IpAddr> = got.iter().filter(|a| !allowed.contains(a)).collect();
        if bad.is_empty() {
            c.honest += 1;
        } else {
            c.wrong.push(format!("{name} → {}", bad[0]));
        }
    }
    c.made_up_answered = made_up.and_then(|v| v.first().map(|a| a.to_string()));
    c
}

async fn resolve(name: &str) -> Option<Vec<IpAddr>> {
    let found = tokio::time::timeout(Duration::from_secs(4), tokio::net::lookup_host((name, 443))).await.ok()?.ok()?;
    let mut ips: Vec<IpAddr> = found.map(|a| a.ip()).collect();
    ips.sort();
    ips.dedup();
    Some(ips)
}

pub async fn dns() -> DnsCheck {
    let mut answers = Vec::new();
    for (name, _) in FIXED_NAMES {
        answers.push((*name, resolve(name).await));
    }
    // a random .com name nobody has registered
    let made_up = format!("kyn-check-{:016x}.com", rand_u64());
    judge_dns(&answers, resolve(&made_up).await)
}

fn rand_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish()
}

// ── HTTPS interception ─────────────────────────────────────────────────────

pub const TLS_SITES: &[&str] = &["github.com", "www.apple.com", "www.wikipedia.org"];

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TlsProbe {
    pub host: String,
    /// trusting what this computer trusts: "ok", "cert" (certificate refused) or "error"
    pub system: &'static str,
    /// trusting only Mozilla's public list: same values
    pub public: &'static str,
    /// who signed the certificate, when it was refused
    pub detail: Option<String>,
}

/// "cert" if the failure was the certificate, "error" for anything else.
pub fn failure_kind(chain: &str) -> &'static str {
    let c = chain.to_lowercase();
    if c.contains("certificate") || c.contains("unknownissuer") || c.contains("badsignature") || c.contains("notvalidforname") {
        "cert"
    } else {
        "error"
    }
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(" / ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}

fn public_roots_client() -> Result<reqwest::Client, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    reqwest::Client::builder()
        .tls_backend_preconfigured(cfg)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}

async fn probe(client: &reqwest::Client, host: &str) -> (&'static str, Option<String>) {
    match client.head(format!("https://{host}/")).send().await {
        Ok(_) => ("ok", None),
        Err(e) => {
            let chain = error_chain(&e);
            (failure_kind(&chain), Some(chain))
        }
    }
}

pub async fn tls() -> Result<Vec<TlsProbe>, String> {
    ensure_crypto();
    let system = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let public = public_roots_client()?;
    let mut out = Vec::new();
    for host in TLS_SITES {
        let ((sys, _), (publ, detail)) = tokio::join!(probe(&system, host), probe(&public, host));
        out.push(TlsProbe { host: host.to_string(), system: sys, public: publ, detail: detail.filter(|_| publ == "cert") });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vpn_names() {
        assert!(looks_like_vpn("utun4", None));
        assert!(looks_like_vpn("wg0", None));
        assert!(looks_like_vpn("{GUID}", Some("NordLynx")));
        assert!(!looks_like_vpn("en0", Some("Wi-Fi")));
        assert!(!looks_like_vpn("eth0", None));
    }

    #[test]
    fn captive_answers() {
        assert_eq!(read_captive(200, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"), "open");
        assert_eq!(read_captive(302, ""), "portal");
        assert_eq!(read_captive(200, "<html>Hotel Wi-Fi login</html>"), "portal");
    }

    #[test]
    fn dns_judging() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let honest = judge_dns(&[("one.one.one.one", Some(vec![ip("1.1.1.1"), ip("1.0.0.1")])), ("dns.google", Some(vec![ip("8.8.8.8")])), ("dns.quad9.net", None)], None);
        assert_eq!((honest.answered, honest.honest), (2, 2));
        assert!(honest.wrong.is_empty() && honest.made_up_answered.is_none());
        let hijacked = judge_dns(&[("dns.google", Some(vec![ip("10.0.0.1")]))], Some(vec![ip("198.51.100.7")]));
        assert_eq!(hijacked.wrong, vec!["dns.google → 10.0.0.1".to_string()]);
        assert_eq!(hijacked.made_up_answered.as_deref(), Some("198.51.100.7"));
    }

    #[test]
    fn tls_failures() {
        assert_eq!(failure_kind("error sending request / invalid peer certificate: UnknownIssuer"), "cert");
        assert_eq!(failure_kind("error sending request / connection refused"), "error");
    }

    /// Real probes. In this cloud test machine HTTPS goes through an inspecting
    /// proxy whose certificate authority is installed locally, which is exactly
    /// what the check should notice: system "ok", public list "cert".
    #[tokio::test]
    async fn real_tls_probes() {
        let Ok(list) = tls().await else { return };
        for p in &list {
            eprintln!("{} system={} public={}", p.host, p.system, p.public);
        }
    }
}
