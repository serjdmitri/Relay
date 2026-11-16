// Codex writes your plan's limits into its own session logs: every token_count event carries rate_limits with a primary window (5 hours) and a secondary one (a week),
// each as { used_percent, window_minutes, resets_at (epoch seconds) }. This reads the newest ones, on this Mac only; nothing is sent anywhere and nothing is written.
const path = require('path');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// One window -> { util 0..1, resetsAt ms, reset }. A window that has already reset says so instead of showing last period's percentage.
function windowOf(w, now) {
  if (!w || num(w.used_percent) === null) return null;
  const resetsAt = num(w.resets_at) !== null ? w.resets_at * 1000 : null;
  if (resetsAt !== null && resetsAt <= now) return { util: 0, resetsAt: null, reset: true, minutes: num(w.window_minutes) };
  return { util: Math.min(1, Math.max(0, w.used_percent / 100)), resetsAt, reset: false, minutes: num(w.window_minutes) };
}

// The newest non-empty rate_limits in one log's text, or null. Lines are JSON; a cut first line (from reading only the end of a big file) is skipped.
function lastLimits(text) {
  const lines = String(text).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"rate_limits"') || !line.includes('used_percent')) continue;
    try {
      const o = JSON.parse(line), rl = o?.payload?.rate_limits || o?.rate_limits;
      if (rl && (rl.primary || rl.secondary)) return { rl, at: Date.parse(o.timestamp) || null };
    } catch { /* a partial line */ }
  }
  return null;
}

// Newest first: years, months and days are folders (2026/11/15), and the file names begin with their time.
function newestLogs(fs, dir, max) {
  const out = [];
  const list = (d) => { try { return fs.readdirSync(d).sort().reverse(); } catch { return []; } };
  for (const y of list(dir)) for (const m of list(path.join(dir, y))) for (const d of list(path.join(dir, y, m))) {
    for (const f of list(path.join(dir, y, m, d))) if (/^rollout-.*\.jsonl$/.test(f)) { out.push(path.join(dir, y, m, d, f)); if (out.length >= max) return out; }
  }
  return out;
}

// -> { five: window|null, week: window|null, ts } or null when Codex has never reported limits here (an API-key login reports none).
function readCodexLimits({ fs = require('fs'), dir = path.join(require('os').homedir(), '.codex', 'sessions'), now = Date.now(), maxFiles = 60, tailBytes = 600000 } = {}) {
  for (const file of newestLogs(fs, dir, maxFiles)) {
    let text;
    try {
      const size = fs.statSync(file).size, fd = fs.openSync(file, 'r');
      try { const len = Math.min(size, tailBytes), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
    } catch { continue; }
    const found = lastLimits(text);
    if (!found) continue;
    const { rl, at } = found;
    // the primary window is the 5-hour one and the secondary the weekly one; go by the window length so a plan that reports them the other way round is still labelled right
    const wins = [windowOf(rl.primary, now), windowOf(rl.secondary, now)].filter(Boolean);
    const five = wins.find((w) => w.minutes && w.minutes <= 600) || null, week = wins.find((w) => w.minutes && w.minutes > 600) || null;
    if (five || week) return { five, week, ts: at };
  }
  return null;
}

module.exports = { readCodexLimits, lastLimits, windowOf, newestLogs };
