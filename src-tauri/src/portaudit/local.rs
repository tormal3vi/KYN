//! "Which app on this computer is listening on which port?"
//!
//! Asks the operating system for its list of listening TCP sockets:
//!   macOS / Linux: `lsof -nP -iTCP -sTCP:LISTEN` (no admin rights needed; it
//!                  shows your own apps, system services may be hidden)
//!   Windows:       `netstat -ano` + `tasklist` for the app names
//! A socket bound to 127.0.0.1 / ::1 is "local only": nothing else on your
//! network can reach it. Anything else (0.0.0.0, *, your LAN address) is
//! reachable from your network, unless the firewall blocks it.

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub port: u16,
    /// Where it listens: "*", "0.0.0.0", "127.0.0.1", "::1", "192.168.1.20"...
    pub address: String,
    /// Reachable from other devices (not bound to loopback only).
    pub exposed: bool,
    pub process: Option<String>,
    pub pid: Option<u32>,
}

fn is_loopback(addr: &str) -> bool {
    let a = addr.trim_start_matches('[').trim_end_matches(']');
    a.starts_with("127.") || a == "::1" || a == "localhost" || a.starts_with("::ffff:127.")
}

/// Split "127.0.0.1:631", "*:7000", "[::1]:631", "[fe80::1%lo0]:5353" into (address, port).
pub(crate) fn split_endpoint(s: &str) -> Option<(String, u16)> {
    let (addr, port) = s.rsplit_once(':')?;
    let port = port.trim().parse().ok()?;
    let addr = addr.trim_start_matches('[').trim_end_matches(']');
    let addr = addr.split('%').next().unwrap_or(addr); // drop "%lo0" scope ids
    Some((addr.to_string(), port))
}

fn listener(addr: String, port: u16, process: Option<String>, pid: Option<u32>) -> Listener {
    Listener { exposed: !is_loopback(&addr), address: addr, port, process, pid }
}

/// `lsof -F pcn` output: lines starting with p (pid), c (command), n (name).
pub fn parse_lsof(text: &str) -> Vec<Listener> {
    let mut out = BTreeSet::new();
    let (mut pid, mut cmd) = (None, None);
    for line in text.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => { pid = rest.parse().ok(); cmd = None; }
            "c" => cmd = Some(rest.to_string()),
            "n" => {
                // names look like "*:7000" or "127.0.0.1:631" (LISTEN sockets have no "->")
                if let Some((addr, port)) = split_endpoint(rest.split("->").next().unwrap_or(rest)) {
                    out.insert(listener(addr, port, cmd.clone(), pid));
                }
            }
            _ => {}
        }
    }
    out.into_iter().collect()
}

/// Windows `netstat -ano`: "  TCP    0.0.0.0:135     0.0.0.0:0     LISTENING     1234"
pub fn parse_netstat(text: &str, names: &HashMap<u32, String>) -> Vec<Listener> {
    let mut out = BTreeSet::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || cols[0] != "TCP" || cols[3] != "LISTENING" {
            continue;
        }
        if let Some((addr, port)) = split_endpoint(cols[1]) {
            let pid = cols[4].parse().ok();
            let name = pid.and_then(|p| names.get(&p).cloned());
            out.insert(listener(addr, port, name, pid));
        }
    }
    out.into_iter().collect()
}

/// Windows `tasklist /FO CSV /NH`: "\"svchost.exe\",\"1234\",\"Services\",\"0\",\"12,345 K\""
pub fn parse_tasklist(text: &str) -> HashMap<u32, String> {
    text.lines()
        .filter_map(|line| {
            let mut cols = line.split("\",\"");
            let name = cols.next()?.trim_start_matches('"').to_string();
            let pid = cols.next()?.parse().ok()?;
            Some((pid, name))
        })
        .collect()
}

async fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
    let out = cmd.output().await.ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn listeners() -> Vec<Listener> {
    if cfg!(windows) {
        let names = run("tasklist", &["/FO", "CSV", "/NH"]).await.map(|t| parse_tasklist(&t)).unwrap_or_default();
        run("netstat", &["-ano"]).await.map(|t| parse_netstat(&t, &names)).unwrap_or_default()
    } else {
        // +c 0 = full app names (not cut to 9 characters)
        let lsof = if cfg!(target_os = "macos") { "/usr/sbin/lsof" } else { "lsof" };
        run(lsof, &["+c", "0", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]).await.map(|t| parse_lsof(&t)).unwrap_or_default()
    }
}

/// Is the computer's firewall switched on? None = couldn't tell.
pub async fn firewall_on() -> Option<bool> {
    if cfg!(target_os = "macos") {
        // "Firewall is enabled. (State = 1)" / "Firewall is disabled. (State = 0)"
        let t = run("/usr/libexec/ApplicationFirewall/socketfilterfw", &["--getglobalstate"]).await?;
        if t.contains("enabled") { Some(true) } else if t.contains("disabled") { Some(false) } else { None }
    } else if cfg!(windows) {
        // one "State ON/OFF" line per profile (domain, private, public)
        let t = run("netsh", &["advfirewall", "show", "allprofiles", "state"]).await?;
        let states: Vec<bool> = t.lines().filter(|l| l.trim_start().starts_with("State")).map(|l| l.contains("ON")).collect();
        (!states.is_empty()).then(|| states.iter().all(|s| *s))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints() {
        assert_eq!(split_endpoint("*:7000"), Some(("*".into(), 7000)));
        assert_eq!(split_endpoint("127.0.0.1:631"), Some(("127.0.0.1".into(), 631)));
        assert_eq!(split_endpoint("[::1]:631"), Some(("::1".into(), 631)));
        assert_eq!(split_endpoint("[fe80::1%lo0]:5353"), Some(("fe80::1".into(), 5353)));
        assert_eq!(split_endpoint("nonsense"), None);
    }

    #[test]
    fn lsof_output() {
        let t = "p512\ncControlCenter\nn*:7000\nn*:5000\np880\ncnode\nn127.0.0.1:5173\np901\ncrapportd\nn[::1]:49152\n";
        let l = parse_lsof(t);
        assert_eq!(l.len(), 4);
        let airplay = l.iter().find(|x| x.port == 7000).unwrap();
        assert!(airplay.exposed);
        assert_eq!(airplay.process.as_deref(), Some("ControlCenter"));
        assert_eq!(airplay.pid, Some(512));
        let vite = l.iter().find(|x| x.port == 5173).unwrap();
        assert!(!vite.exposed);
        assert!(!l.iter().find(|x| x.port == 49152).unwrap().exposed);
    }

    #[test]
    fn windows_output() {
        let names = parse_tasklist("\"System\",\"4\",\"Services\",\"0\",\"144 K\"\r\n\"svchost.exe\",\"1100\",\"Services\",\"0\",\"9,000 K\"\r\n");
        assert_eq!(names.get(&1100).map(String::as_str), Some("svchost.exe"));
        let t = "\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n  \
                 TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100\r\n  \
                 TCP    127.0.0.1:5939         0.0.0.0:0              LISTENING       4\r\n  \
                 TCP    192.168.1.20:52000     52.1.2.3:443           ESTABLISHED     1100\r\n  \
                 TCP    [::]:445               [::]:0                 LISTENING       4\r\n";
        let l = parse_netstat(t, &names);
        assert_eq!(l.len(), 3);
        assert!(l.iter().any(|x| x.port == 135 && x.exposed && x.process.as_deref() == Some("svchost.exe")));
        assert!(l.iter().any(|x| x.port == 5939 && !x.exposed));
    }
}
