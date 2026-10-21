const test = require('node:test');
const assert = require('node:assert/strict');
const { ShortcutMatcher, label } = require('../src/main/shortcuts');

function harness(shortcuts) {
  const events = [];
  let t = 0;
  const timers = [];
  const m = new ShortcutMatcher({
    getShortcuts: () => shortcuts,
    emit: (name, kind) => events.push(`${name}:${kind}`),
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, live: true }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.live = false; },
    now: () => t
  });
  const advance = (ms) => { t += ms; timers.filter((h) => h.live && h.at <= t).forEach((h) => { h.live = false; h.fn(); }); };
  return { m, events, advance };
}

const sc = { ask: { code: 'AltRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } };

test('quick press of right option is a tap', () => {
  const { m, events, advance } = harness(sc);
  m.handle('down', 'AltRight');
  advance(100);
  m.handle('up', 'AltRight');
  assert.deepEqual(events, ['ask:tap']);
});

test('holding emits hold-start then hold-end', () => {
  const { m, events, advance } = harness(sc);
  m.handle('down', 'AltRight');
  advance(300);
  advance(1000);
  m.handle('up', 'AltRight');
  assert.deepEqual(events, ['ask:hold-start', 'ask:hold-end']);
});

test('option+T fires type, and does not count as an ask tap', () => {
  const { m, events, advance } = harness(sc);
  m.handle('down', 'AltLeft');
  m.handle('down', 'KeyT');
  m.handle('up', 'KeyT');
  advance(50);
  m.handle('up', 'AltLeft');
  assert.deepEqual(events, ['type:press']);
});

test('right option used as a modifier for another key is cancelled', () => {
  const { m, events, advance } = harness(sc);
  m.handle('down', 'AltRight');
  m.handle('down', 'KeyA');
  advance(500);
  m.handle('up', 'KeyA');
  m.handle('up', 'AltRight');
  assert.deepEqual(events, []);
});

test('key repeat is ignored and slow release after tap window is not a tap', () => {
  const { m, events, advance } = harness({ ask: { code: 'AltRight', mods: [] }, type: null });
  m.handle('down', 'AltRight');
  m.handle('down', 'AltRight');
  advance(200);
  m.handle('up', 'AltRight');
  assert.deepEqual(events, ['ask:tap']);
});

const sc3 = { ask: { code: 'AltRight', mods: [] }, dictate: { code: 'MetaRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } };

test('right command is its own dictate shortcut next to right option', () => {
  const { m, events, advance } = harness(sc3);
  m.handle('down', 'MetaRight');
  advance(100);
  m.handle('up', 'MetaRight');
  m.handle('down', 'AltRight');
  advance(400);
  m.handle('up', 'AltRight');
  assert.deepEqual(events, ['dictate:tap', 'ask:hold-start', 'ask:hold-end']);
});

test('pressing another key after the hold started ends the hold instead of leaving it open', () => {
  const { m, events, advance } = harness(sc3);
  m.handle('down', 'MetaRight');
  advance(400);
  m.handle('down', 'KeyV');
  m.handle('up', 'KeyV');
  m.handle('up', 'MetaRight');
  assert.deepEqual(events, ['dictate:hold-start', 'dictate:hold-end']);
});

test('escape emits cancel', () => {
  const { m, events } = harness(sc3);
  m.handle('down', 'Escape');
  m.handle('up', 'Escape');
  assert.deepEqual(events, ['cancel:press']);
});

test('labels', () => {
  assert.equal(label({ code: 'AltRight', mods: [] }), 'Right ⌥');
  assert.equal(label({ code: 'KeyT', mods: ['Alt'] }), '⌥T');
  assert.equal(label({ code: 'Space', mods: ['Meta', 'Shift'] }), '⇧⌘Space'.replace('⇧⌘', '⌘⇧'));
});
