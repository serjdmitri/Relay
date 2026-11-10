const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { Budget, parseBudgetCommand } = require('../src/main/budget');
const { AskController } = require('../src/main/askController');

const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
function rig(cfg = {}, at = D(2026, 11, 9)) {
  let saved = {}, t = at; const c = { enabled: true, dailyUsd: 1, monthlyUsd: 10, ...cfg };
  const b = new Budget({ load: () => saved, save: (v) => { saved = v; }, cfg: () => c, now: () => t });
  return { b, cfg: c, saved: () => saved, setNow: (v) => { t = v; } };
}

test('costs add up by day and by month, and old days are dropped', () => {
  const r = rig(); r.b.add(0.4); r.b.add(0.25);
  assert.deepEqual(Object.keys(r.saved()), ['2026-11-09']); assert.equal(r.b.totals().today.toFixed(2), '0.65'); assert.equal(r.b.totals().month.toFixed(2), '0.65');
  r.setNow(D(2026, 11, 10)); r.b.add(1);
  assert.equal(r.b.totals().today, 1); assert.equal(r.b.totals().month.toFixed(2), '1.65');
  r.setNow(D(2027, 3, 1)); r.b.add(0.1); assert.deepEqual(Object.keys(r.saved()), ['2027-03-01'], 'older than about two months: gone');
  for (const bad of [NaN, -1, 0, 5000, 'x']) r.b.add(bad);
  assert.equal(r.b.totals().today.toFixed(2), '0.10');
});

test('off by default and when no limit is set; a warning at 80% (once a day); over at the limit; the monthly limit counts too', () => {
  assert.equal(rig({ enabled: false }).b.check().state, 'ok');
  const none = rig({ dailyUsd: 0, monthlyUsd: 0 }); none.b.add(500); assert.equal(none.b.check().state, 'ok');
  const r = rig(); r.b.add(0.5); assert.equal(r.b.check().state, 'ok');
  r.b.add(0.35);
  const w = r.b.check(); assert.equal(w.state, 'warn'); assert.equal(w.which, 'daily'); assert.match(w.text, /at \$0\.85 of your \$1\.00 daily limit/);
  assert.equal(r.b.shouldWarn(w), true); assert.equal(r.b.shouldWarn(w), false, 'said once');
  r.b.add(0.2);
  const o = r.b.check(); assert.equal(o.state, 'over'); assert.match(o.text, /spent \$1\.05 of your \$1\.00 daily limit/);
  r.setNow(D(2026, 11, 10)); assert.equal(r.b.check().state, 'ok', 'a new day starts clean for the daily limit');
  const m = rig({ dailyUsd: 0, monthlyUsd: 2 }); m.b.add(1); m.setNow(D(2026, 11, 20)); m.b.add(1.2);
  assert.equal(m.b.check().which, 'monthly'); assert.equal(m.b.check().state, 'over');
});

test('"ignore the limit for today" lasts for that day only', () => {
  const r = rig(); r.b.add(2); assert.equal(r.b.check().state, 'over');
  r.b.ignoreToday(); assert.equal(r.b.check().state, 'ok');
  r.setNow(D(2026, 11, 10)); r.b.add(2); assert.equal(r.b.check().state, 'over');
});

test('the words: set, ask, turn off and on, ignore', () => {
  const p = parseBudgetCommand;
  assert.deepEqual(p('set my daily limit to 5 dollars'), { type: 'budget-set', which: 'dailyUsd', value: 5 });
  assert.deepEqual(p('Jarvis, set a monthly spending limit of fifty dollars'), { type: 'budget-set', which: 'monthlyUsd', value: 50 });
  assert.deepEqual(p('set my daily spend limit to 7.50 dollars'), { type: 'budget-set', which: 'dailyUsd', value: 7.5 });
  assert.deepEqual(p('set my daily limit to twenty five dollars'), { type: 'budget-set', which: 'dailyUsd', value: 25 });
  assert.deepEqual(p('how much have I spent'), { type: 'budget-status' });
  assert.deepEqual(p('turn off spend limits'), { type: 'budget-off' });
  assert.deepEqual(p('turn on the spending limit'), { type: 'budget-on' });
  assert.deepEqual(p('ignore the limit for today'), { type: 'budget-ignore' });
  for (const no of ['set my daily limit to banana', 'set my alarm limit to 5', 'how much is a coffee', 'set my daily limit to 999999 dollars']) assert.equal(p(no), null, no);
});

test('requests are checked first: with limits off or under nothing happens; at the limit it asks or stops; the cost counts as it arrives', async () => {
  const asked = [], notes = []; let confirm = false;
  const mk = (cfg, spent) => {
    const r = rig(cfg); r.b.add(spent);
    const c = Object.create(AskController.prototype);
    Object.assign(c, { budget: r.b, store: { get: (k) => (k === 'settings.budget' ? r.cfg : undefined) }, notice: (m) => notes.push(m), askConfirm: async (q) => { asked.push(q.question); return confirm; } });
    return c;
  };
  assert.equal(await mk({ enabled: false }, 5).budgetGate(), null);
  assert.equal(await mk({}, 0.1).budgetGate(), null); assert.deepEqual(asked, []);
  assert.equal(await mk({}, 0.85).budgetGate(), null); assert.equal(notes.length, 1, 'the 80% warning');
  const ask = mk({ action: 'ask' }, 1.5);
  const stopped = await ask.budgetGate(); assert.equal(stopped.status, 'stopped'); assert.match(asked[0], /Run this anyway\?/);
  confirm = true; assert.equal(await ask.budgetGate(), null, 'you said yes');
  const block = await mk({ action: 'block' }, 1.5).budgetGate(); assert.equal(block.status, 'stopped'); assert.match(block.reply, /ignore the limit for today/);
  const set = []; const cc = Object.create(AskController.prototype);
  Object.assign(cc, { budget: rig().b, store: { get: () => ({ enabled: false }), set: (k, v) => set.push([k, v]) }, onChange() {} });
  const r = cc.budgetCommand({ type: 'budget-set', which: 'dailyUsd', value: 5 });
  assert.deepEqual(set[0], ['settings.budget', { enabled: true, dailyUsd: 5 }]); assert.match(r.reply, /daily limit is \$5/);
  const src = fs.readFileSync(path.join(__dirname, '../src/main/askController.js'), 'utf8');
  assert.match(src, /this\.budget\?\.add\(c\.cost\)/); assert.match(src, /const g = await this\.budgetGate\(\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/store.js'), 'utf8'), /budget: \{ enabled: false, dailyUsd: 0, monthlyUsd: 0/);
});
