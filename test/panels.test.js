const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/main/panels/sources');
const { PanelHub, normalize, approvalText, frameDocument, parsePanelCommand, MAX_PANELS } = require('../src/main/panels/hub');

const cpu = (idle, busy) => [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }];

test('number parsers read the real command output formats', () => {
  assert.equal(S.cpuUsage(cpu(100, 0), cpu(150, 50)), 50);
  assert.equal(S.cpuUsage(cpu(0, 0), cpu(0, 0)), 0);
  const b = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t83%; discharging; 4:12 remaining present: true";
  assert.deepEqual(S.parseBattery(b), { present: true, percent: 83, charging: false, onBattery: true });
  assert.equal(S.parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged; 0:00 remaining").charging, true);
  assert.deepEqual(S.parseBattery("Now drawing from 'AC Power'"), { present: false });
  const ns = 'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll\nlo0   16384 <Link#1>                          100     0     5000      100     0     5000     0\nen0   1500  <Link#6>    aa:bb:cc:dd:ee:ff  1000     0  1000000      500     0   200000     0\nen0   1500  192.168.1     192.168.1.5       1000     -  1000000      500     -   200000     -\nbridge0 1500 <Link#9> aa:bb  1 0 9999 1 0 9999 0';
  assert.deepEqual(S.parseNetstat(ns), { inB: 1000000, outB: 200000 });
  assert.deepEqual(S.parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 976490576 400000000 524288000 44% /'), { present: true, usedPct: 46, freeGb: 500 });
  assert.deepEqual(S.speed({ inB: 0, outB: 0 }, { inB: 2048000, outB: 1024000 }, 2000), { downKBs: 1000, upKBs: 500 });
});

test('the sampler gives each source its numbers, and the first cpu reading is 0', async () => {
  let n = 0;
  const sampler = new S.Sampler({ os: { cpus: () => (n++ ? cpu(150, 50) : cpu(100, 0)), totalmem: () => 16 * 1073741824, freemem: () => 4 * 1073741824 }, exec: async (f) => (/pmset/.test(f) ? "'Battery Power' 50%; discharging;" : ''), jobs: () => [{ text: 'tidy', status: 'running' }] });
  assert.deepEqual(await sampler.sample('cpu'), { percent: 0 });
  assert.deepEqual(await sampler.sample('cpu'), { percent: 50 });
  assert.deepEqual(await sampler.sample('memory'), { percent: 75, usedGb: 12, totalGb: 16 });
  assert.equal((await sampler.sample('battery')).percent, 50);
  assert.deepEqual(await sampler.sample('jobs'), { jobs: [{ text: 'tidy', status: 'running' }] });
  assert.equal(await sampler.sample('nope'), null);
});

test('panel requests are checked: known numbers, host names, size, and plugin panels must exist', () => {
  assert.equal(normalize({ sources: ['cpu', 'battery'] }).spec.kind, 'fixed');
  assert.match(normalize({ sources: ['cpu', 'secrets'] }).error, /Unknown number: secrets/);
  assert.match(normalize({}).error, /which numbers/);
  assert.equal(normalize({ html: '<b>x</b>', sources: ['cpu'], hosts: ['api.weather.gov'] }).spec.kind, 'custom');
  assert.match(normalize({ html: '<b>x</b>', hosts: ['not a host'] }).error, /not a host name/);
  assert.match(normalize({ html: 'x'.repeat(61 * 1024) }).error, /too big/);
  const plugins = [{ name: 'weather', panels: [{ id: 'now', title: 'Now', tool: 'forecast', everySeconds: 30 }] }];
  const p = normalize({ plugin: 'plugin:weather:now' }, { plugins });
  assert.deepEqual([p.spec.kind, p.spec.tool, p.spec.everySeconds, p.spec.title], ['plugin', 'forecast', 30, 'Now']);
  assert.match(normalize({ plugin: 'plugin:weather:nope' }, { plugins }).error, /No installed plugin/);
});

test('a custom panel runs in a locked-down page: only approved hosts, no outside scripts', () => {
  const doc = frameDocument({ html: '<p id=a></p>', hosts: ['api.weather.gov'] });
  assert.match(doc, /default-src &apos;none&apos;|default-src 'none'/);
  assert.match(doc, /connect-src https:\/\/api\.weather\.gov/);
  assert.ok(!/script-src [^;]*https:/.test(doc), 'no script from the internet');
  assert.match(frameDocument({ html: '', hosts: [] }), /connect-src 'none'/);
  assert.match(approvalText({ sources: ['cpu', 'battery'], hosts: ['a.example.com'] }), /reads: CPU use, Battery\. It may contact: a\.example\.com\./);
  assert.match(approvalText({ sources: [], hosts: [] }), /nothing from your Mac\. It cannot use the internet/);
});

function hub(over = {}) {
  const sent = [], closed = [], opened = [];
  const timers = [];
  const h = new PanelHub({
    sampler: { sample: async (s) => ({ s }) }, callPlugin: async () => 'forecast: sunny', getPlugins: () => [{ name: 'weather', panels: [{ id: 'now', title: 'Now', tool: 'forecast', everySeconds: 5 }] }],
    openWindow: ({ id, spec }) => { opened.push(spec); let cb; return { send: (d) => sent.push([id, d]), close: () => closed.push(id), onClosed: (f) => { cb = f; }, fire: () => cb?.() }; },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, ...over
  });
  return { h, sent, closed, opened, timers };
}
const wait = () => new Promise((r) => setTimeout(r, 5));

test('a fixed panel sends the numbers it asked for, on a timer, and nothing else', async () => {
  const { h, sent, timers } = hub();
  const r = await h.show({ title: 'Mac', sources: ['cpu', 'battery'] });
  assert.equal(r.ok, true);
  await wait();
  assert.deepEqual(sent[0][1], { cpu: { s: 'cpu' }, battery: { s: 'battery' } });
  assert.equal(timers[0].ms, 2000);
  assert.deepEqual(h.list(), [{ id: r.id, title: 'Mac', kind: 'fixed' }]);
});

test('a plugin panel calls its tool no faster than the manifest says', async () => {
  const { h, sent, timers } = hub();
  await h.show({ plugin: 'plugin:weather:now' });
  await wait();
  assert.deepEqual(sent[0][1], { text: 'forecast: sunny' });
  assert.equal(timers[0].ms, 5000);
});

test('a model-built panel needs approval the first time, never again for the same page, and again when it changes', async () => {
  let approvals = 0; const ok = new Set();
  const { h } = hub({ approved: (x) => ok.has(x), remember: (x) => ok.add(x), ask: async () => { approvals++; return true; } });
  const spec = { html: '<p>x</p>', sources: ['cpu'], hosts: ['api.weather.gov'] };
  assert.equal((await h.show(spec)).ok, true);
  h.closeAll();
  assert.equal((await h.show(spec)).ok, true);
  assert.equal(approvals, 1);
  h.closeAll();
  assert.equal((await h.show({ ...spec, html: '<p>changed</p>' })).ok, true);
  assert.equal(approvals, 2);
  const no = hub({ ask: async () => false });
  assert.match((await no.h.show(spec)).error, /did not approve/);
  assert.equal(no.opened.length, 0);
});

test('at most four panels, closing works, and panels rest when hidden or the battery is low', async () => {
  const { h, closed, sent } = hub();
  const ids = [];
  for (let i = 0; i < MAX_PANELS; i++) ids.push((await h.show({ sources: ['cpu'] })).id);
  assert.match((await h.show({ sources: ['cpu'] })).error, /already open/);
  assert.equal(h.close(ids[0]), true);
  assert.deepEqual(closed, [ids[0]]);
  await wait(); const before = sent.length;
  h.setHidden(true);
  await h.tick(h.panels.get(ids[1]));
  assert.equal(sent.length, before);
  h.setHidden(false);
  const low = hub({ lowPower: () => true });
  await low.h.show({ sources: ['cpu'] }); await wait();
  assert.equal(low.sent.length, 0);
});

test('a panel whose data keeps failing is closed with the reason', async () => {
  const { h, sent, closed } = hub({ sampler: { sample: async () => { throw new Error('boom'); } } });
  const { id } = await h.show({ sources: ['cpu'] });
  for (let i = 0; i < 6; i++) await h.tick(h.panels.get(id) || { id, busy: false, spec: { sources: ['cpu'] }, win: { send() {} } });
  assert.ok(closed.includes(id));
  assert.ok(sent.some(([, d]) => d.error === 'boom'));
});

test('voice commands for panels', () => {
  assert.deepEqual(parsePanelCommand('close the panel'), { type: 'close' });
  assert.deepEqual(parsePanelCommand('Hey Jarvis, show a system panel'), { type: 'show', title: 'System', sources: ['cpu', 'memory', 'battery', 'network', 'disk'] });
  assert.deepEqual(parsePanelCommand('show my cpu panel'), { type: 'show', title: 'CPU use', sources: ['cpu'] });
  assert.deepEqual(parsePanelCommand('show battery and network stats').sources, ['battery', 'network']);
  assert.equal(parsePanelCommand('show me a picture of a cat'), null);
  assert.equal(parsePanelCommand('open safari'), null);
});

test('dashboard is an allowed source and uses its injected local data', async () => {
  const { Sampler } = require('../src/main/panels/sources');
  const { normalize } = require('../src/main/panels/hub');
  const data = { tasks: [{ text: 'Writing', status: 'running' }], timers: [], events: [], recent: [] };
  const sampler = new Sampler({ os: {}, exec: async () => '', dashboard: () => data });
  assert.deepEqual(await sampler.sample('dashboard'), data);
  assert.equal(normalize({ title: 'Dashboard', sources: ['dashboard'] }).ok, true);
});
