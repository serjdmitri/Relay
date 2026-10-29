const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ExternalDrag } = require('../src/main/hands/externalDrag');
function rig(allowed = true) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = ''; child.stdin.on('data', b => { input += b; });
  const notes = [];
  const drag = new ExternalDrag({ bin: '/fake/relay-ax', allowed: () => allowed, spawnFn: () => child, notify: s => notes.push(s) });
  return { child, drag, notes, lines: () => input.trim().split('\n').filter(Boolean).map(JSON.parse) };
}
test('one hand can drag at a time and releasing sends mouse up', () => {
  const { child, drag, lines } = rig(); drag.start(); child.stdout.write('ready\n');
  const a = {}, b = {}; assert.equal(drag.begin(a, {x: 10, y: 20}), true);
  assert.equal(drag.begin(b, {x: 30, y: 40}), false);
  drag.move(a, {x: 60, y: 70}); drag.end(a);
  assert.deepEqual(lines(), [{op:'down',x:10,y:20},{op:'move',x:60,y:70},{op:'up',x:60,y:70}]);
  drag.close();
});
test('closing releases an active drag and permission denial never starts one', () => {
  const x = rig(); x.drag.start(); x.child.stdout.write('ready\n'); const hand = {};
  x.drag.begin(hand, {x: 2, y: 4}); x.drag.close();
  assert.equal(x.lines().at(-1).op, 'up');
  const y = rig(false); y.drag.start(); assert.equal(y.drag.begin({}, {x: 1, y: 2}), false);
  assert.equal(y.lines().length, 0); assert.match(y.notes[0], /Accessibility/);
});

test('a stalled camera stream releases a held mouse button', async () => {
  const x = rig(); x.drag.watchdogMs = 20; x.drag.start(); x.child.stdout.write('ready\n');
  x.drag.begin({}, {x: 10, y: 20});
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(x.lines().at(-1).op, 'up'); assert.equal(x.drag.owner, null);
  x.drag.close();
});
