//! Scope guard: KYN only scans private networks you are directly connected to.
//!
//! Private ranges are the ones home and office networks use (10.x.x.x,
//! 172.16–31.x.x, 192.168.x.x), plus link-local and this machine itself.
//! Anything else (a public IP range) is refused. Big networks are capped to
//! the /24 around you (254 addresses), so a scan never becomes a sweep of a
//! whole company or campus.

use std::net::Ipv4Addr;

/// Smallest prefix we scan as-is. Bigger networks (e.g. a /16) are reduced to
/// the /24 that contains this machine.
pub const MAX_SCAN_PREFIX: u8 = 24;

/// Is this an address range KYN is allowed to scan?
pub fn allowed(ip: Ipv4Addr) -> Result<(), String> {
    if ip.is_private() || ip.is_link_local() || ip.is_loopback() {
        Ok(())
    } else {
        Err(format!(
            "{ip} is not a private address. KYN only scans private networks \
             (10.x, 172.16-31.x, 192.168.x) that you own."
        ))
    }
}

/// The prefix we will actually scan for a network of `prefix` bits.
pub fn scan_prefix(prefix: u8) -> u8 {
    prefix.max(MAX_SCAN_PREFIX).min(32)
}

/// Network address of `ip` with `prefix` bits.
pub fn network(ip: Ipv4Addr, prefix: u8) -> Ipv4Addr {
    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix as u32) };
    Ipv4Addr::from(u32::from(ip) & mask)
}

/// Every host address in the network (no network/broadcast address), minus `skip`.
pub fn hosts(ip: Ipv4Addr, prefix: u8, skip: &[Ipv4Addr]) -> Vec<Ipv4Addr> {
    let base = u32::from(network(ip, prefix));
    let size: u32 = 1u32 << (32 - prefix as u32);
    let range: Box<dyn Iterator<Item = u32>> = if prefix >= 31 {
        Box::new(base..base + size)
    } else {
        Box::new(base + 1..base + size - 1)
    };
    range.map(Ipv4Addr::from).filter(|a| !skip.contains(a)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ranges_are_allowed() {
        for ip in ["192.168.1.20", "10.0.0.5", "172.20.1.1", "169.254.3.3", "127.0.0.1"] {
            assert!(allowed(ip.parse().unwrap()).is_ok(), "{ip}");
        }
    }

    #[test]
    fn public_ranges_are_refused() {
        for ip in ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.64.0.1"] {
            assert!(allowed(ip.parse().unwrap()).is_err(), "{ip}");
        }
    }

    #[test]
    fn big_networks_are_capped_to_a_24() {
        assert_eq!(scan_prefix(16), 24);
        assert_eq!(scan_prefix(24), 24);
        assert_eq!(scan_prefix(26), 26);
    }

    #[test]
    fn host_list_skips_network_broadcast_and_self() {
        let me: Ipv4Addr = "192.168.1.20".parse().unwrap();
        let h = hosts(me, 24, &[me]);
        assert_eq!(h.len(), 253);
        assert_eq!(h[0], Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(*h.last().unwrap(), Ipv4Addr::new(192, 168, 1, 254));
        assert!(!h.contains(&me));
        assert_eq!(hosts(Ipv4Addr::LOCALHOST, 32, &[]), vec![Ipv4Addr::LOCALHOST]);
    }
}
