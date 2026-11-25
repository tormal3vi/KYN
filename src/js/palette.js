// ─────────────────────────────────────────────────────────────────────────────
// Colours and text styles.
//
// Every colour is one of the standard 256 terminal colours (the `ansi` number),
// and `hex` is exactly how terminals display that number. So the app and a real
// terminal show the same shades. Monochrome on black, one red accent.
// ─────────────────────────────────────────────────────────────────────────────

export const COLORS = {
  bright: { ansi: 255, hex: '#eeeeee' }, // logo mesh, the brightest thing on screen
  white: { ansi: 254, hex: '#e4e4e4' },  // highlighted text, "[ KYN ]"
  logo: { ansi: 248, hex: '#a8a8a8' },   // logo mid tones
  muted: { ansi: 247, hex: '#9e9e9e' },  // tagline
  gray: { ansi: 243, hex: '#767676' },   // log lines, secondary text
  dim: { ansi: 241, hex: '#626262' },    // far-off logo streaks
  faint: { ansi: 238, hex: '#444444' },  // dots, hints
  red: { ansi: 167, hex: '#d75f5f' },    // the cursor: the only colour
};

// Named styles used by the screens. bold = the terminal's bold attribute.
export const STYLES = {
  text: { color: 'white' },
  strong: { color: 'white', bold: true },
  muted: { color: 'muted' },
  gray: { color: 'gray' },
  faint: { color: 'faint' },
  red: { color: 'red' },
  // logo tones
  'logo-b': { color: 'bright', bold: true },
  'logo-n': { color: 'logo', bold: true },
  'logo-d': { color: 'dim', bold: true },
  'logo-dot': { color: 'faint', bold: true },
};

/** Style name for one logo character, from its tone letter. */
export function logoStyle(ch, tone) {
  if (ch === '.' || ch === ':') return 'logo-dot';
  return tone === 'b' ? 'logo-b' : tone === 'd' ? 'logo-d' : 'logo-n';
}
