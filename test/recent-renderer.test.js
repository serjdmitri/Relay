const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Recent does not offer uncertain or missed scheduled work for one-click replay', async () => {
  const element = () => ({ children: [], style: { setProperty() {} }, classList: { add() {}, remove() {} }, append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }, addEventListener() {}, setAttribute() {}, offsetWidth: 320, offsetHeight: 300 });
  const els = Object.fromEntries(['list', 'count', 'glass', 'outpath'].map((id) => [id, element()]));
  const submitted = [];
  const relay = { getState: async () => ({ history: [
    { text: 'Scheduled: send email', status: 'unknown', ts: Date.now() },
    { text: 'Scheduled: missed task', status: 'missed', ts: Date.now() },
    { text: 'open notes', status: 'done', ts: Date.now() }
  ] }), recentAsk: (text) => submitted.push(text), onRecent() {}, onStateChanged() {}, recentSize() {} };
  const document = { getElementById: (id) => els[id], createElement: element, body: element() };
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/recent.js'), 'utf8');
  vm.runInNewContext(source, { document, relay, ResizeObserver: class { observe() {} }, Date, setTimeout, requestAnimationFrame() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(els.list.children.length, 1);
  els.list.children[0].onclick();
  assert.deepEqual(submitted, ['open notes']);
});
