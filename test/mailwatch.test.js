const test = require('node:test');
const assert = require('node:assert/strict');
const { MailWatch, toEvents, importance, sender, isVip } = require('../src/main/mailWatch');
const { Alerts, scoreEvent, textFor } = require('../src/main/proactive');

const msg = (id, from, subject, labels = ['INBOX', 'UNREAD']) => ({ id, from, subject, labels });

test('the first check of an account only learns what is there; later checks report just the new ones', () => {
  const w = new MailWatch();
  assert.deepEqual(w.update('me@x.com', ['a', 'b'], [msg('a', 'x@y.com', 'old'), msg('b', 'x@y.com', 'old2')]), []);
  const got = w.update('me@x.com', ['c', 'a', 'b'], [msg('c', 'Anna <anna@x.org>', 'Lunch?')]);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'c');
  assert.deepEqual(w.update('me@x.com', ['c', 'a', 'b'], []), [], 'the same mail is not told twice');
  assert.equal(w.known('me@x.com').has('c'), true);
});

test('accounts are tracked separately and the memory survives a restart', () => {
  let saved;
  const w = new MailWatch({ save: (v) => { saved = JSON.parse(JSON.stringify(v)); } });
  w.update('a@x.com', ['1'], []);
  const again = new MailWatch({ load: () => saved });
  assert.deepEqual(again.update('a@x.com', ['2', '1'], [msg('2', 'b@y.com', 'hi')]).map((m) => m.id), ['2']);
  assert.deepEqual(again.update('b@x.com', ['9'], [msg('9', 'b@y.com', 'hi')]), [], 'a new account starts quiet');
});

test('importance: people you named and urgent words rise, advertising stays quiet', () => {
  assert.equal(importance(msg('1', 'Coach Lee <lee@school.org>', 'practice moved'), { vip: ['coach'] }), 0.9);
  assert.ok(importance(msg('2', 'Bank <alerts@bank.com>', 'Security alert on your account')) >= 0.75);
  assert.ok(importance(msg('3', 'Shop <deals@shop.com>', '50% off', ['INBOX', 'CATEGORY_PROMOTIONS'])) < 0.4);
  assert.ok(importance(msg('4', 'GitHub <noreply@github.com>', 'New release')) < 0.4);
  assert.equal(importance(msg('5', 'Anna <anna@x.org>', 'hello')), 0.5);
  assert.deepEqual(sender('"Lee, Coach" <lee@school.org>'), { name: 'Lee, Coach', address: 'lee@school.org' });
  assert.equal(isVip('mom@home.com', ['MOM']), true);
});

test('a few messages are told one by one; a flood becomes one digest', () => {
  const few = toEvents([msg('1', 'Anna <a@x.org>', 'Lunch?'), msg('2', 'Bo <b@x.org>', 'Notes')]);
  assert.equal(few.length, 2);
  assert.equal(textFor(few[0]), 'New email from Anna: Lunch?.');
  const many = toEvents(['a', 'b', 'c', 'd', 'e'].map((x, i) => msg(x, `P${i} <p${i}@x.org>`, 'hi')));
  assert.equal(many.length, 1);
  assert.match(textFor(many[0]), /^5 new emails, from P\d, P\d and P\d and others\.$/);
});

test('the speak-up rules treat mail like any event: urgent is spoken, ordinary is a quiet banner, ads are dropped', () => {
  const al = new Alerts({ now: () => 1000 });
  const urgent = toEvents([msg('u', 'Dean <d@school.org>', 'Interview tomorrow')])[0];
  assert.equal(scoreEvent(urgent) >= 0.75, true);
  assert.equal(al.decide(urgent, { mode: 'silent-urgent' }).how, 'speak');
  const plain = toEvents([msg('p', 'Anna <a@x.org>', 'hello')])[0];
  assert.equal(al.decide(plain, { mode: 'silent-urgent' }).how, 'pill');
  const ad = toEvents([msg('d', 'Shop <deals@shop.com>', 'sale', ['CATEGORY_PROMOTIONS'])])[0];
  assert.equal(al.decide(ad, {}).how, 'drop');
});
