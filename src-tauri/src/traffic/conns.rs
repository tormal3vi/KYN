//! "Which app on this computer is connected to where, and how much data?"
//!
//!   connections  macOS / Linux: `lsof -i` (your own apps; no admin needed)
//!                Windows: `netstat -ano` + `tasklist` for app names
//!   data used    macOS: `nettop` per app and per connection. Other systems
//!                don't offer this without admin rights, so it stays empty.
//!
//! Only this computer's own connections. Nothing here looks at other
//! devices' traffic or at the contents of any connection.

use std::collections::HashMap;

use serde::Serialize;

use crate::portaudit::local::{parse_tasklist, split_endpoint};

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Conn {
    pub app: String,
    pub pid: Option<u32>,
    /// "tcp" or "udp" (QUIC, used by browsers and many apps, is udp)
    pub proto: String,
    pub remote_ip: String,
    pub remote_port: u16,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppBytes {
    pub app: String,
    pub pid: u32,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

fn remote_of(name: &str) -> Option<(String, u16)> {
    let (_, remote) = name.split_once("->")?;
    let remote = remote.split_whitespace().next()?;
    split_endpoint(remote)
}

/// `lsof -F pcPnT`: p=pid, c=app, then per socket P=protocol, n=addresses,
/// T=extra info such as "ST=ESTABLISHED".
pub fn parse_lsof(text: &str) -> Vec<Conn> {
    struct Sock { proto: String, name: String, state: Option<String> }
    let mut out = Vec::new();
    let (mut pid, mut app) = (None::<u32>, String::new());
    let mut sock: Option<Sock> = None;
    let flush = |sock: &mut Option<Sock>, pid: Option<u32>, app: &str, out: &mut Vec<Conn>| {
        if let Some(s) = sock.take() {
            let connected = s.proto == "UDP" || s.state.as_deref() == Some("ESTABLISHED");
            if connected {
                if let Some((ip, port)) = remote_of(&s.name) {
                    out.push(Conn { app: app.to_string(), pid, proto: s.proto.to_lowercase(), remote_ip: ip, remote_port: port });
                }
            }
        }
    };
    for line in text.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => { flush(&mut sock, pid, &app, &mut out); pid = rest.parse().ok(); app.clear(); }
            "c" => app = rest.to_string(),
            "P" => { flush(&mut sock, pid, &app, &mut out); sock = Some(Sock { proto: rest.to_string(), name: String::new(), state: None }); }
            "n" => { if let Some(s) = sock.as_mut() { s.name = rest.to_string(); } }
            "T" => {
                if let (Some(s), Some(st)) = (sock.as_mut(), rest.strip_prefix("ST=")) {
                    s.state = Some(st.to_string());
                }
            }
            _ => {}
        }
    }
    flush(&mut sock, pid, &app, &mut out);
    out
}

/// Windows `netstat -ano`: "  TCP  192.168.1.20:52000  52.1.2.3:443  ESTABLISHED  1100"
pub fn parse_netstat(text: &str, names: &HashMap<u32, String>) -> Vec<Conn> {
    text.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 5 || cols[0] != "TCP" || cols[3] != "ESTABLISHED" {
                return None;
            }
            let (ip, port) = split_endpoint(cols[2])?;
            let pid: Option<u32> = cols[4].parse().ok();
            let app = pid.and_then(|p| names.get(&p).cloned()).unwrap_or_else(|| "unknown".into());
            Some(Conn { app, pid, proto: "tcp".into(), remote_ip: ip, remote_port: port })
        })
        .collect()
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnBytes {
    pub pid: u32,
    pub proto: String,
    pub remote_ip: String,
    pub remote_port: u16,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// per app (process): everything it sent and received since it started
    pub apps: Vec<AppBytes>,
    /// per open connection, when the system lists them
    pub conns: Vec<ConnBytes>,
}

/// nettop writes IPv4 as "1.2.3.4:443" and IPv6 as "2a00:1450::200e.443".
fn nettop_endpoint(s: &str) -> Option<(String, u16)> {
    let s = s.trim();
    if s.matches(':').count() > 1 {
        if let Some((addr, port)) = s.rsplit_once('.') {
            if let Ok(port) = port.parse() {
                let addr = addr.trim_start_matches('[').trim_end_matches(']');
                return Some((addr.split('%').next().unwrap_or(addr).to_string(), port));
            }
        }
    }
    split_endpoint(s)
}

/// macOS `nettop -L 1 -n -x -J bytes_in,bytes_out`, a CSV like
///   time,,bytes_in,bytes_out,
///   10:20:30.123456,Spotify.4567,123456,7890,
///   10:20:30.123456,tcp4 192.168.1.20:50001<->35.186.224.25:443,120000,7000,
/// (some versions leave out the time column). The name column is the one just
/// before bytes_in: an app as "name.pid", then each of its connections.
pub fn parse_nettop(text: &str) -> Usage {
    let mut usage = Usage::default();
    let mut lines = text.lines();
    let Some(header) = lines.by_ref().find(|l| l.contains("bytes_in")) else { return usage };
    let cols: Vec<&str> = header.split(',').collect();
    let (Some(bi), Some(bo)) = (cols.iter().position(|c| *c == "bytes_in"), cols.iter().position(|c| *c == "bytes_out")) else {
        return usage;
    };
    if bi == 0 {
        return usage;
    }
    let mut pid = None;
    for line in lines {
        let f: Vec<&str> = line.split(',').collect();
        let (Some(who), Some(i), Some(o)) = (f.get(bi - 1), f.get(bi), f.get(bo)) else { continue };
        let (Ok(bytes_in), Ok(bytes_out)) = (i.trim().parse::<u64>(), o.trim().parse::<u64>()) else { continue };
        if let Some((proto_local, remote)) = who.split_once("<->") {
            let (Some(owner), Some(proto)) = (pid, proto_local.split_whitespace().next()) else { continue };
            if let Some((remote_ip, remote_port)) = nettop_endpoint(remote) {
                let proto = proto.trim_end_matches(['4', '6']).to_lowercase();
                usage.conns.push(ConnBytes { pid: owner, proto, remote_ip, remote_port, bytes_in, bytes_out });
            }
        } else if let Some((app, p)) = who.rsplit_once('.') {
            pid = p.parse().ok();
            if let Some(p) = pid {
                usage.apps.push(AppBytes { app: app.to_string(), pid: p, bytes_in, bytes_out });
            }
        }
    }
    usage
}

async fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().await.ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn connections() -> Vec<Conn> {
    if cfg!(windows) {
        let names = run("tasklist", &["/FO", "CSV", "/NH"]).await.map(|t| parse_tasklist(&t)).unwrap_or_default();
        run("netstat", &["-ano"]).await.map(|t| parse_netstat(&t, &names)).unwrap_or_default()
    } else {
        let lsof = if cfg!(target_os = "macos") { "/usr/sbin/lsof" } else { "lsof" };
        run(lsof, &["+c", "0", "-nP", "-i", "-F", "pcPnT"]).await.map(|t| parse_lsof(&t)).unwrap_or_default()
    }
}

/// Data used per app and per connection, or None where the system doesn't
/// offer it without admin rights.
pub async fn usage() -> Option<Usage> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let text = run("/usr/bin/nettop", &["-L", "1", "-n", "-x", "-J", "bytes_in,bytes_out"]).await?;
    let usage = parse_nettop(&text);
    (!usage.apps.is_empty()).then_some(usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lsof_connections() {
        // shape taken from real `lsof +c 0 -nP -i -F pcPnT` output
        let t = "p96\ncenvironment-man\nPTCP\nn192.0.2.2:52978->160.79.104.10:443\nTST=ESTABLISHED\nTQR=0\nTQS=0\n\
                 PTCP\nn127.0.0.1:45937\nTST=LISTEN\nTQR=0\n\
                 p104\ncGoogle Chrome Helper\nPUDP\nn[2a00:1450:4001::5]:61000->[2a00:1450:4001:82b::200e]:443\n\
                 PTCP\nn192.168.1.20:50001->17.253.144.10:443\nTST=CLOSE_WAIT\n";
        let c = parse_lsof(t);
        assert_eq!(c.len(), 2, "{c:?}");
        assert_eq!(c[0], Conn { app: "environment-man".into(), pid: Some(96), proto: "tcp".into(), remote_ip: "160.79.104.10".into(), remote_port: 443 });
        assert_eq!(c[1].app, "Google Chrome Helper");
        assert_eq!(c[1].proto, "udp");
        assert_eq!(c[1].remote_ip, "2a00:1450:4001:82b::200e");
    }

    #[test]
    fn windows_connections() {
        let names = parse_tasklist("\"chrome.exe\",\"2200\",\"Console\",\"1\",\"100,000 K\"\r\n");
        let t = "  TCP    192.168.1.20:52000     142.250.1.1:443        ESTABLISHED     2200\r\n  \
                 TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900\r\n  \
                 TCP    [2a00::1]:52001        [2a00:1450::1]:443     ESTABLISHED     2200\r\n";
        let c = parse_netstat(t, &names);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].app, "chrome.exe");
        assert_eq!(c[1].remote_ip, "2a00:1450::1");
    }

    #[test]
    fn nettop_with_and_without_time_column() {
        let a = "time,,bytes_in,bytes_out,\n10:20:30.123456,Spotify.4567,123456,7890,\n10:20:30.123456,com.apple.WebKit.Networking.880,99,1,\n";
        let b = ",bytes_in,bytes_out,\nSpotify.4567,123456,7890,\n";
        let pa = parse_nettop(a).apps;
        assert_eq!(pa.len(), 2);
        assert_eq!(pa[0], AppBytes { app: "Spotify".into(), pid: 4567, bytes_in: 123456, bytes_out: 7890 });
        assert_eq!(pa[1].app, "com.apple.WebKit.Networking");
        assert_eq!(parse_nettop(b).apps, vec![AppBytes { app: "Spotify".into(), pid: 4567, bytes_in: 123456, bytes_out: 7890 }]);
        assert_eq!(parse_nettop("garbage"), Usage::default());
    }

    #[test]
    fn nettop_connections() {
        let t = "time,,bytes_in,bytes_out,\n\
                 10:20:30.1,Spotify.4567,130000,9000,\n\
                 10:20:30.1,tcp4 192.168.1.20:50001<->35.186.224.25:443,120000,7000,\n\
                 10:20:30.1,udp6 2a00:1:2::5.61000<->2a00:1450:4001:82b::200e.443,10000,2000,\n\
                 10:20:30.1,udp4 *:5353<->*:*,0,0,\n\
                 10:20:30.1,apsd.120,5,6,\n\
                 10:20:30.1,tcp4 192.168.1.20:50002<->17.57.146.20:5223,5,6,\n";
        let u = parse_nettop(t);
        assert_eq!(u.apps.len(), 2);
        assert_eq!(u.conns.len(), 3, "{:?}", u.conns);
        assert_eq!(u.conns[0], ConnBytes { pid: 4567, proto: "tcp".into(), remote_ip: "35.186.224.25".into(), remote_port: 443, bytes_in: 120000, bytes_out: 7000 });
        assert_eq!(u.conns[1].remote_ip, "2a00:1450:4001:82b::200e");
        assert_eq!(u.conns[1].proto, "udp");
        assert_eq!(u.conns[2].pid, 120);
    }

    /// Real connections of this machine's own processes (whatever is running).
    #[tokio::test]
    async fn reads_this_machines_connections() {
        let list = connections().await;
        for c in &list {
            assert!(!c.app.is_empty() && !c.remote_ip.is_empty());
        }
    }
}
