const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHandsCommand } = require('../src/main/hands/words');

test('"hands" and its polite forms open the hand view', () => {
  for (const s of ['hands', 'Hands.', 'hand', 'show my hands', 'show hands', 'open hand control', 'turn on hand tracking', 'hey Jarvis, hands', 'please show me my hands', 'start hand control', 'hands preview'])
    assert.equal(parseHandsCommand(s), 'show', s);
});

test('hide keeps control on; stop turns it off', () => {
  for (const s of ['hide hands', 'close the hand view', 'hide my hands', 'dismiss hand preview']) assert.equal(parseHandsCommand(s), 'hide', s);
  for (const s of ['stop hands', 'turn off hand control', 'disable hand tracking', 'hands off', 'stop hand control']) assert.equal(parseHandsCommand(s), 'off', s);
});

test('anything bigger is left to the rest of Relay', () => {
  for (const s of ['wash my hands', 'give me a hand', 'what is a hand', 'show me a hand model', 'open the hand drawing', 'hands on a clock', 'close', 'show me a skull', '']) assert.equal(parseHandsCommand(s), null, s);
});

test('the gesture guide, calibration, pause and undo use explicit commands', () => {
  assert.equal(parseHandsCommand('show hand gestures'), 'help');
  assert.equal(parseHandsCommand('calibrate hands'), 'calibrate');
  assert.equal(parseHandsCommand('pause hand control'), 'pause');
  assert.equal(parseHandsCommand('resume hand control'), 'resume');
  assert.equal(parseHandsCommand('undo the throw'), 'undo');
});

test('dashboard command is explicit', () => {
  assert.equal(parseHandsCommand('show my dashboard'), 'dashboard');
  assert.equal(parseHandsCommand('open dashboard'), 'dashboard');
});
