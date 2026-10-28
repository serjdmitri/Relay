const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeviceCommand, parseUsb, parsePorts, classify, describeDevices } = require('../src/main/devices');

const JSON_USB = JSON.stringify({ SPUSBDataType: [{ _name: 'USB31Bus', _items: [
  { _name: 'Arduino Uno', vendor_id: '0x2341', product_id: '0x0043', manufacturer: 'Arduino (www.arduino.cc)', serial_num: '55' },
  { _name: 'USB2.0 Hub', vendor_id: '0x05e3 (Genesys Logic, Inc.)', product_id: '0x0610', _items: [{ _name: 'Logitech F310 Gamepad', vendor_id: '0x046d (Logitech Inc.)', product_id: '0xc216' }, { _name: 'USB2.0-CRW', vendor_id: '0x0bda (Realtek)', product_id: '0x0316' }] },
  { _name: 'Apple Internal Keyboard / Trackpad', vendor_id: '0x05ac (Apple Inc.)', product_id: '0x027e' },
  { _name: 'USB Serial', vendor_id: '0x1a86 (QinHeng Electronics)', product_id: '0x7523' }] }] });

test('the phrases for devices and ports', () => {
  const P = parseDeviceCommand;
  for (const t of ['what devices are connected', "what's plugged in", 'list usb devices', 'what is connected to my mac', 'what usb devices are plugged in', 'detect my boards']) assert.deepEqual(P(t), { type: 'devices', filter: null }, t);
  assert.deepEqual(P('is my arduino plugged in'), { type: 'devices', filter: 'arduino' });
  assert.deepEqual(P('is the roborio connected'), { type: 'devices', filter: 'robot' });
  assert.deepEqual(P('do you see a controller'), { type: 'devices', filter: 'controller' });
  assert.deepEqual(P('which port is my arduino on'), { type: 'devices', filter: 'arduino', ports: true });
  assert.deepEqual(P('what serial ports are there'), { type: 'devices', filter: 'ports', ports: true });
  for (const t of ['what is on my sd card', 'what is the weather', 'is my music playing', 'what time is it']) assert.equal(P(t), null, t);
});

test('system_profiler output becomes a flat list, the Mac itself is left out, and robotics parts are named', () => {
  const usb = parseUsb(JSON_USB);
  assert.deepEqual(usb.map((d) => d.name), ['Arduino Uno', 'USB2.0 Hub', 'Logitech F310 Gamepad', 'USB2.0-CRW', 'Apple Internal Keyboard / Trackpad', 'USB Serial']);
  assert.equal(usb[1].vendor, 'Genesys Logic, Inc.');
  assert.equal(classify(usb[0]).label, 'Arduino');
  assert.equal(classify(usb[2]).kind, 'controller');
  assert.equal(classify(usb[3]).kind, 'storage', 'a card reader');
  assert.equal(classify(usb[4]).kind, 'internal');
  assert.equal(classify(usb[5]).label, 'Arduino-style board (CH340 chip)');
  assert.equal(classify({ name: 'NI roboRIO', vendor: '', vendorId: '3923' }).kind, 'robot');
  assert.deepEqual(parseUsb('not json'), []);
  assert.deepEqual(parseUsb({ SPUSBHostDataType: [{ _name: 'x', vendor_id: '0x2e8a', product_id: '0x000a' }] }).map((d) => d.vendorId), ['2e8a'], 'newer macOS key');
});

test('ports are told apart and the replies say what was found, and what to try when nothing was', () => {
  const ports = parsePorts(['cu.usbmodem1101', 'tty.usbmodem1101', 'cu.Bluetooth-Incoming-Port', 'cu.wchusbserial110', 'cu.debug-console']);
  assert.deepEqual(ports.map((p) => p.path), ['/dev/cu.usbmodem1101', '/dev/cu.wchusbserial110']);
  const usb = parseUsb(JSON_USB);
  const all = describeDevices({ usb, ports });
  assert.match(all.reply, /Boards and adapters: Arduino \(Arduino Uno\)/);
  assert.match(all.reply, /Controllers: Logitech F310 Gamepad/);
  assert.match(all.reply, /Plus 1 USB hub/);
  assert.doesNotMatch(all.reply, /Apple Internal/);
  assert.match(describeDevices({ usb, ports }, { filter: 'arduino' }).reply, /^Yes: Arduino \(Arduino Uno\)/);
  assert.match(describeDevices({ usb: [], ports }, { filter: 'arduino' }).reply, /probably the board/);
  assert.match(describeDevices({ usb: [], ports: [] }, { filter: 'arduino' }).reply, /some only charge/);
  assert.match(describeDevices({ usb, ports }, { filter: 'ports', portsOnly: true }).reply, /2 serial ports: \/dev\/cu\.usbmodem1101, which looks like a board with built-in USB/);
  assert.match(describeDevices({ usb: [], ports: [] }, { filter: 'ports', portsOnly: true }).reply, /no serial ports/);
});
