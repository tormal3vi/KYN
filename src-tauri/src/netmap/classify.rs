//! Guessing what kind of device something is, from the clues a scan collects.
//!
//! Clues, strongest first: is it the router / this computer, the model name
//! the device announces over Bonjour, the Bonjour services it offers, words in
//! its name, a few identifying open ports, and the chip manufacturer.
//! Every guess comes with a short reason, shown in the UI.

#[derive(Default)]
pub struct Clues<'a> {
    pub is_gateway: bool,
    pub is_self: bool,
    pub vendor: Option<&'a str>,
    pub names: Vec<String>,
    pub services: Vec<String>,
    pub model: Option<&'a str>,
    pub ports: Vec<u16>,
    pub randomized: bool,
}

pub struct Guess {
    pub kind: &'static str,
    pub reason: String,
}

fn guess(kind: &'static str, reason: impl Into<String>) -> Option<Guess> {
    Some(Guess { kind, reason: reason.into() })
}

fn has(haystack: &str, words: &[&str]) -> bool {
    words.iter().any(|w| haystack.contains(w))
}

fn from_model(model: &str) -> Option<&'static str> {
    let m = model.to_lowercase();
    if m.contains("macbook") { return Some("laptop"); }
    if has(&m, &["imac", "macmini", "macpro", "mac1", "macstudio"]) { return Some("computer"); }
    if m.contains("iphone") { return Some("phone"); }
    if m.contains("ipad") { return Some("tablet"); }
    if has(&m, &["appletv", "chromecast", "google tv", "shield", "bravia", "roku"]) { return Some("tv"); }
    if has(&m, &["audioaccessory", "homepod", "nest audio", "nest mini", "home mini", "speaker", "sonos"]) { return Some("speaker"); }
    if m.contains("watch") { return Some("watch"); }
    if has(&m, &["laserjet", "officejet", "deskjet", "envy", "pixma", "ecotank", "printer"]) { return Some("printer"); }
    None
}

fn from_services(services: &[String]) -> Option<(&'static str, &'static str)> {
    let s = |name: &str| services.iter().any(|x| x == name);
    if s("_ipp._tcp") || s("_printer._tcp") || s("_pdl-datastream._tcp") { return Some(("printer", "offers a printing service")); }
    if s("_googlecast._tcp") || s("_amzn-wplay._tcp") || s("_androidtvremote2._tcp") { return Some(("tv", "offers a cast / TV remote service")); }
    if s("_sonos._tcp") || s("_spotify-connect._tcp") { return Some(("speaker", "offers a speaker service")); }
    if s("_apple-mobdev2._tcp") { return Some(("phone", "offers Apple mobile-device sync")); }
    if s("_esphomelib._tcp") || s("_arduino._tcp") { return Some(("board", "announces itself as an ESPHome / Arduino board")); }
    if s("_hap._tcp") || s("_hue._tcp") || s("_matter._tcp") { return Some(("smarthome", "offers a smart-home service (HomeKit / Hue / Matter)")); }
    if s("_airplay._tcp") || s("_raop._tcp") { return Some(("tv", "accepts AirPlay")); }
    if s("_smb._tcp") || s("_afpovertcp._tcp") { return Some(("computer", "shares files")); }
    if s("_ssh._tcp") || s("_workstation._tcp") { return Some(("computer", "offers remote login")); }
    None
}

fn from_name(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    if n.contains("iphone") || has(&n, &["android", "galaxy", "pixel", "oneplus", "redmi", "xiaomi", "huawei-p", "moto"]) { return Some("phone"); }
    if n.contains("ipad") || n.contains("tab") { return Some("tablet"); }
    if has(&n, &["macbook", "laptop", "thinkpad", "notebook"]) { return Some("laptop"); }
    if has(&n, &["imac", "mac-mini", "macmini", "desktop", "-pc", "workstation"]) { return Some("computer"); }
    if has(&n, &["appletv", "apple-tv", "chromecast", "firetv", "fire-tv", "roku", "bravia", "-tv", "tv-", "shield"]) { return Some("tv"); }
    if has(&n, &["ps4", "ps5", "playstation", "xbox", "nintendo", "switch"]) { return Some("console"); }
    if has(&n, &["printer", "laserjet", "officejet", "epson", "canon", "brother"]) { return Some("printer"); }
    if has(&n, &["homepod", "sonos", "echo", "alexa", "speaker", "nest-audio", "google-home"]) { return Some("speaker"); }
    if has(&n, &["cam", "ring-", "arlo", "wyze", "eufy", "doorbell"]) { return Some("camera"); }
    if has(&n, &["raspberrypi", "raspberry", "rpi", "esp32", "esp8266", "esp-"]) { return Some("board"); }
    if has(&n, &["tasmota", "shelly", "hue", "plug", "bulb", "thermostat", "kasa", "tuya"]) { return Some("smarthome"); }
    if has(&n, &["nas", "synology", "diskstation", "qnap", "server", "unraid", "truenas"]) { return Some("server"); }
    if has(&n, &["watch"]) { return Some("watch"); }
    None
}

fn from_ports(ports: &[u16]) -> Option<(&'static str, &'static str)> {
    let p = |n: u16| ports.contains(&n);
    if p(9100) || p(631) || p(515) { return Some(("printer", "printer port open")); }
    if p(8009) || p(8008) { return Some(("tv", "Chromecast port open")); }
    if p(62078) { return Some(("phone", "iPhone / iPad sync port open")); }
    if p(554) { return Some(("camera", "video stream (RTSP) port open")); }
    if p(1400) { return Some(("speaker", "Sonos port open")); }
    if p(3389) || p(548) || p(445) { return Some(("computer", "file sharing / remote desktop port open")); }
    if p(22) { return Some(("server", "SSH port open")); }
    None
}

fn from_vendor(vendor: &str) -> Option<&'static str> {
    let v = vendor.to_lowercase();
    if has(&v, &["raspberry pi"]) { return Some("board"); }
    if has(&v, &["espressif", "tuya", "shelly", "allterco", "signify", "philips lighting", "lifx", "ecobee", "irobot", "belkin", "wemo", "nanoleaf"]) { return Some("smarthome"); }
    if has(&v, &["sonos", "bose", "harman"]) { return Some("speaker"); }
    if has(&v, &["roku", "lg electronics", "tcl", "hisense", "vizio"]) { return Some("tv"); }
    if has(&v, &["nintendo", "sony interactive"]) { return Some("console"); }
    if has(&v, &["canon", "seiko epson", "brother industries", "xerox", "lexmark", "kyocera"]) { return Some("printer"); }
    if has(&v, &["synology", "qnap", "western digital"]) { return Some("server"); }
    if has(&v, &["hikvision", "dahua", "reolink", "axis communications", "wyze", "arlo", "ring"]) { return Some("camera"); }
    if has(&v, &["ubiquiti", "netgear", "mikrotik", "zyxel", "avm", "eero", "linksys", "tp-link", "asustek", "huawei", "zte", "sagemcom", "arris", "technicolor"]) { return Some("network"); }
    if has(&v, &["intel", "azurewave", "liteon", "dell", "lenovo", "hon hai", "micro-star", "gigabyte", "asrock"]) { return Some("computer"); }
    None
}

pub fn classify(c: &Clues) -> Guess {
    if c.is_gateway {
        return Guess { kind: "router", reason: "it is your default gateway".into() };
    }
    if c.is_self {
        let kind = c.model.and_then(from_model).unwrap_or("computer");
        return Guess { kind, reason: "this is the computer running KYN".into() };
    }
    c.model
        .and_then(|m| from_model(m).and_then(|k| guess(k, format!("announces model \"{m}\""))))
        .or_else(|| from_services(&c.services).and_then(|(k, why)| guess(k, why)))
        .or_else(|| {
            c.names.iter().find_map(|n| from_name(n).and_then(|k| guess(k, format!("its name \"{n}\""))))
        })
        .or_else(|| from_ports(&c.ports).and_then(|(k, why)| guess(k, why)))
        .or_else(|| c.vendor.and_then(|v| from_vendor(v).and_then(|k| guess(k, format!("made by {v}")))))
        .or_else(|| {
            if c.randomized {
                guess("phone", "uses a private Wi-Fi address, which phones, tablets and laptops do")
            } else {
                None
            }
        })
        .unwrap_or_else(|| Guess {
            kind: "unknown",
            reason: match c.vendor {
                Some(v) => format!("made by {v}, but nothing more specific"),
                None => "no identifying clues".into(),
            },
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_is_router() {
        assert_eq!(classify(&Clues { is_gateway: true, ..Default::default() }).kind, "router");
    }

    #[test]
    fn model_beats_vendor() {
        let c = Clues { model: Some("MacBookPro18,3"), vendor: Some("Apple"), ..Default::default() };
        assert_eq!(classify(&c).kind, "laptop");
        let c = Clues { model: Some("AppleTV11,1"), ..Default::default() };
        assert_eq!(classify(&c).kind, "tv");
        let c = Clues { model: Some("AudioAccessory5,1"), ..Default::default() };
        assert_eq!(classify(&c).kind, "speaker");
    }

    #[test]
    fn services_names_ports_vendor() {
        let c = Clues { services: vec!["_ipp._tcp".into()], ..Default::default() };
        assert_eq!(classify(&c).kind, "printer");
        let c = Clues { names: vec!["Levente-iPhone.local".into()], ..Default::default() };
        assert_eq!(classify(&c).kind, "phone");
        let c = Clues { ports: vec![8009], ..Default::default() };
        assert_eq!(classify(&c).kind, "tv");
        let c = Clues { vendor: Some("Espressif"), ..Default::default() };
        assert_eq!(classify(&c).kind, "smarthome");
        let c = Clues { vendor: Some("Raspberry Pi Trading"), ..Default::default() };
        assert_eq!(classify(&c).kind, "board");
    }

    #[test]
    fn private_address_and_nothing_else() {
        let c = Clues { randomized: true, ..Default::default() };
        assert_eq!(classify(&c).kind, "phone");
        assert_eq!(classify(&Clues::default()).kind, "unknown");
    }
}
