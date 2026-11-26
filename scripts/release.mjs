// Prepare a new version of KYN:   npm run release -- 0.2.0
//
// Writes the new version number into every file that holds it, commits, and
// tags the commit "v0.2.0". Pushing the tag (git push --follow-tags) starts
// the GitHub build that publishes the release and the update (docs/UPDATES.md).

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = process.argv[2];
const fail = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const file = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(file(p), 'utf8');
const write = (p, s) => writeFileSync(file(p), s);

if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail('Usage: npm run release -- 0.2.0   (three numbers: major.minor.patch)');

const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
const current = conf.version;
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
if (!newer(version, current)) fail(`${version} must be newer than the current version ${current}.`);
if (!conf.plugins?.updater?.pubkey) fail('Auto-updates are not set up yet. Run: npm run setup-updates');
if (git('status', '--porcelain')) fail('You have uncommitted changes. Commit or stash them first, so the release contains exactly what you expect.');

// tauri.conf.json: the app's version (the updater compares against this)
conf.version = version;
write('src-tauri/tauri.conf.json', `${JSON.stringify(conf, null, 2)}\n`);

// package.json + package-lock.json
const pkg = JSON.parse(read('package.json'));
pkg.version = version;
write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
const lock = JSON.parse(read('package-lock.json'));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);

// Cargo.toml + Cargo.lock (the [package] version of kyn)
write('src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').replace(/^version = "[^"]+"/m, `version = "${version}"`));
write('src-tauri/Cargo.lock', read('src-tauri/Cargo.lock').replace(/(name = "kyn"\nversion = )"[^"]+"/, `$1"${version}"`));

// what the UI shows
write('src/js/config.js', read('src/js/config.js').replace(/version: '[^']+'/, `version: '${version}'`));

git('add', '-A');
git('commit', '-m', `Release v${version}`);
git('tag', '-a', `v${version}`, '-m', `KYN v${version}`);

console.log(`
Version ${version} is committed and tagged v${version}.
Publish it with:

  git push --follow-tags

Then watch the build on GitHub (Actions tab). After ~15 minutes the release
appears under Releases, and installed copies of KYN offer the update.
`);
