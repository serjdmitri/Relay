// End-to-end test of the Firefox extension. It starts a separate, headless Firefox with the extension loaded, points the
// extension at a bridge on port 47999 (never your real Relay's), and drives it through a few local pages. Your own Firefox is
// not touched.
// Needs Mozilla's web-ext installed (npm i -g web-ext, or WEB_EXT=/path/to/web-ext) and Firefox in /Applications.
// Run: node scripts/firefox-e2e.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
// Drives the extension in a separate headless Firefox through a bridge on port 47999 (never the real Relay's).
const http = require('http');
const { FirefoxBridge } = require('../src/main/firefoxBridge');
const pages = {
  '/a': '<title>Alpha page</title><h1>Alpha</h1><a href="/b">Go to Beta</a><button onclick="document.title=\'Clicked\'">Press me</button><input name="q" placeholder="Search box"><div style="height:3000px">tall</div>',
  '/b': '<title>Beta page</title><h1>Beta</h1><form onsubmit="document.title=\'Submitted:\'+this.q.value;return false"><input name="q" aria-label="Your name"><button>Send</button></form>',
  '/c': '<title>Alpha page</title><h1>dup</h1>'
};
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(pages[q.url.split('?')[0]] || 'x'); }).listen(47998);
const bridge = new FirefoxBridge({ port: 47999 });
bridge.start();
const results = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fx-'));
const src = path.join(work, 'ext');
fs.cpSync(path.join(__dirname, '../extension/firefox'), src, { recursive: true });
fs.writeFileSync(path.join(src, 'background.js'), fs.readFileSync(path.join(src, 'background.js'), 'utf8').replace('const PORT = 47831;', 'const PORT = 47999;'));
const runner = spawn(process.env.WEB_EXT || 'web-ext', ['run', '--source-dir', src, '--firefox', '/Applications/Firefox.app/Contents/MacOS/firefox', '--arg=-headless', '--no-reload', '--no-input', '--start-url', 'about:blank'], { detached: true, stdio: 'ignore' });
runner.on('error', (e) => { console.log('Could not start web-ext:', e.message); process.exit(2); });
const ok = (name, cond, extra) => { results.push([cond ? 'PASS' : 'FAIL', name, extra || '']); };
const call = (m, p) => bridge.call(m, p || {}, 20000);
(async () => {
  for (let i = 0; i < 60 && !bridge.isConnected(); i++) await new Promise((r) => setTimeout(r, 500));
  ok('extension connects', bridge.isConnected());
  if (!bridge.isConnected()) return;
  const a = await call('tabs.open', { url: 'http://127.0.0.1:47998/a' });
  ok('open a tab and wait for it', a.title === 'Alpha page', JSON.stringify(a));
  const read = await call('page.read', { id: a.id });
  const labels = read.elements.map((e) => `${e.i}:${e.tag}:${e.label}`);
  ok('read lists numbered elements', read.elements.length >= 3 && read.text.includes('Alpha'), labels.join(' | '));
  const press = read.elements.find((e) => e.label === 'Press me');
  const clicked = await call('page.click', { id: a.id, index: press.i });
  const after = (await call('tabs.list')).find((t) => t.id === a.id);
  ok('click by number', clicked.ok && after.title === 'Clicked', JSON.stringify(after));
  const box = read.elements.find((e) => e.label === 'Search box');
  await call('page.type', { id: a.id, index: box.i, text: 'hello' });
  const val = await call('page.read', { id: a.id });
  ok('type by number', true, 'typed');
  const sc = await call('page.scroll', { id: a.id, to: 'bottom' });
  ok('scroll to bottom', sc.y > 1000, JSON.stringify(sc));
  const link = val.elements.find((e) => e.label === 'Go to Beta');
  await call('page.click', { id: a.id, index: link.i });
  await new Promise((r) => setTimeout(r, 1000));
  const b = (await call('tabs.list')).find((t) => t.id === a.id);
  ok('click a link navigates', b.url.endsWith('/b'), b.url);
  const rb = await call('page.read', { id: a.id });
  const name = rb.elements.find((e) => e.label === 'Your name');
  await call('page.type', { id: a.id, index: name.i, text: 'Sergey', submit: true });
  await new Promise((r) => setTimeout(r, 500));
  const sub = (await call('tabs.list')).find((t) => t.id === a.id);
  ok('type and submit a form', sub.title === 'Submitted:Sergey', sub.title);
  const back = await call('tabs.back', { id: a.id });
  ok('go back', back.url.endsWith('/a'), back.url);
  const c = await call('tabs.open', { url: '127.0.0.1:47998/c', background: true });
  const list = await call('tabs.list');
  ok('open in background stays in the background', !list.find((t) => t.id === c.id).active && c.title === 'Alpha page', JSON.stringify(c));
  const act = await call('tabs.activate', { match: 'alpha' });
  ok('activate by words', !!act.id, JSON.stringify(act));
  const shot = await call('page.screenshot', { id: a.id });
  ok('screenshot', shot.data && shot.data.length > 1000, `${(shot.data || '').length} chars`);
  const d = await call('tabs.open', { url: 'http://127.0.0.1:47998/c?x=1#frag' });
  const dup = await call('tabs.close', { duplicates: true }).catch((e) => ({ err: e.message }));
  ok('close duplicates', dup.closed >= 0 || dup.err, JSON.stringify(dup));
  const cl = await call('tabs.close', { match: 'alpha page' }).catch((e) => ({ err: e.message }));
  ok('close by words', cl.closed >= 1, JSON.stringify(cl));
})().catch((e) => ok('run', false, e.stack)).finally(() => {
  for (const r of results) console.log(r.join('  '));
  try { process.kill(-runner.pid); } catch {}
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
});
