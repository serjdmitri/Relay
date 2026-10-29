const test = require('node:test');
const assert = require('node:assert/strict');
const { HandTracks } = require('../src/main/hands/tracks');
const hand = (handed, x) => ({ handed, x, y: 0.5, score: 1 });

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
