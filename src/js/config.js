// ─────────────────────────────────────────────────────────────────────────────
// App identity and module list.
//
// To rename the app, change `name` here. The boot log, logo wordmark, window
// title and menu all read from this file. (The native app name is also set in
// src-tauri/tauri.conf.json, see README "Renaming the app".)
// ─────────────────────────────────────────────────────────────────────────────

export const APP = {
  name: 'GHOSTLINE',          // letters, digits, spaces and - . _ / : ! ? render in the pixel logo
  tagline: 'KNOW YOUR NETWORK',
  version: '0.1.0',
  operator: 'operator',       // the "user" shown in the fake shell prompt
};

// Module status drives the label, colour and boot-log line:
//   ready   = built and usable
//   next    = the one being built now
//   planned = on the list
//   locked  = later / needs hardware
export const MODULES = [
  {
    id: 'netmap',
    cmd: 'netmap',
    name: 'Network Map',
    status: 'next',
    icon: 'netmap',
    blurb: 'Scan your own local network and list every device: IP, MAC, vendor, online or not.',
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
    icon: 'port',
    blurb: 'Check which ports are open on your own machines and flag the risky ones in plain language.',
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
    icon: 'pulse',
    blurb: 'Keep an eye on services you run and raise an alert screen when one goes down.',
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
    icon: 'game',
    bootNote: 'offline game, no real targets',
    blurb: 'Offline game: a made-up target network with simulated scans and node-cracking minigames.',
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
    icon: 'chip',
    bootNote: 'no device attached',
    blurb: 'Front-end for an ESP32 or Flipper Zero you own, tested on things you own.',
    plan: [
      'Talk to your own ESP32 or Flipper Zero over USB',
      'Show sensor readings and logs in the GHOSTLINE interface',
      'Only hardware and devices that belong to you',
    ],
  },
];

export const STATUS_LABEL = {
  ready: 'ONLINE',
  next: 'NEXT BUILD',
  planned: 'PLANNED',
  locked: 'LOCKED',
};
