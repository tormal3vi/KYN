// ─────────────────────────────────────────────────────────────────────────────
// System info for the boot log and the operator panel.
//
// Inside the Tauri app, `window.__TAURI__` exists (enabled by
// "withGlobalTauri" in tauri.conf.json) and we ask the Rust side for the
// hostname and OS. In a plain browser (npm run preview) that bridge is
// missing, so we fall back to what the browser can tell us.
// ─────────────────────────────────────────────────────────────────────────────

const OS_NAMES = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

function browserOs() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('mac')) return 'macOS';
  if (p.includes('win')) return 'Windows';
  if (p.includes('android')) return 'Android';
  if (p.includes('iphone') || p.includes('ipad')) return 'iOS';
  if (p.includes('linux')) return 'Linux';
  return 'unknown';
}

/** Call a Rust command if we are running inside Tauri, otherwise return null. */
export async function invokeNative(command, args) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return null;
  return invoke(command, args);
}

export async function getSystemInfo() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const info = {
    native: false,
    hostname: null,
    os: browserOs(),
    arch: null,
    cores: navigator.hardwareConcurrency || null,
    screen: `${window.screen.width}×${window.screen.height}`,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    locale: navigator.language || 'unknown',
    tz,
    online: navigator.onLine,
    error: null,
  };
  try {
    const n = await invokeNative('system_info');
    if (n) {
      info.native = true;
      info.hostname = n.hostname;
      info.os = OS_NAMES[n.os] || n.os;
      info.arch = n.arch;
    }
  } catch (err) {
    info.error = String(err);
  }
  return info;
}
