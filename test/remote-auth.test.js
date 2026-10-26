const test = require('node:test');
const assert = require('node:assert/strict');
const { Pairing, Devices, isPrivateAddress, hash } = require('../src/main/remote/auth');

test('only home networks, this Mac and Tailscale may connect', () => {
  for (const ok of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '192.168.0.5', '10.1.2.3', '172.16.0.9', '172.31.255.1', '100.101.102.103', '169.254.1.1', 'fd12:3456::1', 'fe80::1']) assert.equal(isPrivateAddress(ok), true, ok);
  for (const no of ['8.8.8.8', '172.32.0.1', '100.63.0.1', '100.128.0.1', '203.0.113.9', '2001:db8::1', '', undefined, 'garbage']) assert.equal(isPrivateAddress(no), false, String(no));
});

test('a pairing code works once, expires, and locks after too many wrong guesses', () => {
  let t = 1000;
  const p = new Pairing({ now: () => t, code: () => '123456' });
  assert.equal(p.check('123456').ok, false, 'nothing started yet');
  p.start();
  assert.equal(p.check('000000').ok, false);
  assert.equal(p.check('123456').ok, true);
  assert.equal(p.check('123456').ok, false, 'used up');
  p.start();
  t += 6 * 60 * 1000;
  assert.equal(p.active(), null, 'expired after five minutes');
  assert.equal(p.check('123456').ok, false);
  p.start();
  for (let i = 0; i < 5; i++) p.check('999999');
  assert.match(p.check('123456').error, /Too many wrong codes/); // even the right one, until the lock ends
  t += 6 * 60 * 1000;
  p.start();
  assert.equal(p.check('123456').ok, true);
});

test('tokens are stored only as hashes and found by their token', () => {
  let list = [];
  const d = new Devices({ list: () => list, save: (l) => { list = l; }, now: () => 5000 });
  const { id, token } = d.add("Sergey's iPhone");
  assert.equal(list[0].hash, hash(token));
  assert.ok(!JSON.stringify(list).includes(token), 'the token itself is never stored');
  assert.equal(d.find(token).id, id);
  assert.equal(d.find('wrong'), null);
  assert.equal(d.find(''), null);
  d.remove(id);
  assert.equal(d.find(token), null);
});
