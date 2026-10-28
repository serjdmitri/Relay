// "Ask before anything outside my home folder": when this is on, a tool that reads, opens, moves or runs something on a path outside the home
// folder (a drive in /Volumes, /Applications, /etc) asks first. Background agents cannot ask, so they are refused instead. No Electron in here.

const path = require('path');

const PATH_KEYS = /^(?:path|paths|folder|from|to|to_folder|trash|file|files|dir)$/;
// Programs and scratch space are not "your files": using /usr/bin/zip or /tmp does not need a question.
const EXEMPT = [/^\/dev\/(?:null|stdin|stdout|stderr|tty)$/, /^\/(?:usr\/)?s?bin(?:\/|$)/, /^\/usr\/local\/bin(?:\/|$)/, /^\/opt\/homebrew\/bin(?:\/|$)/, /^\/(?:private\/)?tmp(?:\/|$)/, /^\/(?:private\/)?var\/folders(?:\/|$)/];

function resolve(p, home) {
  const s = String(p || '').trim().replace(/^(?:\$HOME|\$\{HOME\})(?=\/|$)/, home).replace(/^~(?=\/|$)/, home);
  return s.startsWith('/') ? path.resolve(s) : null; // relative paths are left alone: they start where Relay runs, in the home folder
}

function outside(p, home) {
  const full = resolve(p, home);
  if (!full || EXEMPT.some((re) => re.test(full))) return false;
  return !(full === home || full.startsWith(home + path.sep));
}

// Every absolute (or ~) path written in a shell command or a script.
function pathsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(?:^|[\s'"=(,;])((?:~|\$HOME|\$\{HOME\}|\/)[^\s'"<>|;&)]*)/g)) if (m[1] !== '/' || out.length === 0) out.push(m[1]);
  return out;
}

function inputPaths(tool, input) {
  const found = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { if (PATH_KEYS.test(key || '')) found.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(input, '');
  if (tool === 'run_shell') found.push(...pathsIn(input?.command));
  if (tool === 'run_applescript') found.push(...pathsIn(input?.script));
  return found;
}

// The paths in this call that are outside the home folder (empty when it is fine).
function outsidePaths(tool, input, home) {
  return [...new Set(inputPaths(tool, input).filter((p) => outside(p, home)))];
}

const say = (list) => list.slice(0, 3).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');

// Wraps tools so each asks first about paths outside home. `enabled()` is read at each call, so the Settings switch applies at once.
function guardTools(tools, { home, enabled = () => true, skip = ['read_file'] } = {}) {
  return tools.map((t) => {
    if (skip.includes(t.name) || !t.input_schema) return t;
    const orig = t.confirm;
    return {
      ...t,
      guarded: true,
      origConfirm: orig,
      outsideHome: (i) => (enabled() ? outsidePaths(t.name, i, home) : []),
      confirm: (i) => {
        const o = enabled() ? outsidePaths(t.name, i, home) : [];
        const base = orig ? orig(i) : null;
        if (!o.length) return base;
        return `That is outside your home folder (${say(o)}). Go ahead?${base ? `\n${base}` : ''}`;
      }
    };
  });
}

// For background agents, which cannot ask: keep a guarded tool only if it had no question of its own, and refuse it outside home.
function agentSafe(t) {
  if (!t.guarded) return !t.confirm ? t : null;
  if (t.origConfirm) return null;
  return { ...t, confirm: undefined, run: (i, ctx) => { const o = t.outsideHome(i); return o.length ? `Not done: ${say(o)} is outside the home folder, and a background agent cannot ask first.` : t.run(i, ctx); } };
}

module.exports = { guardTools, agentSafe, outsidePaths, outside, pathsIn };
