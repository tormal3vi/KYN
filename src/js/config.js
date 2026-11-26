// ─────────────────────────────────────────────────────────────────────────────
// App identity, boot text and module list.
//
// Everything you read on screen comes from here. To rename the app, change
// `name` (the native app name is also in src-tauri/tauri.conf.json, see the
// README section "Renaming the app").
// ─────────────────────────────────────────────────────────────────────────────

export const APP = {
  name: 'KYN',
  tagline: 'KNOW YOUR NETWORK.',
  version: '0.2.1',
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
    status: 'ready',
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
    status: 'ready',
    blurb: 'Open ports on your own machines, with the risky ones explained in plain language.',
    plan: [
      'Scan common ports on a machine you pick from your Network Map',
      'Explain what each open port is, in plain language',
      'Flag risky ones (Telnet, SMB, exposed databases, remote desktop) and say how to close them',
    ],
  },
  {
    id: 'traffic',
    cmd: 'traffic',
    name: 'Traffic Monitor',
    status: 'next',
    blurb: 'Which apps on this Mac are talking to the internet, and how busy each device on your network is.',
    plan: [
      'Live list of connections from this computer: which app, to where, how much data',
      'Activity levels for the other devices on your network',
      'Exact scope to be agreed before it is built',
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
  ready: { label: 'ready', style: 'strong' },
  next: { label: 'next', style: 'text' },
  planned: { label: 'planned', style: 'gray' },
  locked: { label: 'locked', style: 'faint' },
};
