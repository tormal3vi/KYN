// ─────────────────────────────────────────────────────────────────────────────
// App identity, boot text and module list.
//
// Everything you read on screen comes from here. To rename the app, change
// `name` (the native app name is also in src-tauri/tauri.conf.json, see the
// README section "Renaming the app").
// ─────────────────────────────────────────────────────────────────────────────

export const APP = {
  name: 'KYN',
  tagline: 'DECENTRALIZED BY NATURE.',
  version: '0.1.0',
  command: 'kyn', // shown in the fake shell prompt: "$ kyn netmap"
};

// The startup log. Lines ending in "..." animate their dots while "working".
// The last line is printed brighter, as the result.
export const BOOT_LINES = [
  `Initializing ${APP.name} protocol...`,
  'Establishing mesh network...',
  'Verifying identity...',
  'Connection successful.',
];

// Module status decides the label and colour in the menu:
//   ready = built and usable · next = being built now
//   planned = on the list    · locked = later / needs hardware
export const MODULES = [
  {
    id: 'netmap',
    cmd: 'netmap',
    name: 'Network Map',
    status: 'next',
    blurb: 'Scan your own local network: every device with IP, MAC, vendor, online or not.',
    plan: [
      'Detect your subnet automatically (for example 192.168.1.0/24)',
      'Find every device that answers on your home network',
      'Show IP address, MAC address and manufacturer, looked up offline from the MAC',
      'Mark devices online or offline and when each was last seen',
      'Let you name your own devices, so anything unknown stands out',
    ],
  },
  {
    id: 'portaudit',
    cmd: 'portaudit',
    name: 'Port Audit',
    status: 'planned',
    blurb: 'Open ports on your own machines, with the risky ones explained in plain language.',
    plan: [
      'Scan common ports on a machine you pick from your Network Map',
      'Explain what each open port is, in plain language',
      'Flag risky ones (Telnet, SMB, exposed databases, remote desktop) and say how to close them',
    ],
  },
  {
    id: 'watchdog',
    cmd: 'watchdog',
    name: 'Watchdog',
    status: 'planned',
    blurb: 'Ping the services you run and raise an alert when one goes down.',
    plan: [
      'Add your own services: a website URL or a host and port',
      'Check them on a timer and keep a short uptime history',
      'Full-screen alert when something you run stops answering',
    ],
  },
  {
    id: 'sim',
    cmd: 'sim',
    name: 'Hack Sim',
    status: 'locked',
    blurb: 'Offline game: a made-up network with simulated scans. No real targets.',
    plan: [
      'A fictional city network that exists only inside the app',
      'Simulated scans and exploits: no real packets ever leave your machine',
      'Crack-the-node minigames with timers and trace meters',
    ],
  },
  {
    id: 'hardware',
    cmd: 'hwlink',
    name: 'Hardware Link',
    status: 'locked',
    blurb: 'Front-end for an ESP32 or Flipper Zero you own, tested on things you own.',
    plan: [
      'Talk to your own ESP32 or Flipper Zero over USB',
      'Show sensor readings and logs in the KYN interface',
      'Only hardware and devices that belong to you',
    ],
  },
];

export const STATUS = {
  ready: { label: 'online', style: 'strong' },
  next: { label: 'next', style: 'text' },
  planned: { label: 'planned', style: 'gray' },
  locked: { label: 'locked', style: 'faint' },
};
