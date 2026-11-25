# KYN

```
[+] Initializing KYN protocol...
[+] Establishing mesh network...
[+] Verifying identity...
[+] Connection successful.

[ KYN ] _
  DECENTRALIZED BY NATURE.
```

A desktop security toolkit for **your own devices and your own network**. It
looks and behaves like a command-line program: one black screen, one
monospace grid, a typed startup log, the KYN mask drawn in plain text, and a
keyboard-driven module menu.

Built with [Tauri 2](https://tauri.app): a small Rust app that shows a web UI
in the system's own browser engine. One UI ships to macOS (first) and Windows
(later).

## Scope: what this app will and won't do

KYN is a defensive, learning tool. Every feature works only on hardware and
networks you own.

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
| – | Startup → logo → module menu | **done** |
| 1 | Network Map: devices on your LAN (IP, MAC, vendor, online) | next |
| 2 | Port Audit: open ports on your machines, risky ones explained | planned |
| 3 | Watchdog: ping your services, alert when one is down | planned |
| 4 | Hack Sim: offline game, fake network, no real targets | later |
| 5 | Hardware Link: ESP32 / Flipper Zero you own | later |

## Run it

First time on a Mac? Follow **[docs/SETUP-MAC.md](docs/SETUP-MAC.md)**.

```bash
npm install         # once
npm run dev         # the app, in a window (reloads when you edit src/)
npm run boot:cli    # the same startup, in your real terminal
npm run preview     # the UI in a normal browser, http://localhost:5173
npm run build       # make KYN.app + .dmg
```

**Controls:** any key finishes the startup · `Esc` skips to the menu ·
`↑` `↓` select · `Enter` open · `1`–`5` jump · `Esc` back.

## Design rules

The look comes from the KYN reference artwork:

- **Everything is text on a character grid.** No images, gradients, glow or
  animation that a real terminal couldn't do. The only motion is text being
  printed and the cursor blinking.
- **Monochrome on pure black**, with a single red accent: the `_` cursor
  (and the rare warning).
- **Colours are standard terminal colours** (the 256-colour set), defined
  once in `src/js/palette.js`. That's why `npm run boot:cli` in a terminal
  looks the same as the app.
- **Font: JetBrains Mono**, bundled in `src/fonts/` (SIL Open Font License),
  with ligatures removed so `==` and `--` stay separate characters, like in
  a terminal.

## How the project is laid out

```
src/                     the UI: plain HTML/CSS/JS, no framework, no build step
  index.html             one empty <main>; everything is drawn by JS
  css/kyn.css            font + the black terminal surface
  fonts/                 JetBrains Mono (subset) + its license
  js/config.js           name, tagline, startup lines, module list. Start here.
  js/palette.js          the colours (terminal colour numbers + exact hex)
  js/logo.js             the KYN mask as 68×36 characters + brightness map
  js/boot.js             the startup sequence, as a "terminal program"
  js/term-web.js         draws that terminal program inside the window
  js/menu.js             the module menu, on the same grid
  js/sysinfo.js          asks Rust for hostname/OS (browser fallback in preview)
  js/main.js             startup → wait for a key → menu
src-tauri/               the native app (Rust)
  src/lib.rs             Rust commands the UI can call (now: system_info)
  tauri.conf.json        window size, app name, icons, security policy
  capabilities/          what the UI is allowed to ask the system for
  icons/                 generated app icons (npm run icon)
scripts/boot-cli.mjs     runs boot.js in a real terminal (ANSI escape codes)
scripts/make-icon.mjs    draws the icon from logo.js
scripts/serve.mjs        the `npm run preview` server
design/app-icon.svg      icon source (generated)
docs/SETUP-MAC.md        step-by-step Mac setup
```

### One program, two screens

`boot.js` never touches the page directly. It only calls a small "terminal"
interface: `write(x, y, text, style)`, `cursor(x, y)`, `clear()`, `flush()`.

- In the app, `term-web.js` implements those calls by keeping a grid of
  characters and drawing it into the window.
- In a terminal, `scripts/boot-cli.mjs` implements the same calls with ANSI
  escape codes (move cursor, set colour, print).

Same program, same output, so the app *is* what it looks like in a command
line.

### How the UI talks to Rust

Web pages can't touch your network or files. When KYN needs something real,
the UI asks Rust:

```js
// JavaScript (src/js/sysinfo.js)
const info = await window.__TAURI__.core.invoke('system_info');
```

```rust
// Rust (src-tauri/src/lib.rs)
#[tauri::command]
fn system_info() -> SystemInfo { ... }
```

The Network Map will work the same way: Rust scans your LAN, then hands the
device list to the UI.

## Changing the logo

The logo is plain text in `src/js/logo.js`. `ART` is what's printed; `TONE`
is the same shape with `b` (bright), `n` (normal) or `d` (dim) per character.
Edit both together, then `npm run icon` to rebuild the app icon.

## Renaming the app

1. `src/js/config.js` → `name`, `tagline`, `command`. This renames
   everything on screen.
2. `src-tauri/tauri.conf.json` → `productName` and the window `title` (the
   name in the Dock and on the `.app`).
3. `src/index.html` → `<title>`.
4. Optional: `identifier` in `tauri.conf.json` (`com.kyn.desktop`). Pick the
   final one before sharing the app, then leave it alone; macOS uses it to
   tell apps apart.

## Windows (later)

Same code, same commands. On Windows you need Microsoft C++ Build Tools
("Desktop development with C++"), Rust and Node.js. WebView2 is already
part of Windows 10/11. `npm run build` produces an `.msi` and `.exe`
installer. `npm run boot:cli` works in Windows Terminal.
