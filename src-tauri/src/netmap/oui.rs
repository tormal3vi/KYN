//! Manufacturer lookup: the first three bytes of a MAC address identify the
//! company that made the network chip ("OUI"). The table is bundled in the app
//! (src-tauri/data/oui.tsv, from the IEEE registry), so it works offline.
//! Rebuild it with `npm run update-oui`.

use std::collections::HashMap;
use std::sync::OnceLock;

static TABLE_TEXT: &str = include_str!("../../data/oui.tsv");
static TABLE: OnceLock<HashMap<u32, &'static str>> = OnceLock::new();

fn table() -> &'static HashMap<u32, &'static str> {
    TABLE.get_or_init(|| {
        TABLE_TEXT
            .lines()
            .filter_map(|line| {
                let (prefix, name) = line.split_once('\t')?;
                Some((u32::from_str_radix(prefix, 16).ok()?, name))
            })
            .collect()
    })
}

/// Phones and laptops often use a made-up "private" MAC address for privacy.
/// Those have the "locally administered" bit set and no real manufacturer.
pub fn is_randomized(mac: &[u8; 6]) -> bool {
    mac[0] & 0x02 != 0
}

pub fn vendor(mac: &[u8; 6]) -> Option<&'static str> {
    if is_randomized(mac) {
        return None;
    }
    let key = (mac[0] as u32) << 16 | (mac[1] as u32) << 8 | mac[2] as u32;
    table().get(&key).copied().filter(|v| *v != "Private")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_prefixes() {
        assert_eq!(vendor(&[0xb8, 0x27, 0xeb, 1, 2, 3]), Some("Raspberry Pi Foundation"));
        assert_eq!(vendor(&[0xf0, 0xd1, 0xa9, 1, 2, 3]), Some("Apple"));
        assert_eq!(vendor(&[0x5c, 0xaa, 0xfd, 1, 2, 3]), Some("Sonos"));
    }

    #[test]
    fn randomized_addresses_have_no_vendor() {
        let private = [0x5a, 0x11, 0x22, 0x33, 0x44, 0x55];
        assert!(is_randomized(&private));
        assert_eq!(vendor(&private), None);
    }
}
