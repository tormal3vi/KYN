//! Reading the computer's ARP table: the list of IP address → MAC address
//! pairs it has learned by talking to devices on the local network.
//!
//! No special permissions needed: macOS and Windows have an `arp -a` command
//! anyone can run, and Linux exposes the same list in /proc/net/arp.

use std::net::Ipv4Addr;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub ip: Ipv4Addr,
    pub mac: [u8; 6],
}

/// Parse a MAC written as "a4:2b:b0:1:2:3" (macOS drops leading zeros) or
/// "a4-2b-b0-01-02-03" (Windows).
pub fn parse_mac(s: &str) -> Option<[u8; 6]> {
    let parts: Vec<&str> = s.split(|c| c == ':' || c == '-').collect();
    if parts.len() != 6 {
        return None;
    }
    let mut mac = [0u8; 6];
    for (i, p) in parts.iter().enumerate() {
        if p.is_empty() || p.len() > 2 {
            return None;
        }
        mac[i] = u8::from_str_radix(p, 16).ok()?;
    }
    Some(mac)
}

pub fn format_mac(mac: &[u8; 6]) -> String {
    mac.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":")
}

/// Real devices only: skip empty, broadcast and multicast addresses.
fn is_device_mac(mac: &[u8; 6]) -> bool {
    *mac != [0; 6] && *mac != [0xff; 6] && mac[0] & 0x01 == 0
}

/// macOS / BSD: `? (192.168.1.1) at a4:2b:b0:1:2:3 on en0 ifscope [ethernet]`
#[allow(dead_code)] // each OS uses one of these parsers
pub fn parse_bsd(text: &str) -> Vec<Entry> {
    text.lines()
        .filter_map(|line| {
            let ip = line.split('(').nth(1)?.split(')').next()?.parse().ok()?;
            let mac = parse_mac(line.split(" at ").nth(1)?.split_whitespace().next()?)?;
            Some(Entry { ip, mac })
        })
        .filter(|e| is_device_mac(&e.mac))
        .collect()
}

/// Windows: `  192.168.1.1           a4-2b-b0-01-02-03     dynamic`
#[allow(dead_code)] // each OS uses one of these parsers
pub fn parse_windows(text: &str) -> Vec<Entry> {
    text.lines()
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let ip = cols.next()?.parse().ok()?;
            let mac = parse_mac(cols.next()?)?;
            Some(Entry { ip, mac })
        })
        .filter(|e| is_device_mac(&e.mac))
        .collect()
}

/// Linux /proc/net/arp: `192.168.1.1  0x1  0x2  a4:2b:b0:01:02:03  *  eth0`
#[allow(dead_code)] // each OS uses one of these parsers
pub fn parse_linux(text: &str) -> Vec<Entry> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 4 || cols[2] == "0x0" {
                return None; // 0x0 = incomplete
            }
            Some(Entry { ip: cols[0].parse().ok()?, mac: parse_mac(cols[3])? })
        })
        .filter(|e| is_device_mac(&e.mac))
        .collect()
}

/// Read the table on this computer.
pub async fn read_table() -> Vec<Entry> {
    #[cfg(target_os = "linux")]
    {
        return tokio::fs::read_to_string("/proc/net/arp").await.map(|t| parse_linux(&t)).unwrap_or_default();
    }
    #[cfg(not(target_os = "linux"))]
    {
        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("arp");
            c.arg("-a");
            c
        } else {
            let mut c = tokio::process::Command::new("/usr/sbin/arp");
            c.arg("-an");
            c
        };
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
        let Ok(out) = cmd.output().await else { return Vec::new() };
        let text = String::from_utf8_lossy(&out.stdout);
        if cfg!(windows) { parse_windows(&text) } else { parse_bsd(&text) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_output() {
        let t = "? (192.168.1.1) at a4:2b:b0:1:2:3 on en0 ifscope [ethernet]\n\
                 ? (192.168.1.23) at (incomplete) on en0 ifscope [ethernet]\n\
                 ? (192.168.1.40) at f0:d1:a9:aa:bb:cc on en0 ifscope [ethernet]\n\
                 ? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]\n\
                 ? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]\n";
        let e = parse_bsd(t);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].ip, Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(format_mac(&e[0].mac), "a4:2b:b0:01:02:03");
    }

    #[test]
    fn windows_output() {
        let t = "\r\nInterface: 192.168.1.20 --- 0x7\r\n  Internet Address      Physical Address      Type\r\n  \
                 192.168.1.1           a4-2b-b0-01-02-03     dynamic\r\n  \
                 192.168.1.255         ff-ff-ff-ff-ff-ff     static\r\n  \
                 224.0.0.22            01-00-5e-00-00-16     static\r\n";
        let e = parse_windows(t);
        assert_eq!(e, vec![Entry { ip: Ipv4Addr::new(192, 168, 1, 1), mac: [0xa4, 0x2b, 0xb0, 1, 2, 3] }]);
    }

    #[test]
    fn linux_output() {
        let t = "IP address       HW type     Flags       HW address            Mask     Device\n\
                 192.168.1.1      0x1         0x2         a4:2b:b0:01:02:03     *        eth0\n\
                 192.168.1.9      0x1         0x0         00:00:00:00:00:00     *        eth0\n";
        assert_eq!(parse_linux(t).len(), 1);
    }
}
