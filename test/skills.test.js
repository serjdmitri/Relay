const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/main/skills');

const good = { name: 'Top memory apps', goal: 'show the five apps using the most memory', kind: 'shell', code: 'ps -Ao comm,rss | sort -k2 -nr | head -5' };

test('a saved skill waits for approval and is not offered until then', () => {
  const r = s.addSkill([], good, { id: 'a', now: 1 });
  assert.equal(r.added, true);
  assert.equal(r.list[0].status, 'pending');
  assert.deepEqual(s.findSkills(r.list, 'which apps use the most memory'), []);
  const ok = s.approveSkill(r.list, 'a');
  assert.deepEqual(s.findSkills(ok, 'which apps use the most memory').map((x) => x.id), ['a']);
  assert.deepEqual(s.findSkills(ok, 'open my calendar'), []);
});

test('secrets, odd kinds, long code and near-duplicates are refused with a reason', () => {
  assert.match(s.addSkill([], { ...good, code: 'curl -H "token=abcd1234efgh5678" x' }).why, /secret/);
  assert.match(s.addSkill([], { ...good, kind: 'python' }).why, /AppleScript and shell/);
  assert.match(s.addSkill([], { ...good, code: 'x'.repeat(5000) }).why, /too long/);
  assert.match(s.addSkill([], { ...good, name: '' }).why, /needs a name/);
  const one = s.addSkill([], good).list;
  assert.match(s.addSkill(one, { ...good, name: 'Top memory apps again' }).why, /already saved/);
});

test('skillText shows the code as an example and says it still asks; use counts go up', () => {
  const list = s.approveSkill(s.addSkill([], good, { id: 'a' }).list, 'a');
  const text = s.skillText(s.findSkills(list, 'apps using memory'));
  assert.match(text, /run_shell/);
  assert.match(text, /ps -Ao comm,rss/);
  assert.match(text, /ask the user as usual/);
  assert.equal(s.skillText([]), 'No saved skill fits this. Solve it normally.');
  assert.equal(s.markUsed(list, ['a'])[0].uses, 1);
  assert.deepEqual(s.removeSkill(list, 'a'), []);
});
