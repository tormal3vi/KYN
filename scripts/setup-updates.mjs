// One-time setup for auto-updates. Run it on YOUR computer:
//   npm run setup-updates
//
// 1. Creates a signing key pair in ~/.tauri/ (once; it never overwrites it).
//    The private key signs every update you publish; the public key goes into
//    the app, so it only ever installs updates signed by you.
// 2. Puts the public key into src-tauri/tauri.conf.json.
// 3. Copies the private key to your clipboard and tells you where to paste it
//    on GitHub (a repository secret, so the release builds can sign).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const win = process.platform === 'win32';
const dir = join(homedir(), '.tauri');
const key = join(dir, 'kyn-updater.key');
const confUrl = new URL('../src-tauri/tauri.conf.json', import.meta.url);

if (existsSync(key)) {
  console.log(`Using your existing key: ${key}`);
} else {
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(win ? 'npx.cmd' : 'npx', ['tauri', 'signer', 'generate', '-w', key, '--ci'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pub = readFileSync(`${key}.pub`, 'utf8').trim();
const conf = JSON.parse(readFileSync(confUrl, 'utf8'));
const changed = conf.plugins.updater.pubkey !== pub;
conf.plugins.updater.pubkey = pub;
writeFileSync(confUrl, `${JSON.stringify(conf, null, 2)}\n`);

const priv = readFileSync(key, 'utf8').trim();
let copied = false;
try {
  execFileSync(win ? 'clip' : 'pbcopy', { input: priv });
  copied = true;
} catch { /* no clipboard tool: print instructions instead */ }

let repo = 'YOUR-NAME/YOUR-REPO';
try {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  repo = url.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
} catch { /* not a git checkout */ }

console.log(`
Done. Two more steps:

1. Add the private key to GitHub as a secret (the release builds sign with it):
   open https://github.com/${repo}/settings/secrets/actions/new
     Name:   TAURI_SIGNING_PRIVATE_KEY
     Secret: ${copied ? 'paste (it is already on your clipboard)' : `the contents of ${key}`}
   then click "Add secret".

2. ${changed ? 'Save the public key in the project:' : 'The public key is already in the project. If you haven\'t pushed it yet:'}
     git add src-tauri/tauri.conf.json
     git commit -m "Set up update signing"
     git push

Keep a backup of ${key} (for example in your password manager).
If it's lost, installed copies of KYN can't receive updates any more.
`);
