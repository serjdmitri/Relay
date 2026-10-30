const test = require('node:test');
const assert = require('node:assert/strict');
const { schoolUrl, readSchoolPage, extractSchoolAssignments } = require('../src/main/school');

const url = 'https://school.myschoolapp.com/lms-assignment/assignment-center/student';
test('school source accepts only HTTPS assignment-center URLs without credentials or sensitive query strings', () => {
  assert.ok(schoolUrl(url));
  assert.ok(schoolUrl(url + '?svcid=edu'));
  for (const bad of ['http://school.myschoolapp.com/lms-assignment/assignment-center/student', 'https://school.myschoolapp.com.evil.test/lms-assignment/assignment-center/student', 'https://school.myschoolapp.com/lms-assignment/assignment-center/student?token=x', 'https://school.myschoolapp.com/other']) assert.equal(schoolUrl(bad), null);
});

test('reads only the matching open school tab and refuses redirects', async () => {
  const calls = [];
  const bridge = { isConnected: () => true, call: async (method, args) => { calls.push([method, args]); return method === 'tabs.list' ? [{ id: 7, url: url + '?svcid=edu' }] : { url: url + '?svcid=edu', text: 'Assignment Center\nEssay due Friday' }; } };
  assert.deepEqual(await readSchoolPage(bridge, url), { ok: true, text: 'Assignment Center\nEssay due Friday', truncated: false });
  assert.deepEqual(calls, [['tabs.list', {}], ['page.read', { id: 7 }]]);
  bridge.call = async (method) => method === 'tabs.list' ? [{ id: 7, url }] : { url: 'https://app.blackbaud.com/signin/', text: 'Sign in' };
  assert.equal((await readSchoolPage(bridge, url)).reason, 'page-changed');
});

test('missing browser, tab and login are disclosed without claiming an empty list', async () => {
  assert.equal((await readSchoolPage(null, url)).reason, 'browser-disconnected');
  assert.equal((await readSchoolPage({ isConnected: () => true, call: async () => [] }, url)).reason, 'tab-not-open');
  const b = { isConnected: () => true, call: async (method) => method === 'tabs.list' ? [{ id: 1, url }] : { url, text: 'Sign in to continue' } };
  assert.equal((await readSchoolPage(b, url)).reason, 'not-ready');
});

test('assignment extraction accepts only literal titles and due dates from the page', async () => {
  const text = 'Essay\nDue Friday\nLab\nDue Monday';
  const ask = async () => JSON.stringify([{ title: 'Essay', due: 'Friday' }, { title: 'Lab', due: '' }]);
  assert.deepEqual(await extractSchoolAssignments(text, ask), [{ title: 'Essay', due: 'Friday' }, { title: 'Lab', due: '' }]);
  assert.equal(await extractSchoolAssignments(text, async () => '[{"title":"Made up","due":"Friday"}]'), null);
  assert.equal(await extractSchoolAssignments(text, async () => '[{"title":"Essay","due":"tomorrow"}]'), null);
  assert.equal(await extractSchoolAssignments(text, async () => 'not JSON'), null);
});
