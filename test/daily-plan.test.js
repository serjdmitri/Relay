const test = require('node:test');
const assert = require('node:assert/strict');
const { planToday } = require('../src/main/dailyPlan');

test('plan proposes at most three sourced priorities, with overdue reminders first', () => {
  const now = new Date('2026-10-30T10:00:00');
  const result = planToday({ now, due: [{ title: 'Essay' }, { title: 'Pay dues', overdue: true }], school: { assignments: [{ title: 'Essay', due: 'Friday' }, { title: 'Lab', due: 'Monday' }] }, events: [{ title: 'Meeting', start: new Date('2026-10-30T14:00:00') }], missing: ['mail'] });
  assert.match(result, /1\. Pay dues — Reminders, overdue/);
  assert.match(result, /2\. Essay — Reminders, due today/);
  assert.match(result, /3\. Lab — School, due Monday/);
  assert.doesNotMatch(result, /4\./);
  assert.match(result, /Sources unavailable or not configured: mail/);
});

test('plan reports absent priorities and unavailable school without inventing tasks', () => {
  const result = planToday({ now: new Date(), due: [], events: [], school: { problem: 'Unavailable' }, missing: ['calendar'] });
  assert.match(result, /No priorities could be identified/);
  assert.match(result, /calendar, school/);
});
