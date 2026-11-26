# KYN

```
[+] Initializing KYN protocol...
[+] Establishing mesh network...
[+] Verifying identity...
[+] Connection successful.

[ KYN ] _
  KNOW YOUR NETWORK.
```

A desktop security toolkit for **your own devices and your own network**. It
looks and behaves like a command-line program: one black screen, one
monospace grid, a decoding startup log, the KYN mask assembling itself out
of character static, and a keyboard-driven module menu.

Built with [Tauri 2](https://tauri.app): a small Rust app that shows a web UI
in the system's own browser engine. One UI ships to macOS (first) and Windows
(later).

## Scope: what this app will and won't do

KYN is a defensive, learning tool. Every feature works only on hardware and
networks you own.

**In scope:** mapping devices on your own LAN, auditing ports on your own
machines, seeing what your own computer is connecting to, watching services
you run, and a front-end for hardware you own (ESP32, Flipper Zero).

**Out of scope, and not to be added:** intercepting other people's traffic,
Wi-Fi deauthentication or jamming, viewing other people's cameras, sending
commands to other people's devices, cloning other people's cards, or
anything else aimed at people or devices you don't own.

## Status

| # | Module | Status |
| --- | --- | --- |
| – | Startup → logo → module menu | **done** |
| 1 | OPS: one-key security checks per situation (SAFEHOUSE, LOCKDOWN, HEADCOUNT, CHECKPOINT, BLACKLIST) | **done** |
| 2 | Network Map: devices on your LAN, with icons, names, vendor, online/offline | **done** |
| 3 | Port Audit: open ports on your machines, risky ones explained | **done** |
| 4 | Traffic Monitor: which app on this computer talks to which server, how much, and where in the world | **done** |
| 5 | Watchdog: ping your services, alert when one is down | planned |
| 6 | Hardware Link: ESP32 / Flipper Zero you own | later |
| – | Installable app (Dock + icon) with signed auto-updates | **done**, see [docs/UPDATES.md](docs/UPDATES.md) |

## Run it

First time on a Mac? Follow **[docs/SETUP-MAC.md](docs/SETUP-MAC.md)**.

```bash
npm install         # once
npm run dev         # the app, in a window (reloads when you edit src/)
npm run boot:cli    # the same startup in your real terminal (text logo)
npm run preview     # the UI in a normal browser, http://localhost:5173
npm run build       # make KYN.app + .dmg on this computer
npm run release -- 0.2.0   # publish a new version (auto-update), see docs/UPDATES.md
```

**Controls:** any key finishes the startup · `Esc` skips to the menu ·
`↑` `↓` select · `Enter` open · `1`–`5` jump · `Esc` back.

## Network Map

Open it from the menu (`2`). The first time KYN sees a network it asks you to
confirm it's yours; it remembers that per network.

**What a scan does** (`src-tauri/src/netmap/scan.rs`, about 5–8 seconds):

1. Knocks once on every address in your subnet (a tiny UDP packet and a TCP
   connection attempt to port 80/443). That makes your computer ask the
   network "who has this address?", and every switched-on device answers.
2. Reads your computer's ARP table: the list of IP → MAC addresses it just
   learned (`arp -a`, no admin rights needed).
3. Listens for Bonjour/mDNS announcements: names like "Living Room" and
   models like `AppleTV11,1`.
4. For each device: asks your router for its name (reverse DNS), checks ~15
   well-known ports that hint at what it is, and looks up the maker from the
   MAC address in a bundled table (`src-tauri/data/oui.tsv`, works offline).

A small rule set (`classify.rs`) turns those clues into a device type and
icon, and keeps the reason ("announces model MacBookPro18,3") to show you.

**Scope guard** (`scope.rs`): only private ranges (10.x, 172.16–31.x,
192.168.x), only the network you're connected to, never more than the 254
addresses around you. Public ranges are refused.

**What it remembers** (`netmap.json` in the app data folder, on a Mac
`~/Library/Application Support/com.kyn.desktop/`): networks you approved,
and per device your name for it, whether you marked it known, first/last
seen. New unknown devices are flagged with a red `!`.

**Keys:** `←` `→` select · `tab` map/list · `r` rescan · `n` rename ·
`k` known/unknown · `esc` back. The mouse and scroll wheel work too.

**Does it show everything?** Every device that is switched on and connected to
the same network you are. There's no limit on how many: the map uses a second
ring after 12, and the list scrolls ("↓ 4 more below"). Things that can hide
a device: it's on a separate guest Wi-Fi, your router has "client isolation"
switched on, or it was asleep and stayed silent (press `r` to scan again).

In the browser preview there's no Rust, so it plays a demo network instead
(labelled "demo data").

## Port Audit

Open it from the menu (`3`), or press `p` on a device in Network Map.

Pick a device, then `enter` for a **quick check** (the ~140 ports in
`src/js/portaudit/knowledge.js`, a few seconds) or `f` for a **full check**
(all 65,535, a minute or two; `esc` stops it). A check is just knocking: a
normal connection attempt to each port, closed again straight away. Nothing
is sent and nothing is logged in to.

Every open port is listed riskiest first (`high` in red, then `medium`,
`low`, `info`) with what it is, why it matters and how to close it, with Mac
steps where they apply.

**This computer** gets extra detail from the operating system (`lsof` on a
Mac): which app owns each port, whether other devices can reach it or it only
listens on this computer ("local"), and whether the firewall is on. macOS
only shows the names of system services to admins, so those appear as
"a system service".

**Nothing open?** Every knock is sorted like nmap does: *open*, *closed*
(the device answered "nothing here"), or *no answer*. KYN tells you which
one it was. "Couldn't reach the device at all" on a Mac almost always means
macOS is blocking KYN from the local network: System Settings → Privacy &
Security → Local Network → switch on KYN (or Terminal, when you start KYN
with `npm run dev`), then press `r`.

**Scope:** this computer, or devices on the network you confirmed in Network
Map. Anything else is refused (`src-tauri/src/portaudit/mod.rs`).

**Keys:** `↑` `↓` select · `r` check again · `f` full check · `t` pick
another device · `esc` back.

## OPS

The first module (`1` in the menu): security checks you run with one key,
picked by the situation you're in. Each op runs a chain of checks as a live
log, ends with a verdict (`CLEAR`, `CAUTION`, `ALERT`, or `UNSURE` when the
main check couldn't run) and a numbered to-do list in plain language, and
remembers its runs so the next one can tell you what changed.

| Op | When | What it checks |
| --- | --- | --- |
| **SAFEHOUSE** | you just joined a café, hotel, airport or school Wi-Fi | login page in the way, honest DNS answers, nobody reading your HTTPS, VPN, firewall, what on this computer strangers on the network can reach |
| **LOCKDOWN** | monthly, or before travelling | disk encryption (FileVault / BitLocker), firewall, stealth mode, Gatekeeper / Defender, System Integrity Protection, automatic security fixes, remote-access doors |
| **HEADCOUNT** | slow internet, guests, weekly | every device on your Wi-Fi, who's new since the last headcount, who you haven't marked as yours |
| **CHECKPOINT** | new router or new settings | the router's open doors (Telnet, UPnP, TR-069...), encrypted settings page, which DNS servers it hands out, honest DNS |
| **BLACKLIST** | something feels off | every server your apps talk to, against public threat lists; apps online for the first time; unencrypted connections |

How the two network checks work:

- **Honest DNS:** three names whose addresses never change
  (`one.one.one.one`, `dns.google`, `dns.quad9.net`) are looked up through
  the network's DNS and compared with their real addresses. A made-up name
  must not exist. Hostile Wi-Fi that redirects you fails this.
- **Nobody reading your HTTPS:** three well-known sites are opened twice:
  once trusting what this computer trusts, once trusting only Mozilla's public
  list of certificate authorities. If the network swaps certificates, both
  fail. If something installed on this computer inspects HTTPS (antivirus
  "web shields", work device management, or malware), only the second fails.

**Threat lists** (BLACKLIST): abuse.ch Feodo Tracker (botnet control servers,
CC0), Spamhaus DROP (hijacked criminal networks) and Emerging Threats
(compromised machines). Downloaded at most every 12 hours into KYN's data
folder and matched on this computer; your addresses are never sent anywhere.

Each op lives in `src/js/ops/catalog.js` as a list of steps, so adding one is
adding an entry there. Every op only looks at this computer, its own traffic,
or devices on the network you confirmed as yours.

**Keys:** `↑` `↓` select · `enter` run · `r` run again · the op's shortcut
(`m` Network Map, `p` Port Audit, `t` Traffic Monitor) · `esc` back.

## Traffic Monitor

Open it from the menu (`4`). It lists every app on this computer that is
online right now: how many servers it talks to, how fast data is moving
(`↓` in, `↑` out), how much it used since it started, and which countries
its servers are in. `enter` shows one app's servers: where each one is, who
owns it, its name, and whether the connection is encrypted (unencrypted ones
are marked red with a `!`).

**The map.** Picking a server flies the world map to it, and it stops where
the location data stops knowing:

- **city level**: a circle of about 50 km around the city. The map never
  zooms in closer than that. An IP address is not a street address.
- **region level**: a circle of about 200 km.
- **country level**: the whole country lights up, with no point at all.
  Big cloud and video providers (Google, Apple, Amazon...) often only say
  "somewhere in the US".
- **unknown**: the world. Some global networks (Cloudflare) are everywhere.

**Where the places come from.** The first time, press `d` to download the
free location database once (about 37 MB): GeoLite2 City by MaxMind for
places, and the RouteViews + DB-IP ASN database for owners, packaged as
[@ip-location-db](https://github.com/sapics/ip-location-db) on npm. KYN
checks the download against npm's published SHA-512 fingerprint and keeps it
in its own app-data folder. From then on every lookup happens on this
computer: no address you connect to is sent anywhere. Server names come from
your normal DNS (the same thing your browser already asked).

This product includes GeoLite2 Data created by MaxMind, available from
[maxmind.com](https://www.maxmind.com) (CC BY-SA 4.0). Owner data: RouteViews
and DB-IP (CC BY 4.0). Map outlines: Natural Earth (public domain), via
world-atlas (see `src/data/NOTICE.md`). The GeoLite2 licence forbids using it
to find a specific household or person, and KYN doesn't.

**What it reads.** Only this computer's own list of connections (`lsof`, and
`nettop` for data amounts on a Mac: the same numbers Activity Monitor shows).
Nothing is captured, no connection's contents are read, and nothing looks at
other devices' traffic. On Windows and Linux the data amounts need admin
rights, so those columns stay empty there.

**Keys:** `↑` `↓` select · `enter` servers · `d` download places · `space`
pause · `esc` back.

## Design rules

The look comes from the KYN reference artwork:

- **Everything is made of characters.** Text sits on a monospace grid. The
  logo sits on a grid twice as fine (half the text size, exactly like the
  artwork), drawn as character-sized shapes: mesh squares, dashes, crosses,
  dots. No blur, glow or gradients.
- **Motion is character motion.** Text decodes out of scrambled characters,
  the logo assembles from static, a glint passes over it, and the idle loop
  sends pulses of light along the streaks and makes the eyes glimmer. All of
  it is characters changing, so a terminal can play it too.
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
  js/logo.js             the KYN mask: FINE (105×109, app) and COARSE (68×36 text)
  js/boot.js             startup, idle loop and exit, as a "terminal program"
  js/fx.js               character effects: decode, scramble, screen reveal
  js/term-web.js         draws that terminal program inside the window
  js/menu.js             the module menu, on the same grid
  js/netmap/screen.js    Network Map: map + list views, detail panel, keys
  js/netmap/icons.js     device icons (12×12, mesh style like the logo)
  js/netmap/api.js       calls into Rust (or plays demo data in a browser)
  js/portaudit/screen.js Port Audit: device picker, results, explanations
  js/portaudit/knowledge.js  what each port is, risk level, how to fix it
  js/portaudit/api.js    calls into Rust (or plays demo data in a browser)
  js/ops/catalog.js      OPS: the ops and their steps. Add new ops here.
  js/ops/screen.js       OPS: op list, live run log, verdict, history
  js/ops/api.js          calls into Rust (or plays a demo Mac in a browser)
  js/traffic/screen.js   Traffic Monitor: apps, servers, keys
  js/traffic/worldmap.js the zooming world map (dots on the fine grid)
  js/traffic/model.js    apps from raw connections, speeds, port names
  js/traffic/api.js      calls into Rust (or plays demo data in a browser)
  data/countries-50m.json  world map outlines (Natural Earth)
  js/sysinfo.js          asks Rust for hostname/OS (browser fallback in preview)
  js/updates.js          asks Rust whether a newer version exists, installs it
  js/main.js             startup → wait for a key → menu
src-tauri/               the native app (Rust)
  src/lib.rs             Rust commands the UI can call
  src/updater.rs         auto-updates: check, download, verify, install
  src/netmap/            the scanner: scope guard, sweep, ARP, Bonjour,
                         vendor lookup, device-type guessing, memory file
  src/portaudit/         port checks (scoped to your devices) and the
                         "which app listens where" report for this computer
  src/traffic/           this computer's connections and data per app, and
                         the offline place / owner lookup
  src/ops/               OPS building blocks: protections, honest-network
                         checks, threat lists, run history
  data/oui.tsv           MAC prefix → manufacturer table (npm run update-oui)
  Info.plist             macOS: why KYN asks for local-network access
  tauri.conf.json        window size, app name, icons, security policy
  capabilities/          what the UI is allowed to ask the system for
  icons/                 generated app icons (npm run icon)
scripts/boot-cli.mjs     runs boot.js in a real terminal (ANSI escape codes)
scripts/make-icon.mjs    draws the icon from logo.js
scripts/update-oui.mjs   rebuilds the manufacturer table from the IEEE list
scripts/setup-updates.mjs  one-time: create the update signing key
scripts/release.mjs      bump the version, commit and tag a release
.github/workflows/       release.yml: GitHub builds + publishes releases
docs/UPDATES.md          how releases and auto-updates work
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

The logo lives in `src/js/logo.js`, traced from the KYN artwork, in two sizes:

- `FINE` (105×109 cells) is what the app draws, at half the text size. Each
  cell is a shape code: `M` mesh square, `-` and `=` streaks, `+` cross,
  `|` post, `.` and `:` dots, with a brightness from `0` (faint) to `3`.
- `COARSE` (68×36 plain characters) is for real terminals, where every
  character is the same size. Brightness is `b`, `n` or `d`.

Edit the shape and brightness rows together, then run `npm run icon` to
rebuild the app icon.

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
