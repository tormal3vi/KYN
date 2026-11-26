# Setting up KYN on a Mac

This gets you from a fresh Mac to the app running in a window. It takes about
20–30 minutes, most of it waiting for downloads and the first compile. Works the
same on Apple Silicon (M1/M2/M3/M4) and Intel Macs.

You will install three things:

| Tool | What it's for |
| --- | --- |
| Xcode Command Line Tools | Apple's compiler and `git`. Rust needs the compiler to build the app. |
| Rust (via `rustup`) | Builds the native part of the app (the `src-tauri/` folder). |
| Node.js (LTS) | Runs the Tauri command-line tool (`npm run dev`, `npm run build`). |

All commands go in the **Terminal** app (Applications → Utilities → Terminal).
Paste one block at a time and wait for it to finish.

---

## 1. Xcode Command Line Tools

```bash
xcode-select --install
```

A window pops up: click **Install** and wait. You do **not** need the full Xcode
app from the App Store for a desktop app.

If it says `command line tools are already installed`, you're done with this step.

## 2. Rust

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

When it asks, press **Enter** to accept the default install. Then **close the
Terminal window and open a new one** (so it picks up the new `cargo` command),
and check:

```bash
rustc --version
```

You should see something like `rustc 1.9x.x`.

## 3. Node.js

Download the **LTS** installer from <https://nodejs.org> and run it.
(If you already use Homebrew, `brew install node` works too.)

Check it in a new Terminal window:

```bash
node --version
```

Any version 20 or newer is fine.

## 4. Get the code

Pick a folder for your projects, for example `~/Projects`:

```bash
mkdir -p ~/Projects && cd ~/Projects
```

```bash
git clone https://github.com/tormal3vi/KYN.git kyn
```

```bash
cd kyn
```

Until this work is merged into the main branch, switch to the branch it lives on:

```bash
git checkout claude/zen-mccarthy-thikwj
```

> If the repository is private, `git clone` asks you to log in. The easiest
> fix is installing [GitHub Desktop](https://desktop.github.com) and cloning
> from there ("Clone a repository" → `tormal3vi/KYN`), then continue in
> Terminal from the folder it created.

## 5. Install the project's tools

```bash
npm install
```

This downloads the Tauri command-line tool into `node_modules/`. It only takes
a few seconds.

## 6. Run it

```bash
npm run dev
```

The **first run is slow, around 3–10 minutes**, because Rust compiles all of
Tauri's libraries once. You'll see a long list of `Compiling ...` lines. Later
runs start in seconds.

When it finishes, a KYN window opens and runs its startup. Leave the Terminal
running; it's the app's log.

- **Edit anything in `src/`** (HTML, CSS, JS) → the window reloads by itself.
- **Edit anything in `src-tauri/`** (Rust) → it recompiles and restarts the app.
- **Stop** with `Ctrl + C` in Terminal (or close the window).
- **See errors in the UI**: right-click in the window → **Inspect Element** →
  **Console** tab. (Only available in dev mode.)

In the app: any key finishes the startup, `Esc` skips straight to the menu.

**Network Map and the "local network" permission.** The first time you open
Network Map and confirm your network, macOS may ask whether *Terminal* (in dev
mode the request comes from Terminal; for the built app it says *KYN*) may
"find and connect to devices on your local network". Click **Allow**. If you
clicked Don't Allow by accident: System Settings → Privacy & Security →
Local Network, and switch it on there.

## 7. (Optional) The same startup in Terminal

KYN's startup is written as a terminal program, so you can also run it in
the Terminal itself. Make the window big first (full screen works best):

```bash
npm run boot:cli
```

Any key exits. A terminal has only one character size, so it shows a simpler
text version of the logo (the app draws the detailed one). If the window is
too small for the logo, it shows text only.

## 8. (Optional) Preview in a normal browser

Faster for tweaking the look, because no Rust is involved:

```bash
npm run preview
```

Open <http://localhost:5173>. The menu will say "browser preview" instead of
your Mac's hostname, because the Rust side isn't running.

## 9. (Optional) Build a real `.app`

```bash
npm run build
```

When it's done you get:

- `src-tauri/target/release/bundle/macos/KYN.app`: drag it to Applications
- `src-tauri/target/release/bundle/dmg/KYN_0.1.0_aarch64.dmg`: an installer
  image (`x64` instead of `aarch64` on Intel Macs)

Because you built it on your own Mac, it opens normally. If you copy it to
*another* Mac, macOS will block it the first time (it isn't signed with a paid
Apple developer certificate): on that Mac go to **System Settings → Privacy &
Security** and click **Open Anyway**.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `xcrun: error: invalid active developer path` | Step 1 didn't finish. Run `xcode-select --install` again. |
| `cargo: command not found` or `rustc: command not found` | Open a new Terminal window. Still missing? Run `source "$HOME/.cargo/env"`. |
| `npm: command not found` | Node.js isn't installed (step 3), or open a new Terminal window. |
| `tauri: command not found` | Run `npm install` in the project folder first. |
| The window is black and nothing happens | Right-click → Inspect Element → Console, and look for a red error. |
| Disk space | The `src-tauri/target/` build folder grows to a few GB. It's safe to delete; it gets rebuilt. |

## Recommended editor

[VS Code](https://code.visualstudio.com) with the **rust-analyzer** and
**Tauri** extensions (VS Code offers them automatically when you open this
folder, because of `.vscode/extensions.json`).
