# Releases and auto-updates

Once this is set up, you'll install KYN like a normal app (in Applications,
in the Dock, with its icon), and it will update itself whenever you publish a
new version.

## How it works

```
you: npm run release -- 0.2.0     →  a new version number + a git tag "v0.2.0"
you: git push --follow-tags       →  GitHub sees the tag
GitHub Actions (release.yml)      →  builds KYN for Apple Silicon, Intel Macs and Windows,
                                     signs the update files with your private key,
                                     publishes a Release with the installers + latest.json
KYN on your Mac (on start)        →  reads latest.json: "0.2.0 is newer than me"
                                     → menu shows "[+] update v0.2.0 is ready · press u"
you press u                       →  download → check the signature with your public key
                                     → install → restart into the new version
```

**Why the signing key?** So KYN only ever installs updates that *you*
built. The private key (secret, only on your Mac and in GitHub's secret
storage) signs each release; the public key (inside the app, in
`src-tauri/tauri.conf.json`) checks the signature. An update that wasn't
signed with your key is refused.

Development copies (`npm run dev`) never update themselves.

---

## Step 1: one-time setup (on your Mac)

In the project folder:

```bash
npm run setup-updates
```

This:
1. creates your key pair in `~/.tauri/kyn-updater.key` (only the first time),
2. writes the public key into `src-tauri/tauri.conf.json`,
3. copies the private key to your clipboard and prints a link.

Then do what it prints:

**a. Add the private key to GitHub.** Open the printed link
(`https://github.com/tormal3vi/KYN/settings/secrets/actions/new`):
- Name: `TAURI_SIGNING_PRIVATE_KEY`
- Secret: paste (Cmd + V)
- click **Add secret**

**b. Save the public key in the project:**

```bash
git add src-tauri/tauri.conf.json
```
```bash
git commit -m "Set up update signing"
```
```bash
git push
```

**c. Back up `~/.tauri/kyn-updater.key`** (a password manager is a good
place). If it's lost, installed copies of KYN can't receive updates any more
and you'd have to reinstall them by hand.

## Step 2: publish a version

Whenever you want to ship what's in the project:

```bash
npm run release -- 0.2.0
```

(Use a higher number each time: `0.2.0`, then `0.2.1` for fixes, `0.3.0` for
new features.) It updates the version everywhere, commits and tags. Then:

```bash
git push --follow-tags
```

Watch it on GitHub: the repository's **Actions** tab shows the build (about
15 minutes). When it's green, the new version is under **Releases**.

## Step 3: install KYN for real (first time only)

1. On GitHub, open **Releases** → the newest version → **Assets**, and
   download the `.dmg` for your Mac: `aarch64` for Apple Silicon (M1/M2/M3/M4),
   `x64` for Intel. (Apple menu → About This Mac tells you which.)
2. Open the `.dmg` and drag **KYN** into **Applications**.
3. The first time you open it, macOS blocks it, because it isn't signed with a
   paid Apple developer certificate. Go to **System Settings → Privacy &
   Security**, scroll down, and click **Open Anyway** next to the KYN message.
   You only do this once.
4. To keep it in the Dock: while it's open, right-click its Dock icon →
   **Options → Keep in Dock**.

From then on, every time you publish a version (step 2), KYN offers the
update next time you open it. Press `u` in the menu.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The Actions build fails at "check update signing is set up" | Step 1 isn't finished: the GitHub secret is missing, or the public key wasn't pushed. |
| `npm run release` says "uncommitted changes" | Commit (or undo) your changes first, so the release contains exactly what you expect. |
| KYN never shows an update | Only installed copies update (not `npm run dev`). The new version's number must be higher, and its Actions build must have finished. |
| "update failed: ... signature" | The release was signed with a different key than the one inside your installed app. Reinstall from the latest `.dmg` once. |
| Windows says "Windows protected your PC" | Same reason as the macOS warning: click **More info → Run anyway**. |

## The files involved

| File | What it does |
| --- | --- |
| `.github/workflows/release.yml` | the GitHub build that publishes releases |
| `src-tauri/tauri.updater.conf.json` | switches on the signed update files, only for release builds |
| `src-tauri/tauri.conf.json` → `plugins.updater` | your public key and where to look for updates |
| `src-tauri/src/updater.rs` | checks for, downloads, verifies and installs updates |
| `src/js/updates.js`, `src/js/menu.js` | the "update ready / downloading" line and the `u` key |
| `scripts/setup-updates.mjs` | step 1 |
| `scripts/release.mjs` | step 2 |
