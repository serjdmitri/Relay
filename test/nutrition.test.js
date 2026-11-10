const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { parseNutritionCommand: p, estimate, todayEntries, totals } = require('../src/main/nutrition');
const { AskController } = require('../src/main/askController');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('while it is off only the switch-on phrase is understood, so ordinary requests are never taken for food', () => {
  assert.deepEqual(p('turn on nutrition tracking'), { type: 'nutrition-on' });
  for (const t of ['log two eggs and toast', 'I had a chicken salad', 'how many calories today', 'turn off nutrition tracking', 'what have I eaten today']) assert.equal(p(t, { enabled: false }), null, t);
});

test('when it is on: logging with or without calories, the totals, the list, clearing, and not food', () => {
  const on = { enabled: true };
  assert.deepEqual(p('log two eggs and toast', on), { type: 'nutrition-log', food: 'two eggs and toast', kcal: null });
  assert.deepEqual(p('Jarvis, I had a chicken salad, 450 calories', on), { type: 'nutrition-log', food: 'a chicken salad', kcal: 450 });
  assert.deepEqual(p('I just ate an apple', on), { type: 'nutrition-log', food: 'an apple', kcal: null });
  assert.deepEqual(p('how many calories have I had today', on), { type: 'nutrition-total' }); assert.deepEqual(p('what have I eaten today', on), { type: 'nutrition-list' });
  assert.deepEqual(p("clear today's food log", on), { type: 'nutrition-clear' }); assert.deepEqual(p('turn off nutrition tracking', on), { type: 'nutrition-off' });
  for (const t of ['log the music', 'I had a meeting', 'log a call with mom', 'add a reminder to call mom', 'I had an idea']) assert.equal(p(t, on)?.type === 'nutrition-log', false, t);
});

test('the estimate is read from the model\'s JSON, and anything odd gives none', async () => {
  const mk = (text) => ({ step: async () => ({ text }) });
  assert.deepEqual(await estimate({ provider: mk('Sure: {"kcal": 450, "protein": 32}'), food: 'chicken salad' }), { kcal: 450, protein: 32 });
  for (const bad of ['no idea', '{"kcal":0,"protein":0}', '{"kcal":99999}', '{"kcal":"abc"}', '{bad json}']) assert.equal(await estimate({ provider: mk(bad), food: 'x' }), null, bad);
});

test('totals are for today only', () => {
  const now = new Date(2026, 10, 9, 15).getTime(), yest = new Date(2026, 10, 8, 20).getTime();
  const log = [{ ts: now, text: 'a', kcal: 300, protein: 10 }, { ts: now, text: 'b', kcal: 200, protein: 5 }, { ts: yest, text: 'c', kcal: 900, protein: 50 }];
  assert.equal(todayEntries(log, now).length, 2); assert.deepEqual(totals(todayEntries(log, now)), { kcal: 500, protein: 15 });
});

test('the command logs with an estimate (and says so), uses calories you gave, switches on and off, and is off by default', async () => {
  let log = [], cfg = { enabled: false };
  const c = Object.create(AskController.prototype);
  Object.assign(c, { store: { get: (k) => (k === 'settings.nutrition' ? cfg : k === 'nutritionLog' ? log : undefined), set: (k, v) => { if (k === 'nutritionLog') log = v; if (k === 'settings.nutrition') cfg = v; } }, onChange() {}, buildProvider: () => ({ provider: { step: async () => ({ text: '{"kcal":380,"protein":22}' }) } }) });
  assert.match((await c.nutritionCommand({ type: 'nutrition-on' })).reply, /Nutrition tracking is on/); assert.equal(cfg.enabled, true);
  const a = await c.nutritionCommand({ type: 'nutrition-log', food: 'two eggs and toast', kcal: null }); assert.match(a.reply, /about 380 calories \(my estimate\)/); assert.equal(log[0].kcal, 380);
  const b = await c.nutritionCommand({ type: 'nutrition-log', food: 'a salad', kcal: 450 }); assert.match(b.reply, /450 calories\. Today so far: about 830/); assert.ok(!/estimate/.test(b.reply));
  assert.match((await c.nutritionCommand({ type: 'nutrition-total' })).reply, /About 830 calories/);
  assert.match((await c.nutritionCommand({ type: 'nutrition-clear' })).reply, /cleared/); assert.equal(log.length, 0);
  assert.match((await c.nutritionCommand({ type: 'nutrition-off' })).reply, /off/);
  assert.match(read('src/main/store.js'), /nutrition: \{ enabled: false \}/); assert.match(read('src/main/askController.js'), /parseNutritionCommand\(effective, \{ enabled:/);
});
