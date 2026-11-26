// Rebuilds src-tauri/data/oui.tsv: the table that turns the first half of a
// MAC address into a manufacturer name ("a4:83:e7" → "Apple").
// Source: the IEEE registry, via the `oui-data` npm package (BSD-2-Clause).
// Run:  npm run update-oui   (updates the package first, then rebuilds)

import { readFile, writeFile } from 'node:fs/promises';

const src = new URL('../node_modules/oui-data/index.json', import.meta.url);
const out = new URL('../src-tauri/data/oui.tsv', import.meta.url);

// "Apple, Inc." → "Apple", "TP-LINK TECHNOLOGIES CO.,LTD." → "TP-LINK TECHNOLOGIES"
const SUFFIX = /[\s,.]+(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.l\.c|gmbh|ag|s\.?a|b\.?v|n\.?v|oy|ab|a\/s|pty|plc|s\.?r\.?l|s\.?p\.?a|kg|k\.?k|co\.?,?\s*ltd|technologies co|electronics co)\.?$/i;
function shorten(raw) {
  let name = raw.split('\n')[0].replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) name = name.replace(SUFFIX, '').replace(/[\s,.]+$/, '');
  return name;
}

const data = JSON.parse(await readFile(src, 'utf8'));
const lines = Object.keys(data)
  .filter((k) => /^[0-9A-F]{6}$/i.test(k))
  .sort()
  .map((k) => `${k.toUpperCase()}\t${shorten(data[k])}`);
await writeFile(out, `${lines.join('\n')}\n`);
console.log(`wrote ${lines.length} prefixes to src-tauri/data/oui.tsv`);
