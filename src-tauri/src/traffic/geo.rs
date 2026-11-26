//! Where is an IP address, roughly, and who owns it?
//!
//! Two free databases, downloaded once into the app's data folder (about
//! 37 MB) from the npm registry, checked against npm's published SHA-512
//! fingerprint before use:
//!   GeoLite2 City (MaxMind, CC BY-SA 4.0): city / region / country + point
//!   ASN (RouteViews + DB-IP, CC BY 4.0):    the organisation that owns it
//! Lookups happen on this computer; nothing about your connections is sent
//! anywhere.
//!
//! Honesty rules: an IP address is not a street address. The database knows
//! a city at best, often only a country (big cloud and CDN providers are
//! "somewhere in the US"). `level` and `radius_km` say how much it knows, and
//! the map never zooms in further than that. GeoLite2's licence forbids using
//! it to locate a specific household or person, and KYN doesn't.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use maxminddb::Reader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};

pub const CITY_PACKAGE: &str = "@ip-location-db/geolite2-city-mmdb";
pub const ASN_PACKAGE: &str = "@ip-location-db/asn-mmdb";
const CITY_FILES: &[&str] = &["geolite2-city-ipv4.mmdb", "geolite2-city-ipv6.mmdb", "GEOLITE2_LICENSE", "GEOLITE2_EULA"];
const ASN_FILES: &[&str] = &["asn.mmdb", "DBIP-LICENSE", "ROUTEVIEWS-LICENSE", "NRO_LICENSE"];

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub city_version: String,
    pub asn_version: String,
    pub downloaded_at: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeoInfo {
    pub ip: String,
    /// "local" (your own network), "public", or "invalid"
    pub scope: &'static str,
    /// how much the database knows: "city", "region", "country" or "unknown"
    pub level: &'static str,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// rough uncertainty for city / region level; country level is shown as
    /// the whole country instead
    pub radius_km: Option<f64>,
    pub city: Option<String>,
    pub region: Option<String>,
    /// two-letter country code, e.g. "DE"
    pub country: Option<String>,
    pub org: Option<String>,
    pub asn: Option<u32>,
    pub host: Option<String>,
}

#[derive(Deserialize)]
struct CityRecord {
    city: Option<String>,
    country_code: Option<String>,
    // stored as 32-bit floats in this database
    latitude: Option<f32>,
    longitude: Option<f32>,
    state1: Option<String>,
}

#[derive(Deserialize)]
struct AsnRecord {
    autonomous_system_number: Option<u32>,
    autonomous_system_organization: Option<String>,
}

pub struct Readers {
    city4: Reader<Vec<u8>>,
    city6: Reader<Vec<u8>>,
    asn: Reader<Vec<u8>>,
}

impl Readers {
    pub fn open(dir: &Path) -> Result<Readers, String> {
        let open = |f: &str| Reader::open_readfile(dir.join(f)).map_err(|e| format!("{f}: {e}"));
        Ok(Readers { city4: open("geolite2-city-ipv4.mmdb")?, city6: open("geolite2-city-ipv6.mmdb")?, asn: open("asn.mmdb")? })
    }
}

/// Addresses that belong to your own network (or this computer).
pub fn is_local(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_multicast() || v.is_broadcast(),
        IpAddr::V6(v) => {
            let s = v.segments()[0];
            v.is_loopback() || v.is_unspecified() || v.is_multicast() || (s & 0xfe00) == 0xfc00 || (s & 0xffc0) == 0xfe80
        }
    }
}

fn nonempty(s: Option<String>) -> Option<String> {
    s.filter(|x| !x.trim().is_empty())
}

/// How much the database knows, and how far the map may zoom in.
pub fn confidence(city: &Option<String>, region: &Option<String>, country: &Option<String>, has_point: bool) -> (&'static str, Option<f64>) {
    if !has_point && country.is_none() {
        return ("unknown", None);
    }
    if city.is_some() && has_point {
        ("city", Some(50.0))
    } else if region.is_some() && has_point {
        ("region", Some(200.0))
    } else if country.is_some() {
        ("country", None)
    } else {
        ("unknown", None)
    }
}

/// Just "is it your own network or the internet", for when the database
/// isn't downloaded.
pub fn lookup_scope_only(ip_text: &str) -> GeoInfo {
    let scope = match ip_text.parse::<IpAddr>() {
        Ok(ip) if is_local(&ip) => "local",
        Ok(_) => "public",
        Err(_) => "invalid",
    };
    GeoInfo { ip: ip_text.to_string(), scope, level: "unknown", ..Default::default() }
}

pub fn lookup(readers: &Readers, ip_text: &str) -> GeoInfo {
    let mut info = lookup_scope_only(ip_text);
    if info.scope != "public" {
        return info;
    }
    let Ok(ip) = ip_text.parse::<IpAddr>() else { return info };
    let city_db = if ip.is_ipv4() { &readers.city4 } else { &readers.city6 };
    if let Ok(Some(rec)) = city_db.lookup(ip).and_then(|r| r.decode::<CityRecord>()) {
        info.city = nonempty(rec.city);
        info.region = nonempty(rec.state1);
        info.country = nonempty(rec.country_code);
        // 4 decimals (~10 m) is already far finer than what the data means
        let round = |v: f32| (f64::from(v) * 1e4).round() / 1e4;
        info.lat = rec.latitude.map(round);
        info.lon = rec.longitude.map(round);
    }
    let (level, radius) = confidence(&info.city, &info.region, &info.country, info.lat.is_some() && info.lon.is_some());
    info.level = level;
    info.radius_km = radius;
    if let Ok(Some(rec)) = readers.asn.lookup(ip).and_then(|r| r.decode::<AsnRecord>()) {
        info.asn = rec.autonomous_system_number;
        info.org = nonempty(rec.autonomous_system_organization);
    }
    info
}

/// Server name from your normal DNS (e.g. "lhr25s34-in-f14.1e100.net"), cached.
pub async fn reverse_dns(cache: &Mutex<HashMap<String, Option<String>>>, ip: &str) -> Option<String> {
    if let Some(hit) = cache.lock().ok()?.get(ip) {
        return hit.clone();
    }
    let addr: IpAddr = ip.parse().ok()?;
    let job = tokio::task::spawn_blocking(move || dns_lookup::lookup_addr(&addr).ok());
    let name = tokio::time::timeout(Duration::from_millis(1200), job).await.ok().and_then(|r| r.ok()).flatten();
    let name = name.filter(|n| n != ip);
    if let Ok(mut c) = cache.lock() {
        c.insert(ip.to_string(), name.clone());
    }
    name
}

// ── downloading ─────────────────────────────────────────────────────────────

/// npm's "sha512-<base64>" integrity string vs the bytes we downloaded.
pub fn integrity_ok(integrity: &str, bytes: &[u8]) -> bool {
    let Some(expected) = integrity.strip_prefix("sha512-") else { return false };
    let actual = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes));
    actual == expected
}

/// Pull the named files out of an npm package tarball (.tgz) into `dir`.
pub fn extract(tgz: &[u8], wanted: &[&str], dir: &Path) -> Result<usize, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(tgz));
    let mut n = 0;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let Some(name) = path.file_name().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if !wanted.contains(&name.as_str()) {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("{name}.part"));
        std::fs::File::create(&tmp).and_then(|mut f| f.write_all(&buf)).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

pub struct Download {
    pub version: String,
    pub bytes: Vec<u8>,
}

/// Fetch the latest version of an npm package, reporting (done, total) bytes.
pub async fn fetch_package(package: &str, on_progress: impl Fn(u64, u64)) -> Result<Download, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("KYN (network tool)")
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let meta_url = format!("https://registry.npmjs.org/{}/latest", package.replace('/', "%2F"));
    let meta: serde_json::Value = serde_json::from_str(
        &client.get(&meta_url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?
            .text().await.map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let version = meta["version"].as_str().unwrap_or("?").to_string();
    let tarball = meta["dist"]["tarball"].as_str().ok_or("registry answer has no tarball")?.to_string();
    let integrity = meta["dist"]["integrity"].as_str().ok_or("registry answer has no fingerprint")?.to_string();
    if !tarball.starts_with("https://registry.npmjs.org/") {
        return Err("unexpected download location".into());
    }
    let mut resp = client.get(&tarball).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut bytes = Vec::with_capacity(total as usize);
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        bytes.extend_from_slice(&chunk);
        on_progress(bytes.len() as u64, total);
    }
    if !integrity_ok(&integrity, &bytes) {
        return Err(format!("{package}: download doesn't match npm's fingerprint; not using it"));
    }
    Ok(Download { version, bytes })
}

pub fn city_files() -> &'static [&'static str] { CITY_FILES }
pub fn asn_files() -> &'static [&'static str] { ASN_FILES }

pub fn read_meta(dir: &Path) -> Option<Meta> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("meta.json")).ok()?).ok()
}

pub fn write_meta(dir: &Path, meta: &Meta) -> Result<(), String> {
    std::fs::write(dir.join("meta.json"), serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn ready(dir: &Path) -> bool {
    ["geolite2-city-ipv4.mmdb", "geolite2-city-ipv6.mmdb", "asn.mmdb"].iter().all(|f| dir.join(f).exists())
}

/// Readers are opened once and shared.
#[derive(Default)]
pub struct Cache {
    pub readers: Mutex<Option<Arc<Readers>>>,
    pub dns: Arc<Mutex<HashMap<String, Option<String>>>>,
}

impl Cache {
    pub fn readers(&self, dir: &PathBuf) -> Result<Arc<Readers>, String> {
        let mut slot = self.readers.lock().map_err(|e| e.to_string())?;
        if let Some(r) = slot.as_ref() {
            return Ok(r.clone());
        }
        let r = Arc::new(Readers::open(dir)?);
        *slot = Some(r.clone());
        Ok(r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses() {
        for ip in ["192.168.1.1", "10.0.0.2", "127.0.0.1", "169.254.1.1", "fe80::1", "fd00::5", "::1"] {
            assert!(is_local(&ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "2a00:1450:4001::5", "17.253.144.10"] {
            assert!(!is_local(&ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn confidence_levels() {
        let s = |x: &str| Some(x.to_string());
        assert_eq!(confidence(&s("Frankfurt"), &s("Hesse"), &s("DE"), true), ("city", Some(50.0)));
        assert_eq!(confidence(&None, &s("Hesse"), &s("DE"), true), ("region", Some(200.0)));
        // the "somewhere in the US" centre point: country level, never a city
        assert_eq!(confidence(&None, &None, &s("US"), true), ("country", None));
        assert_eq!(confidence(&None, &None, &None, false), ("unknown", None));
    }

    #[test]
    fn fingerprint_check() {
        // sha512 of the empty string, as npm would write it
        let empty = "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==";
        assert!(integrity_ok(empty, b""));
        assert!(!integrity_ok(empty, b"x"));
        assert!(!integrity_ok("sha1-abc", b""));
    }

    #[test]
    fn extracts_only_wanted_files() {
        let mut tar_bytes = Vec::new();
        {
            let mut b = tar::Builder::new(&mut tar_bytes);
            for (name, data) in [("package/asn.mmdb", &b"MMDB"[..]), ("package/README.md", &b"readme"[..])] {
                let mut h = tar::Header::new_gnu();
                h.set_size(data.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                b.append_data(&mut h, name, data).unwrap();
            }
            b.finish().unwrap();
        }
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&tar_bytes).unwrap();
        let tgz = gz.finish().unwrap();
        let dir = std::env::temp_dir().join(format!("kyn-geo-test-{}", std::process::id()));
        assert_eq!(extract(&tgz, &["asn.mmdb"], &dir).unwrap(), 1);
        assert_eq!(std::fs::read(dir.join("asn.mmdb")).unwrap(), b"MMDB");
        assert!(!dir.join("README.md").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// With the real databases (set KYN_TEST_GEO_DIR to a folder holding them).
    #[test]
    fn real_lookups() {
        let Ok(dir) = std::env::var("KYN_TEST_GEO_DIR") else { return };
        let r = Readers::open(Path::new(&dir)).unwrap();
        let google = lookup(&r, "8.8.8.8");
        assert_eq!(google.scope, "public");
        assert_eq!(google.org.as_deref(), Some("Google LLC"));
        // Google's public DNS is everywhere at once: only "somewhere in the US"
        assert_eq!(google.level, "country");
        assert_eq!(google.country.as_deref(), Some("US"));
        assert_eq!(google.radius_km, None);
        assert_eq!(lookup(&r, "192.168.1.1").scope, "local");
        let ru = lookup(&r, "2.16.20.10");
        assert_eq!(ru.level, "city");
        assert_eq!(ru.country.as_deref(), Some("RU"));
        assert!(ru.city.is_some() && ru.radius_km == Some(50.0));
        assert!((ru.lat.unwrap() - 56.33).abs() < 0.1);
        let v6 = lookup(&r, "2a00:1450:4001:82b::200e");
        assert_eq!(v6.org.as_deref(), Some("Google LLC"));
        assert!(v6.country.is_some());
    }

    /// The real download from the npm registry (37 MB): `cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn downloads_and_verifies() {
        let dir = std::env::temp_dir().join(format!("kyn-geo-dl-{}", std::process::id()));
        for (package, files) in [(ASN_PACKAGE, asn_files()), (CITY_PACKAGE, city_files())] {
            let got = fetch_package(package, |_, _| {}).await.unwrap();
            assert!(!got.version.is_empty());
            assert_eq!(extract(&got.bytes, files, &dir).unwrap(), files.len(), "{package}");
        }
        assert!(ready(&dir));
        let r = Readers::open(&dir).unwrap();
        assert_eq!(lookup(&r, "1.1.1.1").org.as_deref(), Some("Cloudflare, Inc."));
        let _ = std::fs::remove_dir_all(dir);
    }

}

