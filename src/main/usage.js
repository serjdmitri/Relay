// What a request cost, shown after it finishes (and never read aloud). Pure functions.

const add = (a, b) => ({ in: (a?.in || 0) + (b?.in || 0), out: (a?.out || 0) + (b?.out || 0), model: b?.model || a?.model || '' });

function tokens(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

// "claude-haiku-5-5" -> "Haiku", "gpt-4o-mini" stays as it is.
function modelName(id) {
  const s = String(id || '');
  const m = s.match(/^claude-(haiku|sonnet|opus|fable)/i);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return s.length > 22 ? `${s.slice(0, 21)}…` : s;
}

function seconds(ms) {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

const money = (c) => (c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`);

// u: { model, ms, in, out, cost, limit: { type, util } }. Parts that are not known are left out.
function usageLine(u) {
  if (!u) return '';
  const parts = [];
  if (u.model) parts.push(modelName(u.model));
  if (u.ms) parts.push(seconds(u.ms));
  if (u.in || u.out) parts.push(`${tokens(u.in || 0)} in · ${tokens(u.out || 0)} out`);
  if (typeof u.cost === 'number' && u.cost > 0) parts.push(`≈ ${money(u.cost)} at API prices`);
  if (u.limit && typeof u.limit.util === 'number') parts.push(`${u.limit.type === 'five_hour' ? '5-hour' : u.limit.type === 'seven_day' ? 'weekly' : 'plan'} limit ${Math.round(u.limit.util * 100)}% used`);
  return parts.join(' · ');
}

// A Claude plan limit must never be presented as a Codex or other provider's limit.
function limitForModel(model, claudeLimit) {
  return /^(?:claude(?:-|$)|haiku(?:-|$)|sonnet(?:-|$)|opus(?:-|$))/i.test(String(model || '')) ? claudeLimit : null;
}

// Recent request counts are not account limits. Only use an explicit Claude
// limit report; Codex's account utilization is not available on this path.
function providerSummaries(history = [], claudeRate = null, now = Date.now()) {
  const rows = Array.isArray(history) ? history : [];
  const last = (predicate) => rows.find((h) => h.usage && predicate(String(h.usage.model || ''))) || null;
  const claude = last((m) => !!limitForModel(m, true));
  const codex = last((m) => /^codex$/i.test(m));
  const rate = claudeRate && Number.isFinite(claudeRate.util) && claudeRate.util >= 0 && claudeRate.util <= 1 && Number.isFinite(claudeRate.ts) && claudeRate.ts <= now && now - claudeRate.ts < 6 * 3600e3 ? { type: claudeRate.type, util: claudeRate.util, ts: claudeRate.ts } : null;
  const view = (h) => h ? { in: h.usage.in || 0, out: h.usage.out || 0, ts: h.finishedAt || h.ts } : null;
  return { claude: { last: view(claude), limit: rate }, codex: { last: view(codex), limit: null } };
}

module.exports = { add, tokens, modelName, seconds, usageLine, limitForModel, providerSummaries };
