//! What KYN remembers between runs, saved as JSON in the app's data folder
//! (on a Mac: ~/Library/Application Support/com.kyn.desktop/netmap.json):
//! which networks you confirmed are yours, and per device its name, whether
//! you marked it as known, and when it was first and last seen.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Saved {
    pub label: Option<String>,
    #[serde(default)]
    pub known: bool,
    pub first_seen: u64,
    pub last_seen: u64,
    pub last_ip: String,
    pub kind: String,
    pub vendor: Option<String>,
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Network {
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub devices: HashMap<String, Saved>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Store {
    #[serde(default)]
    pub networks: HashMap<String, Network>,
}

impl Store {
    pub fn load(path: &PathBuf) -> Store {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        // write to a temp file first, so a crash never leaves a half-written file
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    pub fn network(&mut self, id: &str) -> &mut Network {
        self.networks.entry(id.to_string()).or_default()
    }
}
