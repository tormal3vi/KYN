// ─────────────────────────────────────────────────────────────────────────────
// Colours and text styles.
//
// Every colour is one of the standard 256 terminal colours (the `ansi` number),
// and `hex` is exactly how terminals display that number. So the app and a real
// terminal show the same shades. Monochrome on black, one red accent.
// ─────────────────────────────────────────────────────────────────────────────

export const COLORS = {
  flash: { ansi: 231, hex: '#ffffff' },  // only during animations
  bright: { ansi: 255, hex: '#eeeeee' }, // logo mesh, the brightest resting colour
  white: { ansi: 254, hex: '#e4e4e4' },  // highlighted text, "[ KYN ]"
  logo: { ansi: 248, hex: '#a8a8a8' },   // logo mid tones
  muted: { ansi: 247, hex: '#9e9e9e' },  // tagline
  gray: { ansi: 243, hex: '#767676' },   // log lines, secondary text
  faint: { ansi: 238, hex: '#444444' },  // dots, hints
  black: { ansi: 16, hex: '#000000' },
  red: { ansi: 167, hex: '#d75f5f' },    // the cursor: the only colour
};

// Logo brightness levels 0–4 → colour. 4 is a white flash used while animating.
export const TONES = ['faint', 'gray', 'logo', 'bright', 'flash'];

// Named styles used by the screens.
//   bold    = the terminal's bold attribute
//   inverse = swap text and background (terminal "reverse video")
export const STYLES = {
  text: { color: 'white' },
  strong: { color: 'white', bold: true },
  muted: { color: 'muted' },
  gray: { color: 'gray' },
  faint: { color: 'faint' },
  red: { color: 'red' },
  inverse: { color: 'white', inverse: true },
  noise: { color: 'gray' },
  ...Object.fromEntries(TONES.map((c, i) => [`logo-${i}`, { color: c, bold: true }])),
};
