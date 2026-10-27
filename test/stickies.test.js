const test = require('node:test');
const assert = require('node:assert/strict');
const { Stickies, parseStickyCommand, COLORS, MAX_STICKIES, slot, W, H } = require('../src/main/stickies');
const { parseQuick, runQuick } = require('../src/main/quick');

function rig() {
  const data = {};
  let n = 0;
  const st = new Stickies({ storage: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, id: () => `s${++n}`, now: () => 1000 });
  let changes = 0;
  st.onChange = () => { changes++; };
  return { st, data, changes: () => changes };
}

test('stickies are made, colored in turn, found by words, changed and removed', () => {
  const { st, data } = rig();
  const a = st.add('Buy milk and eggs');
  const b = st.add('Call the dentist');
  assert.deepEqual([a.color, b.color], [COLORS[0], COLORS[1]]);
  assert.equal(st.add('   '), null);
  assert.deepEqual(st.find('the milk sticky').map((s) => s.id), ['s1']);
  assert.deepEqual(st.find('about dentist').map((s) => s.id), ['s2']);
  assert.deepEqual(st.find('milk dentist'), [], 'every word must be there');
  assert.deepEqual(st.find('sticky'), [], 'filler words alone find nothing');
  st.append('s1', 'and bread');
  assert.equal(st.get('s1').text, 'Buy milk and eggs\nand bread');
  st.move('s2', 100.4, 200.6);
  assert.deepEqual([st.get('s2').x, st.get('s2').y], [100, 201]);
  st.move('s2', NaN, 5);
  assert.equal(st.get('s2').x, 100);
  assert.equal(st.remove('s1').id, 's1');
  assert.equal(st.remove('nope'), null);
  assert.equal(data.stickies.length, 1);
});

test('making a sticky shows them again, clearing can be undone, and there is a limit', () => {
  const { st } = rig();
  st.setHidden(true);
  assert.equal(st.hidden, true);
  st.add('x');
  assert.equal(st.hidden, false);
  const was = st.clear();
  assert.equal(st.items.length, 0);
  st.restore(was);
  assert.equal(st.items.length, 1);
  for (let i = 0; i < MAX_STICKIES + 5; i++) st.add(`n${i}`);
  assert.equal(st.items.length, MAX_STICKIES);
  assert.equal(st.items.at(-1).text, `n${MAX_STICKIES + 4}`, 'the newest are kept');
});

test('spoken commands', () => {
  const P = parseStickyCommand;
  assert.deepEqual(P('make a sticky saying buy milk'), { type: 'sticky-add', text: 'buy milk' });
  assert.deepEqual(P('make me a sticky note that says call mom at five'), { type: 'sticky-add', text: 'call mom at five' });
  assert.deepEqual(P('sticky: pick up the dry cleaning'), { type: 'sticky-add', text: 'pick up the dry cleaning' });
  assert.equal(P('put a post-it about the exam').text, 'the exam');
  assert.equal(P('add a sticky note for tomorrows meeting').text, 'tomorrows meeting');
  assert.equal(P('show my stickies').type, 'sticky-show');
  assert.equal(P('hide my stickies').type, 'sticky-hide');
  assert.equal(P('clear all my stickies').type, 'sticky-clear');
  assert.equal(P('what do my stickies say').type, 'sticky-list');
  assert.deepEqual(P('remove the milk sticky'), { type: 'sticky-remove', query: 'milk' });
  assert.deepEqual(P('delete the sticky about milk'), { type: 'sticky-remove', query: 'milk' });
  assert.deepEqual(P('add eggs to my milk sticky'), { type: 'sticky-append', text: 'eggs', query: 'milk' });
  for (const t of ['make a note buy milk', 'new sticky', 'sticky notes', 'remind me to buy milk', 'open Notes', 'what is a sticky']) assert.equal(P(t), null, t);
});

test('quick commands: the reply, and undo puts it back', async () => {
  assert.equal(parseQuick('make a sticky saying buy milk').type, 'sticky-add');
  let list = [];
  const ctx = { stickies: async (c) => (c.type === 'sticky-add' ? { reply: `made ${c.text}`, undo: async () => 'removed' } : null) };
  const r = await runQuick(parseQuick('make a sticky saying buy milk'), {}, ctx);
  assert.equal(r.reply, 'made buy milk');
  assert.equal(await r.undo(), 'removed');
  assert.equal(await runQuick(parseQuick('make a sticky saying buy milk'), {}, {}), null);
  assert.equal(parseQuick('remind me to buy milk').type, 'reminder', 'reminders are still reminders');
  assert.deepEqual(list, []);
});

test('new stickies stack down the right side, then fill the next column to the left', () => {
  const wa = { x: 0, y: 25, width: 1440, height: 875 };
  const rows = Math.floor((wa.height - 80) / (H + 8));
  assert.deepEqual(slot(0, wa), { x: 1440 - W - 14, y: 71 });
  assert.equal(slot(1, wa).y, 71 + H + 8);
  assert.deepEqual(slot(rows, wa), { x: 1440 - W - 14 - (W + 8), y: 71 });
});
