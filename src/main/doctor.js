// Relay Doctor: checks that the things Relay needs are working and says, in plain words, what is wrong and what would fix it. Every check is
// a small function over facts the app already has (injected as `env`), so this file never touches the system itself and can be tested whole.
// Fixes are only described here; the app carries them out, and `fixPolicy` says whether one may run without asking.

const CHECK_TIMEOUT_MS = 3000;
const REPO = 'serjdmitri/Relay';

const PANE_LABEL = { accessibility: 'Accessibility', screen: 'Screen Recording', input: 'Input Monitoring', mic: 'Microphone', automation: 'Automation', camera: 'Camera', fulldisk: 'Full Disk Access' };

const ok = (cause = '') => ({ status: 'ok', cause });
const warn = (cause, fix) => ({ status: 'warn', cause, ...(fix ? { fix } : {}) });
const fail = (cause, fix) => ({ status: 'fail', cause, ...(fix ? { fix } : {}) });
const pane = (name) => ({ id: `pane-${name}`, label: `Open ${PANE_LABEL[name] || name} settings`, size: 'big', action: { type: 'pane', name } });

// How the running app is signed, from `codesign -dv --verbose=2` output: adhoc | local (the "Relay Local Signing" certificate) | developer | unknown.
function parseSigning(output) {
  const t = String(output || '');
  if (/Authority=Developer ID Application/.test(t)) return 'developer';
  if (/Authority=Relay Local Signing/.test(t)) return 'local';
  if (/Signature=adhoc/.test(t)) return 'adhoc';
  return 'unknown';
}

const CHECKS = [
  {
    id: 'claude', title: 'Claude sign-in', run: (env) => {
      const c = env.claude?.();
      if (!c || c.checked === false) return warn('Not checked yet. Open Settings > Account once.');
      if (!c.installed) return fail('Claude Code is not installed, so Relay has nothing to think with.', { id: 'copy-claude-install', label: 'Copy the install command', size: 'big', action: { type: 'copy', text: 'npm install -g @anthropic-ai/claude-code' } });
      if (!c.loggedIn) return fail('Claude Code is installed but not signed in.', { id: 'login-claude', label: 'Sign in to Claude', size: 'big', action: { type: 'login', who: 'claude' } });
      return ok(c.email ? `Signed in as ${c.email}` : 'Signed in');
    }
  },
  {
    id: 'codex', title: 'Codex sign-in (backup when Claude is out of usage)', run: (env) => {
      if (env.failoverOn && !env.failoverOn()) return ok('Backup is turned off.');
      const x = env.codex?.();
      if (!x || x.checked === false) return warn('Not checked yet.');
      if (!x.installed) return warn('Codex is not installed. Relay will stop when Claude runs out of usage.');
      if (!x.signedIn) return warn('Codex is installed but not signed in with ChatGPT.', { id: 'login-codex', label: 'Sign in to Codex', size: 'big', action: { type: 'login', who: 'codex' } });
      return x.usable === false ? warn('Codex is signed in but cannot be used (API-key sign-in is not accepted).') : ok('Ready as a backup');
    }
  },
  ...['accessibility', 'screen', 'mic'].map((name) => ({
    id: `perm-${name}`, title: `${PANE_LABEL[name]} permission`, run: (env) => {
      const p = env.perms?.() || {};
      if (p[name]) return ok('Allowed');
      return fail(`${PANE_LABEL[name]} is off for Relay, so ${{ accessibility: 'it cannot click, type or press keys for you', screen: 'it cannot see your screen', mic: 'it cannot hear you' }[name]}.`, pane(name));
    }
  })),
  {
    id: 'perm-camera', title: 'Camera permission', run: (env) => {
      const hands = !!env.handsEnabled?.();
      const presence = !!env.presenceEnabled?.();
      if (!hands && !presence) return ok('Hand control and presence are off.');
      const p = env.perms?.() || {};
      const feature = hands && presence ? 'hand control and presence' : hands ? 'hand control' : 'presence detection';
      return p.camera ? ok(`Allowed for ${feature}.`) : p.cameraStatus === 'not-determined' ? warn(`Camera access is needed for ${feature}.`, pane('camera')) : fail(`Camera access is off, so ${feature} cannot use the camera.`, pane('camera'));
    }
  },
  {
    id: 'browser', title: 'Browser control', run: (env) => {
      const b = env.browser?.();
      if (!b) return warn('Browser connection has not been checked.');
      return b.connected ? ok('Firefox extension connected.') : warn('Firefox extension is not connected. Relay can open sites and switch tabs, but page-reading and clicking require the extension. Open Settings > Permissions for setup.');
    }
  },
  {
    id: 'signing', title: 'App signature', run: (env) => {
      const s = env.signing?.() || 'unknown';
      if (s === 'dev') return ok('Running from source (not packaged).');
      if (s === 'developer') return ok('Signed with a Developer ID. Permissions and Keychain access carry over between updates.');
      if (s === 'local') return ok('Signed with your own "Relay Local Signing" certificate. Permissions carry over when you rebuild.');
      if (s === 'adhoc') return warn('Ad-hoc signed. macOS treats every update as a different app, so it asks again for the Keychain and your permissions after each one. To stop that on your own Mac, run "npm run signing" once and build with "npm run pack".', { id: 'copy-signing', label: 'Copy the signing command', size: 'big', action: { type: 'copy', text: 'npm run signing' } });
      return warn('Could not tell how Relay is signed.');
    }
  },
  {
    id: 'remote', title: 'Phone connection', run: (env) => {
      const r = env.remote?.();
      if (!r || !r.enabled) return ok('Relay Remote is off.');
      if (r.error) return fail(`The phone server could not start: ${r.error}`, { id: 'restart-remote', label: 'Restart the phone server', size: 'small', action: { type: 'restart-remote' } });
      if (!r.running) return fail('Relay Remote is on but the server is not running.', { id: 'restart-remote', label: 'Restart the phone server', size: 'small', action: { type: 'restart-remote' } });
      if (!(r.urls || []).length) return warn('The phone server is running but has no address your phone can reach.');
      return ok(`Running. ${(r.devices || []).length} phone${(r.devices || []).length === 1 ? '' : 's'} paired.`);
    }
  },
  {
    id: 'imessage', title: 'Command Relay by text', run: (env) => {
      const m = env.imessage?.();
      if (!m || !m.on) return ok('Off.');
      if (m.fullDisk === false) return fail('Full Disk Access is off, so Relay cannot read your messages. macOS asks for it again after an update if Relay is ad-hoc signed.', pane('fulldisk'));
      if (m.error) return warn(`Last read failed: ${m.error}`);
      if (!m.paired) return warn('Not paired yet. Open Settings > Doctor and show a pairing code, then text it to yourself.');
      if (m.unreadable > 0) return warn(`${m.unreadable} of your texts had no readable words and were skipped.`);
      return ok('Paired and reading your own thread.');
    }
  },
  {
    id: 'tools', title: 'Fewer tools per request', run: (env) => {
      const m = env.toolMisses?.();
      if (!m || !m.on) return ok('Off.');
      if (!m.recent.length) return ok('No tool group had to be asked for in the last day.');
      const by = {}; for (const x of m.recent) by[x.group] = (by[x.group] || 0) + 1;
      return ok(`The model asked for a hidden tool group ${m.recent.length} time${m.recent.length === 1 ? '' : 's'} in the last day: ${Object.entries(by).map(([g, n]) => `${g} ${n}`).join(', ')}. If one keeps coming up, tell me and I will show that group by default.`);
    }
  },
  {
    id: 'offline', title: 'Offline mode', run: (env) => {
      const m = env.offline?.();
      if (!m || !m.on) return ok('Off.');
      if (m.ollama === false) return warn('Ollama is not running, so offline Relay can only say it needs the internet. Install Ollama (ollama.com) and start it, then pull the model chosen in Account.');
      return ok(`${m.online ? 'Online' : 'Offline right now'}; a local model is ready.`);
    }
  },
  {
    id: 'notes', title: 'Ask my notes', run: (env) => {
      const m = env.notes?.();
      if (!m || !m.on) return ok('Off.');
      if (!m.folders.length) return warn('No folders added yet. Add one in Settings > Doctor > Ask my notes.');
      if (m.noEmbed) return warn('The on-device search helper is not available, so notes are searched by matching words, not meaning. Rebuild Relay with "npm run speech" on your Mac to add it.');
      const big = m.folders.filter((f) => f.truncated);
      if (big.length) return warn(`${big.map((f) => f.path.split('/').pop()).join(', ')} is too big to index fully; only the first part is searchable.`);
      return ok(`${m.folders.length} folder${m.folders.length === 1 ? '' : 's'}, searching by meaning.`);
    }
  },
  {
    id: 'plugins', title: 'Plugins', run: (env) => {
      const m = env.plugins?.();
      if (!m || !m.on) return ok('Off.');
      const bad = (m.list || []).filter((p) => !p.ok);
      if (bad.length) return fail(`${bad.map((p) => p.name).join(', ')} ${bad.length === 1 ? 'is' : 'are'} damaged or missing: ${bad[0].error}`);
      const changed = (m.list || []).filter((p) => p.enabled && p.changed);
      if (changed.length) return warn(`${changed.map((p) => p.name).join(', ')} changed since you approved ${changed.length === 1 ? 'it' : 'them'}, so ${changed.length === 1 ? 'it is' : 'they are'} not used. Install again to approve the change.`);
      if (!m.sandbox) return warn(`${(m.list || []).length} installed. The macOS sandbox is unavailable: plugins can access files and network beyond their declared permissions.`);
      return ok(`${(m.list || []).length} installed. The macOS sandbox limits access on a best-effort basis; declared network access is not restricted to specific hosts.`);
    }
  },
  {
    id: 'hotkeys', title: 'Shortcuts', run: (env) => {
      const h = env.hotkeys?.() || {};
      if (h.error) return fail(`The global shortcuts are not working: ${h.error}`, pane('input'));
      if (h.running === false) return warn('The shortcut listener is not running.');
      return ok('Listening');
    }
  },
  {
    id: 'speech', title: 'Speech', run: (env) => {
      const s = env.speech?.() || {};
      if (s.available === false) return warn('Apple speech recognition is not available, so dictation will not work.');
      if (s.voiceProblem) return warn(`The chosen voice could not speak the last reply: ${s.voiceProblem}`);
      return ok('Available');
    }
  },
  {
    id: 'store', title: 'Saved settings', run: (env) => {
      const s = env.storeInfo?.() || {};
      if (s.error) return fail(`Settings could not be read: ${s.error}`);
      if (s.freeMb != null && s.freeMb < 200) return warn(`Only ${s.freeMb} MB of disk space is free.`);
      return ok(s.freeMb != null ? `${s.freeMb} MB free` : 'Readable');
    }
  },
  {
    id: 'errors', title: 'Recent errors', run: (env) => {
      const list = env.recentErrors?.() || [];
      if (!list.length) return ok('None in the last day.');
      return warn(`${list.length} failed action${list.length === 1 ? '' : 's'} in the last day, most recent: ${list[0].tool || 'unknown'}${list[0].error ? ` (${String(list[0].error).slice(0, 80)})` : ''}`);
    }
  }
];

const timed = (fn, ms) => new Promise((resolve) => {
  const t = setTimeout(() => resolve({ status: 'warn', cause: 'Timed out.' }), ms);
  Promise.resolve().then(fn).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); resolve({ status: 'fail', cause: `Check failed (${e?.name || 'Error'}).` }); });
});

// Runs every check (each with its own timeout). Two overlapping runs share one result.
let inFlight = null;
function runChecks(env, { extra = [], timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  if (inFlight) return inFlight;
  inFlight = Promise.all([...CHECKS, ...extra].map(async (c) => {
    const r = await timed(() => c.run(env), timeoutMs);
    return { id: c.id, title: c.title, ...r };
  })).finally(() => { inFlight = null; });
  return inFlight;
}

const RANK = { ok: 0, warn: 1, fail: 2 };
const worst = (results) => results.reduce((w, r) => (RANK[r.status] > RANK[w] ? r.status : w), 'ok');

// May this fix run now? mode: ask (default) | small (small ones run themselves) | never. Big fixes always ask; "never" runs nothing.
function fixPolicy(mode, fix) {
  if (!fix) return 'none';
  if (mode === 'never') return 'none';
  if (fix.size === 'small' && mode === 'small') return 'auto';
  return 'ask';
}

// Text that is safe to paste to someone else: the home folder, email addresses, keys and tokens, query strings and addresses on your network are removed.
function scrub(text, { home = '' } = {}) {
  let t = String(text ?? '');
  if (home && home.length > 1) t = t.split(home).join('~');
  t = t.replace(/\/Users\/[^/\s]+/g, '~');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  t = t.replace(/\b(?:sk|pk|hf|ghp|gho|xox[bap]|AIza)[-_A-Za-z0-9]{12,}/g, '[key]');
  t = t.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [key]');
  t = t.replace(/\b[A-Fa-f0-9]{32,}\b/g, '[key]');
  t = t.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[key]');
  t = t.replace(/\b[\w-]+\.[\w-]+\.ts\.net\b/g, '[tailscale-name]');
  t = t.replace(/\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+(?:\.\d+)?\b/g, '[local-address]');
  t = t.replace(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/g, '[local-address]');
  t = t.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1?[removed]');
  return t;
}

function buildReport(results, meta = {}, scrubOpts = {}) {
  const icon = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };
  const lines = [
    `Relay ${meta.version || '?'} on macOS ${meta.os || '?'} (${meta.arch || '?'})`,
    `Signature: ${meta.signing || 'unknown'}`,
    `Overall: ${worst(results).toUpperCase()}`,
    '',
    ...results.map((r) => `${icon[r.status]} ${r.title}: ${r.cause || ''}`.trimEnd())
  ];
  if (meta.flags?.length) lines.push('', `Experimental on: ${meta.flags.join(', ')}`);
  if (meta.errors?.length) lines.push('', 'Recent errors:', ...meta.errors.slice(0, 5).map((e) => `- ${e.tool || 'unknown'}: ${String(e.error || '').slice(0, 160)}`));
  return scrub(lines.join('\n'), scrubOpts);
}

// A GitHub new-issue address with a short title and body. The full report goes on the clipboard (addresses have a length limit); the person
// presses submit on GitHub, so Relay never holds a GitHub token.
function issueUrl(kind, { title = '', version = '' } = {}) {
  const bug = kind !== 'feature';
  const head = String(title).replace(/\s+/g, ' ').trim().slice(0, 80) || (bug ? 'Something is not working' : 'I would like Relay to');
  const body = bug
    ? `**What happened**\n\n\n**What I expected**\n\n\n**Relay Doctor report** (paste it here, it was copied to your clipboard)\n\n\nRelay ${version}`
    : `**What I would like**\n\n\n**Why it would help**\n\n\nRelay ${version}`;
  const q = new URLSearchParams({ title: bug ? `Bug: ${head}` : `Feature: ${head}`, body, labels: bug ? 'bug' : 'enhancement' });
  return `https://github.com/${REPO}/issues/new?${q}`;
}

// "Run the doctor", "check yourself", "what's wrong with Relay". Returns true for a request to run the checks.
function parseDoctorCommand(text) {
  const t = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '');
  const n = t.replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '');
  return /^(?:run|start|open) (?:the |relay )?(?:doctor|diagnostics|health check|self[- ]?check)$/i.test(n)
    || /^(?:run |do )?(?:a )?(?:health check|self[- ]?check|diagnostic|diagnostics)(?: on (?:yourself|relay))?$/i.test(n)
    || /^check (?:yourself|your health|relay(?:'s)? health)$/i.test(n)
    || /^what(?:'s| is) wrong with (?:you|relay)$/i.test(n)
    || /^diagnose (?:yourself|relay|jarvis)$/i.test(n)
    || /^fix (?:yourself|relay|jarvis)$/i.test(n);
}

// One or two spoken sentences from the results.
function summarize(results) {
  const bad = results.filter((r) => r.status !== 'ok');
  if (!bad.length) return 'Everything checks out.';
  const order = [...bad.filter((r) => r.status === 'fail'), ...bad.filter((r) => r.status === 'warn')];
  const first = order.slice(0, 2).map((r) => `${r.title}: ${r.cause}`).join(' ');
  const more = order.length > 2 ? ` And ${order.length - 2} more in Settings, Doctor.` : ' Details are in Settings, Doctor.';
  return `${order.length} thing${order.length === 1 ? ' needs' : 's need'} a look. ${first}${more}`;
}

module.exports = { parseDoctorCommand, summarize, CHECKS, runChecks, worst, fixPolicy, scrub, buildReport, issueUrl, parseSigning, REPO };
