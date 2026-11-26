// ─────────────────────────────────────────────────────────────────────────────
// Auto-update bridge (Rust side: src-tauri/src/updater.rs).
//
// checkForUpdate() → { state: 'dev' | 'unconfigured' | 'current' | 'available',
//                      current, version, notes }   or null in a plain browser
// installUpdate(onProgress) downloads, verifies, installs and restarts.
// ─────────────────────────────────────────────────────────────────────────────

const tauri = window.__TAURI__;

export async function checkForUpdate() {
  if (!tauri?.core?.invoke) return null;
  try {
    return await tauri.core.invoke('update_check');
  } catch (e) {
    return { state: 'error', message: String(e?.message || e) };
  }
}

export async function installUpdate(onProgress) {
  const offs = await Promise.all([
    tauri.event.listen('update:progress', (e) => onProgress(e.payload)),
    tauri.event.listen('update:installing', () => onProgress({ installing: true })),
  ]);
  try {
    await tauri.core.invoke('update_install'); // the app restarts when this succeeds
  } finally {
    offs.forEach((off) => off());
  }
}
