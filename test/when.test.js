const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, parseWhen, localIso, splitReminder } = require('../src/main/when');

// Saturday, October 17 2026, 3:00 PM local time
const NOW = new Date(2026, 9, 17, 15, 0, 0);
const at = (s) => (s ? localIso(s) : null);

test('durations', () => {
  const cases = { '5 minutes': 300, 'an hour': 3600, 'half an hour': 1800, 'an hour and a half': 5400, '1 hour 30 minutes': 5400, 'ninety seconds': 90, 'twenty five minutes': 1500, 'two and a half minutes': 150, '10 min': 600, 'a minute': 60, 'a quarter of an hour': 900, 'one hour': 3600, 'forty five seconds': 45, '2 hours': 7200 };
  for (const [t, secs] of Object.entries(cases)) assert.equal(parseDuration(t), secs, t);
  for (const t of ['banana', '', 'five', 'minutes minutes', 'call mom']) assert.equal(parseDuration(t), null, t);
});

test('times of day and days', () => {
  const cases = {
    'at 5pm': '2026-10-17T17:00', 'at 5': '2026-10-17T17:00', 'at 5:30': '2026-10-17T17:30', 'at 3pm': '2026-10-18T15:00',
    'tomorrow at 9': '2026-10-18T09:00', 'tomorrow': '2026-10-18T09:00', 'tomorrow morning': '2026-10-18T09:00', 'tomorrow evening': '2026-10-18T18:00',
    'tonight at 8': '2026-10-17T20:00', 'tonight': '2026-10-17T21:00', 'in 2 hours': '2026-10-17T17:00', 'in 10 minutes': '2026-10-17T15:10',
    'next monday at 10am': '2026-10-19T10:00', 'monday': '2026-10-19T09:00', 'on friday at 3pm': '2026-10-23T15:00',
    'noon': '2026-10-18T12:00', 'at 7 in the morning': '2026-10-18T07:00', 'at 9am': '2026-10-18T09:00', 'at 17:45': '2026-10-17T17:45',
    'on october 25th at 2pm': '2026-10-25T14:00', 'the day after tomorrow at 6pm': '2026-10-19T18:00', 'midnight': '2026-10-18T00:00',
    'at five thirty': '2026-10-17T17:30'
  };
  for (const [t, want] of Object.entries(cases)) assert.equal(at(parseWhen(t, NOW)), want, t);
  for (const t of ['banana', 'call mom', 'at', '', 'in a while']) assert.equal(parseWhen(t, NOW), null, t);
});

test('reminders split into what and when, in either order', () => {
  const a = splitReminder('call mom at 5pm', NOW);
  assert.deepEqual([a.what, at(a.when)], ['call mom', '2026-10-17T17:00']);
  const b = splitReminder('to email Sam about the meeting tomorrow at 9', NOW);
  assert.deepEqual([b.what, at(b.when)], ['email Sam about the meeting', '2026-10-18T09:00']);
  const c = splitReminder('in an hour to stretch', NOW);
  assert.deepEqual([c.what, at(c.when)], ['stretch', '2026-10-17T16:00']);
  const d = splitReminder('buy milk', NOW);
  assert.deepEqual([d.what, d.when], ['buy milk', null]);
  const e = splitReminder('pick up the kids at school at 4pm', NOW);
  assert.deepEqual([e.what, at(e.when)], ['pick up the kids at school', '2026-10-17T16:00']);
  const f = splitReminder('take out the trash on friday', NOW);
  assert.deepEqual([f.what, at(f.when)], ['take out the trash', '2026-10-23T09:00']);
});
