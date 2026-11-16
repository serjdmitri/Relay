const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeModel, routeCodex, complexity, SIMPLE_BELOW, HARD_ABOVE } = require('../src/main/agent/router');
const { buildArgs } = require('../src/main/agent/codexCli');
const { Store, SCHEMA } = require('../src/main/store');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Codex gets the same tiers as Claude: a simple request starts on low effort and may move up, a harder one starts higher, and a fixed choice is kept', () => {
  assert.deepEqual(routeCodex('what time is it'), { effort: 'low', escalate: true });
  assert.deepEqual(routeCodex('open Safari'), { effort: 'low', escalate: true });
  const medium = 'summarize my unread email and draft a reply to the one from the school';
  assert.ok(complexity(medium) >= SIMPLE_BELOW && complexity(medium) < HARD_ABOVE, 'medium: ' + complexity(medium));
  assert.deepEqual(routeCodex(medium), { effort: 'medium', escalate: false });
  const hard = 'research the three best options for a robotics kit, compare them, write a short plan, schedule the order and email the summary to my coach, then organize every file about it';
  assert.ok(complexity(hard) >= HARD_ABOVE, 'hard: ' + complexity(hard));
  assert.deepEqual(routeCodex(hard), { effort: 'high', escalate: false });
  assert.deepEqual(routeCodex(hard, 'haiku'), { effort: 'low', escalate: false });
  assert.deepEqual(routeCodex('hi', 'sonnet'), { effort: 'medium', escalate: false });
  assert.deepEqual(routeCodex('hi', 'opus'), { effort: 'high', escalate: false });
  assert.equal(routeModel('what time is it', 'auto').model, 'haiku'); assert.equal(routeModel('what time is it', 'auto').escalate, true, 'Claude still starts on Haiku and may move up');
});

test('the effort reaches Codex as a config flag, and the old fast switch still works when no effort is given', () => {
  const base = { port: 1, outFile: '/tmp/x', cwd: '/tmp' };
  for (const e of ['low', 'medium', 'high']) assert.ok(buildArgs({ ...base, effort: e }).includes(`model_reasoning_effort="${e}"`), e);
  assert.ok(buildArgs({ ...base, fast: true }).includes('model_reasoning_effort="low"'));
  assert.equal(buildArgs({ ...base }).indexOf('model_reasoning_effort="low"'), -1, 'neither: Codex keeps its own default');
  assert.ok(!buildArgs({ ...base, effort: 'ultra' }).some((a) => String(a).includes('ultra')), 'an unknown effort is ignored');
  const ask = read('src/main/askController.js');
  assert.match(ask, /const route = routeCodex\(text, this\.store\.get\('settings\.model\.claudeModel'\)\);/);
  assert.match(ask, /if \(route\.escalate && r\.status === 'failed' && !r\.limit && !signal\?\.aborted\) \{ this\.push\(\{ label: 'Thinking harder' \}\); r = await run\('high'\); \}/);
});

test('"Haiku only" is switched to Auto once, so the hand-off to a stronger model works; other choices are left alone', () => {
  const mk = (model) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiers-')); fs.writeFileSync(path.join(dir, 'relay.json'), JSON.stringify({ schema: 3, onboardingDone: true, settings: { model: { provider: 'claude', claudeModel: model } } })); return new Store(dir); };
  assert.equal(SCHEMA, 4);
  assert.equal(mk('haiku').get('settings.model.claudeModel'), 'auto');
  assert.equal(mk('opus').get('settings.model.claudeModel'), 'opus');
  assert.equal(mk('auto').get('settings.model.claudeModel'), 'auto');
  const again = mk('haiku'); again.set('settings.model.claudeModel', 'haiku'); assert.equal(again.get('settings.model.claudeModel'), 'haiku', 'a later deliberate choice is kept');
});

test('a call scheduled by voice dials by itself when calls are ready, and only waits for approval when they are not', () => {
  const main = read('src/main/main.js');
  assert.match(main, /auto = !!\(st\.config\.enabled && st\.ready && !st\.privateMode\);\s*callService\.addSchedule\(\{ \.\.\.command\.spec, automatic: auto \}\);/);
  assert.match(main, /I will ring you myself, within your quiet hours and daily call limits/);
  assert.match(main, /so at that time it will wait for your approval instead of dialing/);
});

test('the build is signed with the same local certificate as the install, so Always Allow for the Keychain keeps applying', () => {
  const dmg = read('scripts/make-dmg.sh');
  assert.match(dmg, /grep -q '"Relay Local Signing"'/);
  assert.match(dmg, /codesign --force --deep --sign "\$SIGN" "\$APP"/);
  assert.doesNotMatch(dmg, /codesign --force --deep --sign - "\$APP"/, 'no unconditional ad-hoc signature');
  assert.match(dmg, /RELAY_ADHOC/);
});
