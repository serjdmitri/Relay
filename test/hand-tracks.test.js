const test = require('node:test');
const assert = require('node:assert/strict');
const { HandTracks } = require('../src/main/hands/tracks');

test('same-handed people are matched by the best overall positions', () => {
  const t = new HandTracks(2);
  t.update([{ handed: 'Left', x: 0.20, y: 0.5 }, { handed: 'Left', x: 0.40, y: 0.5 }]);
  const closerToSecond = { handed: 'Left', x: 0.33, y: 0.5 };
  const closerToFirst = { handed: 'Left', x: 0.10, y: 0.5 };
  assert.deepEqual(t.update([closerToSecond, closerToFirst]), [closerToFirst, closerToSecond]);
});

test('a briefly missing hand keeps its slot without holding an active cursor', () => {
  const t = new HandTracks(2);
  const left = { handed: 'Left', x: 0.2, y: 0.5 };
  const right = { handed: 'Right', x: 0.8, y: 0.5 };
  t.update([left, right]);
  assert.deepEqual(t.update([right]), [null, right]);
  assert.deepEqual(t.update([right, left]), [left, right]);
});
const hand = (handed, x) => ({ handed, x, y: 0.5, score: 1 });

test('four tracked hands retain separate slots when their order changes', () => {
  const tracks = new HandTracks(4);
  tracks.update([hand('Left', 0.1), hand('Right', 0.3), hand('Left', 0.7), hand('Right', 0.9)]);
  const result = tracks.update([hand('Right', 0.89), hand('Left', 0.69), hand('Right', 0.31), hand('Left', 0.11)]);
  assert.deepEqual(result.map((h) => h.x), [0.11, 0.31, 0.69, 0.89]);
  tracks.reset();
  assert.deepEqual(tracks.slots, [null, null, null, null]);
});

test('two hands with the same handedness keep their cursors when detection order changes', () => {
  const tracks = new HandTracks();
  tracks.update([hand('Left', 0.2), hand('Left', 0.8)]);
  const result = tracks.update([hand('Left', 0.79), hand('Left', 0.21)]);
  assert.equal(result[0].x, 0.21);
  assert.equal(result[1].x, 0.79);
});
test('two hands keep their cursor slots when detector order changes', () => {
  const tracks = new HandTracks();
  const left = hand('Left', 0.2), right = hand('Right', 0.8);
  assert.deepEqual(tracks.update([left, right]), [left, right]);
  assert.deepEqual(tracks.update([right, left]), [left, right]);
  assert.deepEqual(tracks.update([right]), [null, right]);
});
test('unlabelled hands stay with the nearest cursor', () => {
  const tracks = new HandTracks();
  tracks.update([hand('', 0.2), hand('', 0.8)]);
  const a = hand('', 0.25), b = hand('', 0.75);
  assert.deepEqual(tracks.update([b, a]), [a, b]);
});
