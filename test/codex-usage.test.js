const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCodexLimits, lastLimits, windowOf } = require('../src/main/codexUsage');
const usage = require('../src/main/usage');

const NOW = Date.parse('2026-11-15T12:00:00Z');
const line = (ts, rl) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });
const limits = (five, week) => ({ limit_id: 'codex', primary: { used_percent: five, window_minutes: 300, resets_at: Math.floor(NOW / 1000) + 3600 }, secondary: { used_percent: week, window_minutes: 10080, resets_at: Math.floor(NOW / 1000) + 86400 } });
function logs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexlogs-'));
  for (const [rel, lines] of Object.entries(files)) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, lines.join('\n') + '\n'); }
  return dir;
}

test('the newest reported plan limits are read from Codex\'s own logs: 5-hour and weekly, with when they reset', () => {
  const dir = logs({ '2026/11/15/rollout-2026-11-15T10-00-00-a.jsonl': [line('2026-11-15T10:00:00Z', limits(10, 40)), line('2026-11-15T11:00:00Z', limits(25, 41))] });
  const r = readCodexLimits({ dir, now: NOW });
  assert.equal(Math.round(r.five.util * 100), 25, 'the last report in the log, not the first');
  assert.equal(Math.round(r.week.util * 100), 41);
  assert.equal(r.five.resetsAt, (Math.floor(NOW / 1000) + 3600) * 1000);
  assert.equal(r.ts, Date.parse('2026-11-15T11:00:00Z'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('newer logs that report nothing (a sub-agent run, an API-key login) are skipped; an older report is used and its age is kept', () => {
  const dir = logs({
    '2026/11/13/rollout-2026-11-13T10-00-00-a.jsonl': [line('2026-11-13T10:00:00Z', limits(5, 49))],
    '2026/11/15/rollout-2026-11-15T10-00-00-b.jsonl': [line('2026-11-15T10:00:00Z', null)],
  });
  const r = readCodexLimits({ dir, now: NOW });
  assert.equal(Math.round(r.week.util * 100), 49); assert.equal(r.ts, Date.parse('2026-11-13T10:00:00Z'));
  assert.equal(readCodexLimits({ dir: path.join(dir, 'nothing-here'), now: NOW }), null, 'no logs: unavailable, not zero');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a window that has already reset says so instead of showing last period\'s percentage; windows are told apart by length', () => {
  assert.deepEqual(windowOf({ used_percent: 80, window_minutes: 300, resets_at: Math.floor(NOW / 1000) - 60 }, NOW), { util: 0, resetsAt: null, reset: true, minutes: 300 });
  assert.equal(windowOf({ used_percent: 'x' }, NOW), null);
  const swapped = { primary: { used_percent: 60, window_minutes: 10080, resets_at: Math.floor(NOW / 1000) + 5000 }, secondary: { used_percent: 20, window_minutes: 300, resets_at: Math.floor(NOW / 1000) + 5000 } };
  const dir = logs({ '2026/11/15/rollout-2026-11-15T10-00-00-c.jsonl': [line('2026-11-15T10:00:00Z', swapped)] });
  const r = readCodexLimits({ dir, now: NOW });
  assert.equal(Math.round(r.five.util * 100), 20); assert.equal(Math.round(r.week.util * 100), 60);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a cut first line and broken lines are ignored', () => {
  assert.equal(lastLimits('ed_percent":1}}}\n{"bad json "rate_limits" used_percent\n'), null);
  assert.ok(lastLimits('garbage\n' + line('2026-11-15T10:00:00Z', limits(1, 2)) + '\n{"x":'));
});

test('the panel shows a Claude limit only for Claude and a Codex limit only from Codex; Relay reads logs, it never writes to them', () => {
  assert.equal(usage.limitForModel('codex', { util: 0.5 }), null);
  const src = fs.readFileSync(path.join(__dirname, '../src/main/codexUsage.js'), 'utf8');
  assert.doesNotMatch(src, /writeFile|appendFile|unlinkSync|rmSync|renameSync/);
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  assert.match(app, /esc\(codexLimit\(id, data\) \|\| limit\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), /u\.codex\.limits = publicState\.codexLimits\.v/);
});
