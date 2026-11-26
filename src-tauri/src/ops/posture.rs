//! "Is this computer locked down?" Read-only checks of the built-in
//! protections, using the tools the operating system ships with. None of them
//! need admin rights and none of them change anything.
//!
//!   macOS    socketfilterfw (firewall, stealth), fdesetup (FileVault),
//!            spctl (Gatekeeper), csrutil (System Integrity Protection),
//!            the Software Update preferences, sw_vers
//!   Windows  netsh (firewall), Defender's status, BitLocker's status
//!   Linux    nothing reliable without root: everything stays "unknown"

use serde::Serialize;

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Posture {
    pub os: &'static str,
    pub os_version: Option<String>,
    pub firewall: Option<bool>,
    /// firewall ignores pings and probes instead of answering them
    pub stealth: Option<bool>,
    /// FileVault (macOS) / BitLocker (Windows)
    pub disk_encryption: Option<bool>,
    /// macOS Gatekeeper: only run apps that are signed / checked
    pub gatekeeper: Option<bool>,
    /// macOS System Integrity Protection
    pub sip: Option<bool>,
    /// security fixes install by themselves
    pub auto_security_updates: Option<bool>,
    /// Windows Defender real-time protection
    pub antivirus: Option<bool>,
}

pub fn parse_stealth(t: &str) -> Option<bool> {
    let t = t.to_lowercase();
    if t.contains("enabled") || t.contains("mode is on") { Some(true) } else if t.contains("disabled") || t.contains("mode is off") { Some(false) } else { None }
}

pub fn parse_filevault(t: &str) -> Option<bool> {
    if t.contains("FileVault is On") { Some(true) } else if t.contains("FileVault is Off") { Some(false) } else { None }
}

pub fn parse_gatekeeper(t: &str) -> Option<bool> {
    if t.contains("assessments enabled") { Some(true) } else if t.contains("assessments disabled") { Some(false) } else { None }
}

pub fn parse_sip(t: &str) -> Option<bool> {
    let t = t.to_lowercase();
    if t.contains("status: enabled") { Some(true) } else if t.contains("status: disabled") { Some(false) } else { None }
}

/// `defaults read` of a 0/1 setting
pub fn parse_flag(t: &str) -> Option<bool> {
    match t.trim() {
        "1" | "true" | "YES" => Some(true),
        "0" | "false" | "NO" => Some(false),
        _ => None,
    }
}

/// BitLocker's shell property: 1 = on, 2 = off; 0 / 3 / else = can't tell
pub fn parse_bitlocker(t: &str) -> Option<bool> {
    match t.trim() {
        "1" => Some(true),
        "2" => Some(false),
        _ => None,
    }
}

pub fn parse_bool_word(t: &str) -> Option<bool> {
    match t.trim().to_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// stdout and stderr together (some of these tools answer on stderr)
async fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().await.ok()?;
    Some(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

async fn powershell(script: &str) -> Option<String> {
    run("powershell", &["-NoProfile", "-NonInteractive", "-Command", script]).await
}

pub async fn posture() -> Posture {
    let mut p = Posture { os: std::env::consts::OS, ..Default::default() };
    if cfg!(target_os = "macos") {
        const FW: &str = "/usr/libexec/ApplicationFirewall/socketfilterfw";
        const SU: &str = "/Library/Preferences/com.apple.SoftwareUpdate";
        let (ver, stealth, fv, gk, sip, critical, firewall) = tokio::join!(
            run("/usr/bin/sw_vers", &["-productVersion"]),
            run(FW, &["--getstealthmode"]),
            run("/usr/bin/fdesetup", &["status"]),
            run("/usr/sbin/spctl", &["--status"]),
            run("/usr/bin/csrutil", &["status"]),
            run("/usr/bin/defaults", &["read", SU, "CriticalUpdateInstall"]),
            crate::portaudit::local::firewall_on(),
        );
        p.os_version = ver.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        p.firewall = firewall;
        p.stealth = stealth.as_deref().and_then(parse_stealth);
        p.disk_encryption = fv.as_deref().and_then(parse_filevault);
        p.gatekeeper = gk.as_deref().and_then(parse_gatekeeper);
        p.sip = sip.as_deref().and_then(parse_sip);
        // not set at all = Apple's default, which is on
        p.auto_security_updates = match critical.as_deref() {
            Some(t) if t.contains("does not exist") => Some(true),
            Some(t) => parse_flag(t),
            None => None,
        };
    } else if cfg!(windows) {
        let (ver, av, bl, firewall) = tokio::join!(
            run("cmd", &["/C", "ver"]),
            powershell("(Get-MpComputerStatus).RealTimeProtectionEnabled"),
            powershell("(New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection')"),
            crate::portaudit::local::firewall_on(),
        );
        p.os_version = ver.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        p.firewall = firewall;
        p.antivirus = av.as_deref().and_then(parse_bool_word);
        p.disk_encryption = bl.as_deref().and_then(parse_bitlocker);
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_answers() {
        assert_eq!(parse_stealth("Stealth mode enabled\n"), Some(true));
        assert_eq!(parse_stealth("Firewall stealth mode is off\n"), Some(false));
        assert_eq!(parse_filevault("FileVault is On.\n"), Some(true));
        assert_eq!(parse_filevault("FileVault is Off.\n"), Some(false));
        assert_eq!(parse_gatekeeper("assessments enabled\n"), Some(true));
        assert_eq!(parse_sip("System Integrity Protection status: enabled.\n"), Some(true));
        assert_eq!(parse_sip("System Integrity Protection status: unknown (Custom Configuration).\n"), None);
        assert_eq!(parse_flag("1\n"), Some(true));
        assert_eq!(parse_flag("0\n"), Some(false));
    }

    #[test]
    fn windows_answers() {
        assert_eq!(parse_bool_word("True\r\n"), Some(true));
        assert_eq!(parse_bitlocker("2\r\n"), Some(false));
        assert_eq!(parse_bitlocker("1"), Some(true));
        assert_eq!(parse_bitlocker(""), None);
    }

    #[tokio::test]
    async fn runs_on_this_machine() {
        let p = posture().await;
        assert_eq!(p.os, std::env::consts::OS);
    }
}
