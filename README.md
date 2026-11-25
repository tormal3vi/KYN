# GHOSTLINE

> Working title. Easy to change, see [Renaming the app](#renaming-the-app).

A desktop security toolkit for **your own devices and your own network**, with a
terminal / glitch aesthetic. It boots like a command line, resolves into an
animated RGB-split logo, and opens a module menu.

Built with [Tauri 2](https://tauri.app): a small Rust app that shows a web UI
(HTML/CSS/JS) in the system's own browser engine. One UI ships to macOS
(first) and Windows (later).

## Scope: what this app will and won't do

GHOSTLINE is a defensive, learning tool. Every feature works only on hardware
and networks you own.

**In scope:** mapping devices on your own LAN, auditing ports on your own
machines, watching services you run, an offline hacking-*simulator* game, and
a front-end for hardware you own (ESP32, Flipper Zero).

**Out of scope, and not to be added:** intercepting other people's traffic,
Wi-Fi deauthentication or jamming, viewing other people's cameras, sending
commands to other people's devices, cloning other people's cards, or
anything else aimed at people or devices you don't own.

## Status

| # | Module | Status |
| --- | --- | --- |
| – | Boot screen → glitch logo → module menu | **done** |
| 1 | Network Map: devices on your LAN (IP, MAC, vendor, online) | next |
| 2 | Port Audit: open ports on your machines, risky ones explained | planned |
| 3 | Watchdog: ping your services, alert screen when one is down | planned |
| 4 | Hack Sim: offline game, fake network, no real targets | later |
| 5 | Hardware Link: ESP32 / Flipper Zero you own | later |

## Run it

First time on a Mac? Follow **[docs/SETUP-MAC.md](docs/SETUP-MAC.md)**: it
covers installing the tools step by step.

Once set up:

```bash
npm install        # once
npm run dev        # run the app in a window (live-reloads on changes)
npm run preview    # UI only, in a normal browser at http://localhost:5173
npm run build      # make GHOSTLINE.app + .dmg
```

**Controls:** any key fast-forwards the boot · `Esc` skips to the menu ·
`↑` `↓` select · `Enter` open · `1`–`5` jump · `Esc` back.

## How the project is laid out

```
src/                    the UI: plain HTML/CSS/JS, no framework, no build step
  index.html            the screens (boot, logo, menu)
  css/theme.css         colours + CRT scanlines. Change the palette here.
  css/boot.css          boot log + "switch-off" transition
  css/logo.css          logo screen + the glitch layer effect
  css/menu.css          module menu, module pages, operator panel
  js/config.js          app name, tagline, module list. Start here.
  js/main.js            runs the screens in order and routes key presses
  js/boot.js            the typed boot log
  js/pixel.js           5×7 pixel font, ghost logo, module icons
  js/glitch.js          RGB-split / slice glitch bursts
  js/menu.js            module menu + module pages
  js/sysinfo.js         gets system info (from Rust in the app, browser in preview)
src-tauri/              the native app (Rust)
  src/lib.rs            Rust commands the UI can call (now: system_info)
  src/main.rs           starts the app
  tauri.conf.json       window size, app name, icons, security policy
  capabilities/         what the UI is allowed to ask the system for
  icons/                generated app icons (npm run icon)
design/app-icon.svg     icon source, generated from the pixel logo
scripts/serve.mjs       the `npm run preview` server
scripts/make-icon.mjs   rebuilds the icon from the logo
docs/SETUP-MAC.md       step-by-step Mac setup
```

### How the two halves talk

The UI can't touch your network or files by itself; web pages aren't allowed
to. When it needs something real, it asks Rust:

```js
// JavaScript (src/js/sysinfo.js)
const info = await window.__TAURI__.core.invoke('system_info');
```

```rust
// Rust (src-tauri/src/lib.rs)
#[tauri::command]
fn system_info() -> SystemInfo { ... }
```

The Network Map will follow the same pattern: Rust does the scan of your
LAN, then hands the device list to the UI as JSON.

## Renaming the app

1. `src/js/config.js` → `name` (and `tagline` if you like). This alone renames
   everything you see inside the app, including the pixel logo.
2. `src-tauri/tauri.conf.json` → `productName` and the window `title`. This
   is the name in the Dock, the menu bar and the `.app` file.
3. `src/index.html` → `<title>` (shown for a split second before the JS loads).
4. Optional: `identifier` in `tauri.conf.json` (`com.ghostline.desktop`).
   macOS uses it to tell apps apart. Pick the final one before you share the
   app with anyone, and don't change it after that.
5. Optional: `name` in `package.json` and `src-tauri/Cargo.toml` (internal
   only, nobody sees these).

Run `npm run icon` afterwards only if you changed the logo art.

## Windows (later)

Same code, same commands. On Windows you need: Microsoft C++ Build Tools
("Desktop development with C++"), Rust, and Node.js. WebView2 is already
part of Windows 10/11. `npm run build` then produces an `.msi` and `.exe`
installer.
