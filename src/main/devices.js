// "What is plugged in?": USB devices and serial ports, with the ones a robotics team cares about named (Arduino and look-alikes, roboRIO, Teensy, Pico, ESP32,
// controllers, SD card readers). The Mac gives the raw lists; this reads them. Pure.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// vendor id (hex, no 0x) -> what it usually is. Names in the device's own text are checked first.
const VENDORS = {
  '2341': ['Arduino', 'board'], '2a03': ['Arduino', 'board'], '1a86': ['Arduino-style board (CH340 chip)', 'board'], '0403': ['FTDI serial adapter', 'board'], '10c4': ['Serial adapter (CP210x chip)', 'board'],
  '16c0': ['Teensy or similar board', 'board'], '2e8a': ['Raspberry Pi Pico', 'board'], '303a': ['ESP32 board', 'board'], '03eb': ['Atmel board', 'board'], '0483': ['STMicro board or ST-Link', 'board'],
  '3923': ['National Instruments roboRIO', 'robot'], '2888': ['VEX Robotics device', 'robot'],
  '045e': ['Xbox controller', 'controller'], '054c': ['PlayStation controller', 'controller'], '057e': ['Nintendo controller', 'controller']
};
const NAMES = [
  [/arduino/i, 'Arduino', 'board'], [/roborio|national instruments/i, 'roboRIO', 'robot'], [/teensy/i, 'Teensy', 'board'], [/\bpico\b/i, 'Raspberry Pi Pico', 'board'], [/esp32|espressif/i, 'ESP32', 'board'],
  [/ch340|ch341|wch/i, 'Arduino-style board (CH340 chip)', 'board'], [/ftdi|ft232/i, 'FTDI serial adapter', 'board'], [/cp210/i, 'Serial adapter (CP210x chip)', 'board'],
  [/gamepad|joystick|controller|xbox|dualshock|dualsense|f310|f710/i, '', 'controller'],
  [/card reader|crw|sd card|sdxc|sdhc|mass storage|flash|ssd|portable|external|usb disk|drive/i, '', 'storage'],
  [/camera|webcam|limelight/i, '', 'camera'], [/keyboard|mouse|trackpad/i, '', 'input'], [/hub/i, '', 'hub']
];

// "what devices are connected", "is my Arduino plugged in", "which port is my Arduino on", "what serial ports are there", "what drives are connected".
function parseDeviceCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  let m;
  if ((m = n.match(/^(?:is|are|do i have|can you see|do you see|can u see) (?:my |the |an? |any )?(arduino|roborio|teensy|pico|esp32|esp|controller|joystick|gamepad|robot|board|microcontroller|serial adapter|usb camera|webcam)s?(?: board)?(?: (?:plugged in|connected|detected|attached|hooked up|there|on))?(?: to (?:the |my )?(?:mac|computer|laptop|usb))?$/))) return { type: 'devices', filter: filterOf(m[1]) };
  if ((m = n.match(/^(?:which|what) (?:usb )?(?:serial )?port (?:is|s) (?:my |the )?(arduino|roborio|teensy|pico|esp32|board|microcontroller|robot)(?: on| using| connected to| plugged into)?$/))) return { type: 'devices', filter: filterOf(m[1]), ports: true };
  if (/^(?:what|which) (?:serial |usb |com )?ports?(?: are| is)?(?: there| available| open| in use| connected| plugged in)?$|^list (?:the |my )?(?:serial |usb )?ports$|^(?:show|list) (?:me )?(?:the |my |all )?serial ports$/.test(n)) return { type: 'devices', filter: 'ports', ports: true };
  if (/^(?:what|which)(?: devices| usb devices| usb| hardware| things| gadgets| peripherals| stuff)?(?: are| is| do i have| have i got)?(?: currently| right now)? (?:connected|plugged in|attached|hooked up)(?: to (?:the |my )?(?:mac|computer|laptop|usb|me))?$|^(?:list|show)(?: me)?(?: all)?(?: the| my)?(?: connected| plugged in| attached)? (?:usb )?(?:devices|hardware|peripherals)(?: connected| plugged in)?$|^what(?:'s| s| is) (?:connected|plugged in|attached)(?: to (?:the |my )?(?:mac|computer|laptop))?$|^detect (?:my |the )?(?:devices|hardware|boards?|robots?)$|^scan (?:for )?(?:usb )?devices$/.test(n)) return { type: 'devices', filter: null };
  return null;
}

function filterOf(w) {
  if (/arduino|board|microcontroller|serial adapter|teensy|pico|esp/.test(w)) return /arduino/.test(w) ? 'arduino' : 'board';
  if (/roborio|robot/.test(w)) return 'robot';
  if (/controller|joystick|gamepad/.test(w)) return 'controller';
  return 'camera';
}

const hex = (s) => String(s || '').replace(/^0x/i, '').split(/\s/)[0].toLowerCase().padStart(4, '0');

// The raw system_profiler JSON (older macOS: SPUSBDataType, newer: SPUSBHostDataType) -> a flat list of devices.
function parseUsb(json) {
  const out = [];
  const walk = (items, parent) => {
    for (const it of items || []) {
      const vendorId = it.vendor_id ? hex(it.vendor_id.replace(/\(.*\)/, '')) : '';
      const vendorName = (String(it.vendor_id || '').match(/\(([^)]+)\)/) || [])[1] || it.manufacturer || '';
      if (vendorId || it.product_id) out.push({ name: String(it._name || 'USB device').trim(), vendor: String(vendorName).trim(), vendorId, productId: it.product_id ? hex(it.product_id) : '', serial: it.serial_num || '', parent });
      walk(it._items, it._name);
    }
  };
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return []; }
  for (const v of Object.values(data || {})) if (Array.isArray(v)) walk(v, '');
  return out;
}

function classify(d) {
  const text = `${d.name} ${d.vendor}`;
  if (d.vendorId === '05ac' && /internal|bluetooth|t2|ibridge|facetime|touch bar|ambient|apple.*(keyboard|trackpad)/i.test(text)) return { label: 'Built into the Mac', kind: 'internal' };
  for (const [re, label, kind] of NAMES.slice(0, 7)) if (re.test(text)) return { label, kind };
  if (VENDORS[d.vendorId]) return { label: VENDORS[d.vendorId][0], kind: VENDORS[d.vendorId][1] };
  for (const [re, label, kind] of NAMES.slice(7)) if (re.test(text)) return { label, kind };
  return { label: '', kind: 'other' };
}

// Serial ports are files in /dev. usbmodem is a board that talks USB itself (Uno R4, Leonardo, Pico, Teensy); usbserial and wchusbserial are adapter chips.
function parsePorts(names) {
  return (names || []).filter((n) => /^cu\.(?:usb|wchusb|SLAB|Bluetooth-Incoming)/i.test(n) && !/Bluetooth/i.test(n)).sort().map((n) => ({
    path: `/dev/${n}`,
    guess: /wchusb/i.test(n) ? 'CH340 adapter (many Arduino clones)' : /usbmodem/i.test(n) ? 'a board with built-in USB (Arduino, Pico, Teensy)' : /SLAB/i.test(n) ? 'CP210x adapter (many ESP32 boards)' : 'USB serial adapter (FTDI or similar)'
  }));
}

const KIND_ORDER = ['robot', 'board', 'controller', 'storage', 'camera', 'other', 'input', 'hub', 'internal'];
const KIND_TITLE = { robot: 'Robot', board: 'Boards and adapters', controller: 'Controllers', storage: 'Storage', camera: 'Cameras', other: 'Other', input: 'Keyboards and mice', hub: 'Hubs', internal: 'In the Mac' };

// { usb: [...], ports: [...] } -> { reply, groups: [{ kind, title, items: [{ name, label, port }] }], found }
function describeDevices({ usb = [], ports = [] }, { filter = null, portsOnly = false } = {}) {
  const rows = usb.map((d) => ({ ...d, ...classify(d) })).filter((d) => d.kind !== 'internal');
  const boardPorts = ports.slice();
  const shown = rows.filter((d) => !(filter && !portsOnly && filter !== 'ports' && !(filter === 'arduino' ? /arduino|ch340|ftdi|cp210|atmel/i.test(d.label) : d.kind === filter || (filter === 'board' && d.kind === 'robot'))));
  const groups = KIND_ORDER.map((kind) => ({ kind, title: KIND_TITLE[kind], items: shown.filter((d) => d.kind === kind && kind !== 'hub').map((d) => ({ name: d.name, label: d.label, vendor: d.vendor, ids: d.vendorId ? `${d.vendorId}:${d.productId}` : '' })) })).filter((g) => g.items.length);
  const hubs = rows.filter((d) => d.kind === 'hub').length;
  const nameOf = (i) => (i.label && i.label !== i.name ? `${i.label} (${i.name})` : i.name);
  const wantBoards = filter === 'arduino' || filter === 'board' || filter === 'robot' || filter === 'ports';
  const portLine = ports.length ? `Serial ports: ${ports.map((p) => `${p.path} (${p.guess})`).join('; ')}.` : 'No serial ports are open';
  if (portsOnly || filter === 'ports') return { reply: ports.length ? `${ports.length === 1 ? 'One serial port' : `${ports.length} serial ports`}: ${ports.map((p) => `${p.path}, which looks like ${p.guess}`).join('; ')}. In the Arduino IDE, pick ${ports.length === 1 ? 'that one' : 'the one that appears when you plug the board in'}.` : 'There are no serial ports. Plug the board in with a data cable (some cables only charge), or try another port.', groups: [], found: ports.length > 0, ports };
  if (filter) {
    const names = groups.flatMap((g) => g.items.map(nameOf));
    if (names.length) return { reply: `Yes: ${names.join('; ')}.${wantBoards && ports.length ? ` ${portLine}` : ''}`, groups, found: true, ports };
    if (wantBoards && ports.length) return { reply: `I do not see it by name, but there ${ports.length === 1 ? 'is a serial port' : 'are serial ports'}: ${ports.map((p) => `${p.path}, which looks like ${p.guess}`).join('; ')}. That is probably the board.`, groups, found: true, ports };
    return { reply: `I do not see one. Check the cable (some only charge, with no data), try another USB port, and look at the board for its power light.`, groups, found: false, ports };
  }
  if (!groups.length) return { reply: `Nothing is plugged into USB except what is built in.${ports.length ? ` ${portLine}` : ''}`, groups, found: false, ports };
  const say = groups.map((g) => `${g.title}: ${g.items.map(nameOf).join(', ')}`).join('. ');
  return { reply: `${say}.${hubs ? ` Plus ${hubs} USB ${hubs === 1 ? 'hub' : 'hubs'}.` : ''}${ports.length ? ` ${portLine}` : ''}`, groups, found: true, ports };
}

module.exports = { parseDeviceCommand, parseUsb, parsePorts, classify, describeDevices };
