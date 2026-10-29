/* global relay, icon, glyph, ICONS, LOGO, COLORS, h, esc, timeAgo, MOD_CODES, modsFromEvent */
let S = null; // latest state from main
let page = new URLSearchParams(location.search).get('page') || 'home';
let historyTab = 'requests';
let cxBusy = false;
if (page === 'recap') { page = 'history'; historyTab = 'actions'; }
let dictQuery = '';
let range = 'all';
let perms = { accessibility: false, screen: false, mic: false, micStatus: 'unknown' };
let capturing = null; // which shortcut is being recorded
let loginBusy = false;
let loginError = '';
let modelTest = '';
let vocabPrefill = '';
let locales = null;
let appIcons = {};
function setCapturing(v) {
  const was = !!capturing;
  capturing = v;
  if (was !== !!v) relay.setCapturing(!!v);
}
let doctorData = null;
let doctorBusy = false;
const automation = JSON.parse(localStorage.getItem('automation') || '{}');

const NAV = [
  [['home', 'Home'], ['history', 'History'], ['routines', 'Routines'], ['vocab', 'Vocabulary'], ['memory', 'Memory'], ['connectors', 'Connectors'], ['remote', 'Remote']],
  [['general', 'General'], ['speech', 'Speech'], ['shortcuts', 'Shortcuts'], ['permissions', 'Permissions'], ['doctor', 'Doctor']],
  [['account', 'Account']]
];
const TITLES = Object.fromEntries(NAV.flat());
const NAV_GLYPH = { home: 'home', history: 'history', routines: 'routines', vocab: 'vocab', memory: 'memory', connectors: 'connectors', remote: 'remote', general: 'general', speech: 'speech', shortcuts: 'shortcuts', permissions: 'permissions', doctor: 'permissions', account: 'account' };

const $ = (sel, root = document) => root.querySelector(sel);

function ready() {
  if (!S) return { ok: false, text: 'Loading' };
  if (!S.hotkeysRunning) return { ok: false, text: 'Shortcuts off' };
  const m = S.settings.model;
  if (m.provider === 'claude') {
    if (S.claude.checked && !S.claude.installed) return { ok: false, text: 'Install Claude Code' };
    if (S.claude.checked && !S.claude.loggedIn) return { ok: false, text: 'Sign in to Claude' };
  }
  if (m.provider === 'anthropic' && !S.hasKey) return { ok: false, text: 'Add a model key' };
  if (S.presetInfo?.[m.provider] && !S.presetInfo[m.provider].keyOptional && !S.hasKeys?.[m.provider]) return { ok: false, text: 'Add a model key' };
  if (perms.micStatus === 'denied' || perms.micStatus === 'restricted') return { ok: false, text: 'Microphone off' };
  if (S.speech.error) return { ok: false, text: 'Dictation unavailable' };
  return { ok: true, text: 'Ready' };
}

function renderSidebar() {
  const r = ready();
  const sb = $('#sidebar');
  sb.innerHTML = '';
  for (const group of NAV) {
    const nav = h('<nav class="nav"></nav>');
    for (const [id, name] of group) {
      const item = h(`<div class="nav-item ${page === id ? 'active' : ''}" style="--tc:${THEME[id][0]};--tc2:${THEME[id][1]}"><span class="icon-box">${glyph(NAV_GLYPH[id])}</span>${name}</div>`);
      item.onclick = () => go(id);
      nav.append(item);
    }
    sb.append(nav);
  }
  sb.append(h('<div class="spacer"></div>'));
  sb.append(h(`<div class="status-card"><div class="status-line"><span class="dot ${r.ok ? '' : 'off'}"></span>${r.text}</div>
    <div class="status-hint"><span class="kbd small">${esc(S?.labels.ask || '')}</span>to ask</div></div>`));
}

function go(p) {
  page = p;
  setCapturing(null);
  render();
  $('#content').scrollTop = 0;
}

function deviceLabel() {
  const d = S.speech.device;
  return `${icon('headphones')}${esc(d || 'Microphone')}`;
}

// The current page's colours tint the glows at the top and bottom and the selected sidebar item (see styles.css).
function applyTheme() {
  const [a, b] = THEME[page] || THEME.home;
  document.documentElement.style.setProperty('--pc', a);
  document.documentElement.style.setProperty('--pc2', b);
}

// Menus and settings in Spanish when chosen (Settings > Speech > Menus and settings in): exact text is swapped after each draw.
function localize() {
  const lang = S && S.settings && S.settings.language && S.settings.language.ui;
  if (lang && lang !== 'en' && window.RelayUI) window.RelayUI.translateTree(document.body, lang);
}

function render() {
  if (!S) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && $('#content').contains(ae)) {
    applyTheme();
    renderSidebar();
    localize();
    return; // do not clobber a field the user is typing in
  }
  applyTheme();
  renderSidebar();
  $('#title').textContent = TITLES[page];
  $('#device').innerHTML = deviceLabel();
  const c = $('#content');
  const top = c.scrollTop;
  c.innerHTML = '';
  PAGES[page](c);
  c.scrollTop = top;
  localize();
}

const KOKORO_VOICES = [['af_heart', 'Heart (US, warm)'], ['af_bella', 'Bella (US)'], ['af_nicole', 'Nicole (US, calm)'], ['af_sarah', 'Sarah (US)'], ['af_sky', 'Sky (US)'], ['af_nova', 'Nova (US)'], ['am_michael', 'Michael (US)'], ['am_adam', 'Adam (US)'], ['am_eric', 'Eric (US)'], ['bf_emma', 'Emma (UK)'], ['bf_isabella', 'Isabella (UK)'], ['bm_george', 'George (UK)']];

/* ---------- helpers ---------- */
function toggleRow(title, desc, key) {
  const on = key.split('.').reduce((o, k) => o[k], S);
  const row = h(`<div class="row"><div class="grow"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="toggle ${on ? 'on' : ''}"></div></div>`);
  row.onclick = () => relay.set(key, !on);
  return row;
}

// How long you must be away before the unlock greeting, and what to call you.
function welcomeRow() {
  const w = S.settings.welcome || {};
  const row = h(`<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="t">Unlock greeting</div><div class="d">Greet me only if I was away at least this many minutes (0 greets every unlock), and not again within the second number of minutes. Name and voice on the right.</div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input class="field" id="wm" type="number" min="0" max="1440" step="1" style="width:72px" title="Minutes away before it greets"><span class="d">min away</span><input class="field" id="wr" type="number" min="0" max="1440" step="1" style="width:72px" title="Do not greet again within this many minutes"><span class="d">min between</span><input class="field" id="wn" style="width:90px" maxlength="20"><div class="toggle ${w.speak !== false ? 'on' : ''}" id="ws" title="Speak it"></div></div></div>`);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : d; };
  $('#wm', row).value = String(w.minAwayMin ?? 5);
  $('#wr', row).value = String(w.repeatMin ?? 10);
  $('#wn', row).value = w.name || 'Sir';
  $('#wm', row).onchange = (e) => relay.set('settings.welcome.minAwayMin', num(e.target.value, 5));
  $('#wr', row).onchange = (e) => relay.set('settings.welcome.repeatMin', num(e.target.value, 10));
  $('#wn', row).onchange = (e) => relay.set('settings.welcome.name', e.target.value.trim().slice(0, 20) || 'Sir');
  $('#ws', row).onclick = () => relay.set('settings.welcome.speak', w.speak === false);
  return row;
}

// How long the pointer must rest on the left-edge tab before the Recent menu opens.
function recentDelayRow() {
  const ms = Number(S.settings.recentDelay ?? 140);
  const label = (v) => (Number(v) === 0 ? 'Instantly' : `${(Number(v) / 1000).toFixed(2).replace(/0$/, '')} s`);
  const row = h(`<div class="row"><div class="grow"><div class="t">How long before it opens</div><div class="d">How long to rest the pointer on the tab. Shorter opens sooner; longer avoids opening by accident.</div></div><div style="display:flex;gap:10px;align-items:center"><input type="range" min="0" max="1500" step="50" value="${ms}" style="width:160px"><span class="d" id="rdv" style="min-width:64px;text-align:right">${label(ms)}</span></div></div>`);
  const r = $('input', row);
  r.oninput = () => { $('#rdv', row).textContent = label(r.value); };
  r.onchange = () => relay.set('settings.recentDelay', Number(r.value));
  return row;
}

function words(list) {
  return list.reduce((n, x) => n + (x.text.trim() ? x.text.trim().split(/\s+/).length : 0), 0);
}

function statsFor(rangeId) {
  const since = rangeId === 'all' ? 0 : Date.now() - (rangeId === 'today' ? 86400e3 : 7 * 86400e3);
  const hs = S.history.filter((x) => x.ts >= since);
  const ds = S.dictations.filter((x) => x.ts >= since);
  const acts = S.actions.filter((x) => x.ts >= since).length;
  const w = words(hs) + words(ds);
  return { requests: hs.length, actions: acts, words: w, minutesSaved: Math.round(((w / 40) * 60 + acts * 20) / 60) };
}

const mark = (status) => status === 'done'
  ? `<svg class="mark" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" style="fill:var(--accent)"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  : `<svg class="mark" viewBox="0 0 24 24"><path d="M12 3L22 20H2z" fill="#ff9f0a" stroke="#ff9f0a" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5M12 16.5v.01" stroke="#2a2a2a" stroke-width="2.2" stroke-linecap="round"/></svg>`;

function requestRow(x) {
  return `<div class="req">${mark(x.status)}<div style="flex:1;min-width:0"><div class="tt"><span>${esc(x.text)}</span><span class="when">${timeAgo(x.ts)}</span></div><div class="rp">${esc(x.status === 'stopped' ? 'Stopped at your request. Any earlier actions may already have happened.' : x.reply || '')}</div>${x.usageText ? `<div class="when" style="margin-top:3px">${esc(x.usageText)}</div>` : ''}</div></div>`;
}

const allowed = '<span class="allowed" style="display:inline-flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#4cc2ff"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#1d1d1d" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Allowed</span>';

/* ---------- pages ---------- */
const PAGES = {
  home(c) {
    const r = ready();
    const st = statsFor(range);
    const time = st.minutesSaved < 1 ? '<1m' : `${st.minutesSaved}m`;
    c.append(h(`<div class="hero"><div class="app-icon">${LOGO}</div><div><h2>Relay</h2><div class="st"><span class="dot ${r.ok ? '' : 'off'}"></span>${r.text}</div></div></div>`));
    const sel = h(`<div class="select">${{ all: 'All time', today: 'Today', week: 'Last 7 days' }[range]}<svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select><option value="all">All time</option><option value="today">Today</option><option value="week">Last 7 days</option></select></div>`);
    $('select', sel).value = range;
    $('select', sel).onchange = (e) => { range = e.target.value; render(); };
    c.append(sel);
    c.append(h(`<div class="card stats">${[[st.requests, 'Requests'], [st.actions, 'Actions taken'], [st.words, 'Words dictated'], [time, 'Time saved']].map(([n, l]) => `<div><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>`));

    const activity = S.activity || {};
    const inProgress = [...(activity.tasks || []).filter(t => ['queued', 'running', 'working'].includes(t.status)).map(t => t.text), ...(activity.agents || []).filter(a => ['running', 'working'].includes(a.status)).map(a => a.task)];
    const failed = (S.history || []).filter(x => x.status === 'failed').slice(0, 3);
    const complete = (S.history || []).filter(x => x.status === 'done').slice(0, 3);
    c.append(h('<div class="section-title">Activity center</div>'));
    c.append(h(`<div class="card" style="padding:16px"><div class="t">${activity.question ? 'Waiting for your approval' : inProgress.length ? 'Working now' : 'No work in progress'}</div>${activity.question ? `<div class="d">${esc(activity.question)} — answer in the Relay prompt.</div>` : inProgress.map(x => `<div class="d">${esc(x)}</div>`).join('')}<div class="d" style="margin-top:8px">Recent: ${complete.length} completed, ${failed.length} failed (last ${Math.min(3, (S.history || []).length)} of each).</div>${failed.map(x => `<div class="d">Failed: ${esc(x.text)}</div>`).join('')}</div>`));
    const proposals = S.skillSuggestions || [];
    if (proposals.length) {
      c.append(h('<div class="section-title">Suggested routines</div>'));
      const review = h(`<div class="card">${proposals.map(p => `<div class="row"><div class="grow"><div class="t">${esc(p.name)}</div><div class="d">Save this repeated request as a routine? It will run only when you ask.</div></div><button class="btn" data-accept="${esc(p.id)}">Save</button><button class="btn" data-dismiss="${esc(p.id)}">Dismiss</button></div>`).join('')}</div>`);
      review.onclick = async e => { const b = e.target.closest('[data-accept],[data-dismiss]'); if (!b) return; const r = await relay.reviewSkill(b.dataset.accept || b.dataset.dismiss, !!b.dataset.accept); if (r && !r.ok) alert(r.error); };
      c.append(review);
    }
    c.append(h('<div class="section-title">Get started</div>'));
    const gs = h('<div style="margin-top:-8px"></div>');
    const row = (ic, t, d, right, onclick, blue) => {
      const el = h(`<div class="get-row"><div class="ic ${blue ? 'blue' : ''}">${icon(ic)}</div><div class="grow"><div class="t">${t}</div><div class="d">${d}</div></div>${right}</div>`);
      if (onclick) el.onclick = onclick;
      return el;
    };
    gs.append(row('wave', 'Ask Relay', 'Say what you want done. It acts, then checks that it worked.', `<span class="kbd">${esc(S.labels.ask)}</span>`, null, true));
    gs.append(row('mic', 'Dictate', 'Talk, and the words are typed where your cursor is.', `<span class="kbd">${esc(S.labels.dictate)}</span>`));
    gs.append(row('keyboard', 'Type a request', "For when talking isn't an option.", `<span class="kbd">${esc(S.labels.type)}</span>`));
    gs.append(row('command', 'Customize your shortcuts', 'Change the keys for any of these.', '<span class="chev"><svg viewBox="0 0 8 13"><path d="M1.5 1.5l5 5-5 5"/></svg></span>', () => go('shortcuts')));
    c.append(gs);

    c.append(h('<div class="section-title">Recent<span class="link" id="va">View all</span></div>'));
    $('#va', c).onclick = () => go('history');
    const recent = S.history.slice(0, 3);
    c.append(h(`<div class="card">${recent.length ? recent.map(requestRow).join('') : '<div class="empty">Nothing yet. Press the shortcut and ask for something.</div>'}</div>`));
  },

  history(c) {
    const tabs = h(`<div class="tabs">${[['requests', 'Requests'], ['dictation', 'Dictation'], ['actions', 'Actions']].map(([k, l]) => `<button data-t="${k}" class="${historyTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`);
    tabs.onclick = (e) => { if (e.target.dataset.t) { historyTab = e.target.dataset.t; render(); } };
    c.append(tabs);

    if (historyTab === 'requests') {
      c.append(h('<div class="section-title" style="margin-top:0">Last 7 days</div>'));
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        days.push({ start: d.getTime(), label: d.toLocaleDateString('en-US', { weekday: 'short' }), n: 0 });
      }
      for (const x of S.history) {
        const d = [...days].reverse().find((dd) => x.ts >= dd.start);
        if (d) d.n++;
      }
      const max = Math.max(10, Math.ceil(Math.max(...days.map((d) => d.n)) / 5) * 5);
      const chart = h(`<div class="card chart"><div class="grid">${[0, 0.5, 1].map((f) => `<div class="gl" style="top:${(1 - f) * 100}%"><span class="gy">${Math.round(max * f)}</span></div>`).join('')}</div>
        <div class="bars">${days.map((d) => `<div class="col"><div class="bar" style="height:${(d.n / max) * 100}%"></div></div>`).join('')}</div>
        ${days.map((d, i) => `<span class="xl" style="left:calc(44px + (100% - 62px) * ${(i + 0.5) / 7})">${d.label}</span>`).join('')}</div>`);
      c.append(chart);
      c.append(h(`<div class="section-title">Requests<span class="link" id="clr">Clear…</span></div>`));
      $('#clr', c).onclick = () => { if (confirm('Clear all request, dictation and action history?')) relay.clearHistory(); };
      c.append(h(`<div class="card">${S.history.length ? S.history.map(requestRow).join('') : '<div class="empty">No requests yet.</div>'}</div>`));
    } else if (historyTab === 'dictation') {
      c.append(h('<div class="section-title" style="margin-top:0">Dictation<span class="link" id="clr">Clear…</span></div>'));
      $('#clr', c).onclick = () => { if (confirm('Clear all dictation history? Requests and actions are kept.')) relay.clearDictation(); };
      const q = h(`<input class="search" id="dq" placeholder="Search dictation" value="${esc(dictQuery)}">`);
      q.oninput = () => { dictQuery = q.value; drawDict(); };
      c.append(q);
      const holder = h('<div></div>');
      c.append(holder);
      const drawDict = () => {
        const list = S.dictations.filter((d) => !dictQuery || d.text.toLowerCase().includes(dictQuery.toLowerCase()));
        holder.innerHTML = `<div class="card">${list.length ? list.map((d, i) => `<div class="dict"><div><div class="tx">${esc(d.text)}</div><div class="when">${timeAgo(d.ts)}</div></div><div class="side"><button class="btn" data-copy="${i}">${icon('copy')}Copy</button><span class="fix" data-fix="${i}">Fix a Word…</span><span class="fix" data-remove="${esc(d.id)}" style="color:var(--red)">Remove</span></div></div>`).join('') : '<div class="empty">' + (S.settings.saveDictation === false ? 'Dictation history is off. Turn it on in General.' : 'No dictation yet. Hold the Dictate key and talk.') + '</div>'}</div>`;
        holder.onclick = (e) => {
          const t = e.target.closest('[data-copy],[data-fix]');
          if (!t) return;
          if (t.dataset.copy !== undefined) navigator.clipboard?.writeText(list[+t.dataset.copy].text);
          if (t.dataset.fix !== undefined) fixWord(list[+t.dataset.fix].text);
          if (t.dataset.remove !== undefined) relay.deleteDictation(t.dataset.remove);
        };
      };
      drawDict();
    } else {
      const rc = S.recap;
      if (rc && !rc.empty) {
        const card = h(`<div class="card" style="margin-bottom:16px"><div class="t" style="padding:10px 14px 2px;font-weight:600">Today</div><div class="note" style="padding:0 14px 8px;line-height:1.5">${esc(rc.spoken.replace(/ The list is in History, under Actions\.$/, ''))}</div>${rc.items.length ? rc.items.map((x) => `<div class="act"><svg viewBox="0 0 24 24" width="20" height="20" style="margin-top:2px"><circle cx="12" cy="12" r="10" fill="${x.risk >= 2 ? '#ff9f0a' : '#4cc2ff'}"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg><div><div class="nm">${esc(x.text)}</div></div><span class="note">${esc(x.when)}</span>${x.undoable ? `<button class="btn" data-undo="${esc(x.id)}" style="margin-left:8px">Undo</button>` : ''}</div>`).join('') : ''}</div>`);
        card.onclick = async (e) => { const id = e.target.dataset && e.target.dataset.undo; if (!id) return; e.target.disabled = true; e.target.textContent = 'Undoing…'; const r = await relay.undoAction(id); e.target.textContent = r.ok ? 'Undone' : 'Could not'; e.target.title = r.message || ''; };
        c.append(card);
      }
      c.append(h('<div class="note" style="margin-bottom:16px">Every tool call Relay made, newest first. Where an action can be put back (a moved file, a window, the volume, a timer, a note…), it has an Undo button until Relay quits. Use this to see what happened when a request did not work.</div>'));
      const actCard = h(`<div class="card">${S.actions.length ? S.actions.map((a) => `<div class="act"><svg viewBox="0 0 24 24" width="20" height="20" style="margin-top:2px"><circle cx="12" cy="12" r="10" fill="${a.ok ? '#4cc2ff' : '#ff453a'}"/><path d="${a.ok ? 'M7 12.5l3.5 3.5L17 9' : 'M8 8l8 8M16 8l-8 8'}" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg><div><div class="nm">${esc(a.tool)}</div><div class="ar">${esc(JSON.stringify(a.input))}</div><div class="rs ${a.ok ? '' : 'bad'}">${esc(a.result)}</div></div><span class="note">${timeAgo(a.ts)}</span>${a.undoable ? `<button class="btn" data-undo="${esc(a.id)}" style="margin-left:8px">Undo</button>` : ''}</div>`).join('') : '<div class="empty">No actions yet.</div>'}</div>`);
      actCard.onclick = async (e) => { const id = e.target.dataset && e.target.dataset.undo; if (!id) return; e.target.disabled = true; e.target.textContent = 'Undoing…'; const r = await relay.undoAction(id); e.target.textContent = r.ok ? 'Undone' : 'Could not'; e.target.title = r.message || ''; };
      c.append(actCard);
    }
  },

  routines(c) {
    c.append(h(`<div class="lead">Say a routine's name and Relay does its steps, one after another. Anything that sends or deletes still asks you first.</div>`));
    c.append(h(`<div class="section-title" style="margin-top:0"><span>Routines</span><span style="display:flex;gap:8px"><button class="btn" id="rec">${icon('record')}Record</button><button class="btn" id="new">${icon('plus')}New Routine</button></span></div>`));
    $('#rec', c).onclick = () => relay.ask.open('start a routine');
    $('#new', c).onclick = () => editRoutine({ name: '', steps: [] });
    const list = h('<div class="card"></div>');
    if (!S.routines.length) list.append(h('<div class="empty" style="text-align:center">None yet. Make one with the buttons above, by voice, or from an idea below.</div>'));
    for (const r of S.routines) {
      const el = h(`<div class="routine"><div class="rn"><span>${esc(r.name)}${r.learned && r.learned.length ? ` <span class="note" style="font-weight:400" title="Repeats the exact actions it took before, without asking the model">· learned, ${r.learned.length} action${r.learned.length === 1 ? '' : 's'}, no model</span>` : ''}</span><span style="display:flex;gap:8px"><button class="btn" data-a="run">Run</button><button class="btn" data-a="edit">Edit</button><button class="btn danger" data-a="del">Delete</button></span></div><ol>${r.steps.map((s, i) => `<li><span>${i + 1}</span>${esc(s)}</li>`).join('')}</ol></div>`);
      el.onclick = (e) => {
        const a = e.target.dataset.a;
        if (a === 'run') relay.runRoutine(r.id);
        if (a === 'edit') editRoutine(r);
        if (a === 'del' && confirm(`Delete "${r.name}"?`)) relay.deleteRoutine(r.id);
      };
      list.append(el);
    }
    c.append(list);

    c.append(h('<div class="section-title">Scheduled</div>'));
    c.append(h('<div class="note" style="margin:-4px 4px 12px">Requests Relay runs by itself while the Mac is on and Relay is open. Say “every weekday at 8, open my email” or add one here. Anything that sends or deletes is declined unless you answer within 90 seconds.</div>'));
    const srow = h('<div class="field-row" style="margin-bottom:14px"><input class="field" id="sin" placeholder="e.g. every weekday at 8am, open my email"><button class="btn primary" id="sadd" style="height:28px">Add</button></div>');
    const addSched = () => {
      const v = $('#sin', srow).value;
      if (v.trim()) relay.addSchedule(v).then((r) => { if (r && r.ok) $('#sin', srow).value = ''; else if (r) alert(r.reply); });
    };
    $('#sadd', srow).onclick = addSched;
    $('#sin', srow).onkeydown = (e) => e.key === 'Enter' && addSched();
    c.append(srow);
    const scheds = S.schedules || [];
    const scard = h('<div class="card"></div>');
    if (!scheds.length) scard.append(h('<div class="empty" style="text-align:center">Nothing scheduled.</div>'));
    for (const s of scheds) {
      const next = s.enabled && s.next ? ` · next ${new Date(s.next).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : s.enabled ? '' : ' · off';
      const el = h(`<div class="row" style="min-height:52px;padding:8px 14px"><div class="grow"><div class="t">${esc(s.text)}</div><div class="d">${esc(s.when)}${esc(next)}</div></div><div class="toggle ${s.enabled ? 'on' : ''}" data-a="tog"></div><button class="btn" data-a="del" style="margin-left:10px">Delete</button></div>`);
      el.onclick = (e) => {
        if (e.target.dataset.a === 'tog') relay.toggleSchedule(s.id, !s.enabled);
        if (e.target.dataset.a === 'del' && confirm(`Delete "${s.text}"?`)) relay.removeSchedule(s.id);
      };
      scard.append(el);
    }
    c.append(scard);

    c.append(h('<div class="section-title">Make one by voice</div>'));
    c.append(h(`<div class="card" style="padding:10px 14px">
      <div class="opt"><svg viewBox="0 0 24 24">${ICONS.record}</svg><div><div class="t">Record it</div><div class="d">Say “start a routine”, do each step, then “save it as start my day”.</div></div></div>
      <div class="opt"><svg viewBox="0 0 24 24">${ICONS.chat}</svg><div><div class="t">Say it in one go</div><div class="d">“When I say start my day, open Calendar and tell me the weather.”</div></div></div>
      <div class="opt"><svg viewBox="0 0 24 24">${ICONS.undo}</svg><div><div class="t">Keep what just worked</div><div class="d">After a request, say “save that as start my day”.</div></div></div></div>`));

    c.append(h('<div class="section-title">Ideas</div>'));
    const ideas = [
      { name: 'start my day', steps: ['Open Calendar', "What's the weather today?"] },
      { name: 'focus mode', steps: ['Quit Messages', 'Quit Mail', 'Set the volume to 20'] }
    ];
    const card = h('<div class="card"></div>');
    for (const idea of ideas) {
      const el = h(`<div class="routine"><div class="rn"><span>${idea.name}</span><button class="btn">Use…</button></div><ol>${idea.steps.map((s, i) => `<li><span>${i + 1}</span>${esc(s)}</li>`).join('')}</ol></div>`);
      $('button', el).onclick = () => editRoutine({ ...idea });
      card.append(el);
    }
    c.append(card);
  },

  vocab(c) {
    c.append(h('<div class="lead">Names, products and terms Relay should expect. Speech recognition guesses a more common word when it hasn\'t heard one before (“Superbase” for Supabase); listing it here fixes that.</div>'));
    const row = h(`<div class="field-row" style="margin-bottom:22px"><input class="field" id="vin" placeholder="Add a word or name (commas for several)" value="${esc(vocabPrefill)}"><button class="btn primary" id="vadd" style="height:28px">Add</button></div>`);
    const add = () => {
      const v = $('#vin', row).value;
      if (v.trim()) relay.addVocab(v.split(',')).then(() => { $('#vin', row).value = ''; vocabPrefill = ''; });
    };
    $('#vadd', row).onclick = add;
    $('#vin', row).onkeydown = (e) => e.key === 'Enter' && add();
    c.append(row);
    c.append(h(`<div class="section-title" style="margin-top:0">${S.vocabulary.length} term${S.vocabulary.length === 1 ? '' : 's'}</div>`));
    if (!S.vocabulary.length) c.append(h('<div class="note" style="font-size:15px">None yet.</div>'));
    const box = h('<div></div>');
    for (const t of S.vocabulary) {
      const tag = h(`<span class="tag">${esc(t)}<button title="Remove">×</button></span>`);
      $('button', tag).onclick = () => relay.removeVocab(t);
      box.append(tag);
    }
    c.append(box);

    c.append(h('<div class="section-title">Word fixes</div>'));
    c.append(h('<div class="note" style="margin:-4px 4px 12px">When Relay hears the first word, it writes the second one instead. This applies to dictation and to what you ask.</div>'));
    const fix = h('<div class="field-row" style="margin-bottom:14px"><input class="field" id="rfrom" placeholder="When it hears"><input class="field" id="rto" placeholder="Write instead"><button class="btn primary" id="radd" style="height:28px">Add</button></div>');
    const addFix = () => {
      const f = $('#rfrom', fix).value;
      const t = $('#rto', fix).value;
      if (f.trim() && t.trim()) relay.addReplacement(f, t).then(() => { $('#rfrom', fix).value = ''; $('#rto', fix).value = ''; });
    };
    $('#radd', fix).onclick = addFix;
    $('#rto', fix).onkeydown = (e) => e.key === 'Enter' && addFix();
    c.append(fix);
    const rules = S.replacements || [];
    const rc = h(`<div class="card">${rules.length ? rules.map((r) => `<div class="row" style="min-height:40px;padding:8px 14px"><div class="t">${esc(r.from)} <span style="color:var(--dim)">→</span> ${esc(r.to)}</div><button class="btn" data-del="${esc(r.id)}">Remove</button></div>`).join('') : '<div class="empty">None yet. Use Fix a Word… on a line in History › Dictation, or add one above.</div>'}</div>`);
    rc.onclick = (e) => e.target.dataset.del && relay.removeReplacement(e.target.dataset.del);
    c.append(rc);
  },

  remote(c) {
    const R = S.remote || { enabled: false, urls: [], devices: [], tailscale: {} };
    c.append(h('<div class="lead">Use Relay from your phone. The phone page shows your Jarvis reactor: hold it and talk, or type. Your Mac does the work with Claude, exactly as it does today, and the answer comes back as text and speech. Your Mac has to be on, with Relay open.</div>'));

    const sw = h('<div class="card flat" style="margin-bottom:14px"></div>');
    sw.append(h(`<div class="row"><div class="grow"><div class="t">Relay Remote</div><div class="d">${R.enabled ? (R.running ? `On, listening on port ${R.port}.` : esc(R.error || 'Starting…')) : 'Off. Nothing is listening.'}</div></div><div class="toggle ${R.enabled ? 'on' : ''}" id="rtog"></div></div>`));
    sw.append(h(`<div class="row"><div class="grow"><div class="t">Allow on my home Wi-Fi</div><div class="d">Off: only reachable through Tailscale (nothing listens on your network). macOS may ask once whether Relay can accept connections: choose Allow.</div></div><div class="toggle ${R.lan ? 'on' : ''}" id="rlan"></div></div>`));
    $('#rtog', sw).onclick = () => relay.setRemote({ enabled: !R.enabled });
    $('#rlan', sw).onclick = () => relay.setRemote({ lan: !R.lan });
    c.append(sw);

    {
      c.append(h('<div class="section-title" style="margin-top:0">Tell my phone when a long job finishes</div>'));
      const N = S.settings.notify || {};
      const nc = h('<div class="card flat" style="margin-bottom:14px"></div>');
      nc.append(toggleRow('Send a message to my phone', 'When a request takes more than 30 seconds (or a background agent finishes) you get a short message, so you can leave the desk. Only “Done: …” and the first words of what you asked are sent, never the answer.', 'settings.notify.enabled'));
      const chan = h(`<div class="row"><div class="grow"><div class="t">How</div><div class="d">ntfy: a free notification app (ntfy.sh); the message goes through its server. iMessage: Relay texts you from this Mac, nothing else is involved.</div></div><div class="seg sm">${[['ntfy', 'ntfy'], ['imessage', 'iMessage']].map(([v, l]) => `<button data-v="${v}" class="${(N.channel || 'ntfy') === v ? 'on' : ''}" style="width:80px">${l}</button>`).join('')}</div></div>`);
      chan.onclick = (e) => e.target.dataset.v && relay.set('settings.notify.channel', e.target.dataset.v);
      nc.append(chan);
      if ((N.channel || 'ntfy') === 'ntfy') {
        const top = h(`<div class="row"><div class="grow"><div class="t">Topic</div><div class="d">Install the ntfy app on your iPhone, tap +, and subscribe to this topic. It is the only secret: keep it to yourself.</div><div class="d" style="user-select:text;font-family:ui-monospace,Menlo,monospace">${esc(N.ntfyTopic || 'not made yet')}</div></div><button class="btn" id="ntop">${N.ntfyTopic ? 'New topic' : 'Make a topic'}</button></div>`);
        $('#ntop', top).onclick = () => relay.notifyTopic();
        nc.append(top);
      } else {
        const to = h(`<div class="row"><div class="grow"><div class="t">Send iMessages to</div><div class="d">Your own phone number or Apple ID email. The first time, macOS asks whether Relay may control Messages.</div></div><input class="field" style="width:200px" value="${esc(N.imessageTo || '')}" placeholder="+1 555 123 4567"></div>`);
        $('input', to).onchange = (e) => relay.set('settings.notify.imessageTo', e.target.value.trim());
        nc.append(to);
      }
      const test = h('<div class="row"><div class="grow"><div class="t">Try it</div><div class="d" id="ntres">Sends a test message now.</div></div><button class="btn" id="ntest">Send a test</button></div>');
      $('#ntest', test).onclick = async () => { $('#ntres', test).textContent = 'Sending…'; const r = await relay.notifyTest(); $('#ntres', test).textContent = r.ok ? `Sent (${r.via}). Check your phone.` : r.error; };
      nc.append(test);
      c.append(nc);
    }

    if (R.enabled && R.running) {
      c.append(h('<div class="section-title" style="margin-top:0">Pair a phone</div>'));
      const box = h('<div class="card" style="padding:14px"></div>');
      box.append(h('<div class="note" style="margin:0 0 10px;line-height:1.5">1. On your iPhone, scan the code (or open the address below in Safari). 2. Tap Pair. 3. In Safari press Share, then <b>Add to Home Screen</b>, so it opens like an app.</div>'));
      const go = h('<button class="btn primary" id="pairbtn">Pair a phone</button>');
      const out = h('<div id="pairout" style="margin-top:14px"></div>');
      go.onclick = async () => {
        const r = await relay.pairPhone();
        if (r.error) { out.textContent = r.error; return; }
        out.innerHTML = '';
        const row = h('<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"></div>');
        if (r.qr) { const q = h(`<div style="width:170px;height:170px;background:#fff;border-radius:12px;padding:6px">${r.qr}</div>`); row.append(q); }
        const side = h('<div></div>');
        side.append(h(`<div class="note">Code (works once, for 5 minutes)</div><div style="font:700 34px ui-monospace,Menlo,monospace;letter-spacing:.18em;margin:4px 0 8px">${esc(r.code)}</div>`));
        for (const u of r.urls) side.append(h(`<div class="d" style="user-select:text">${esc(u)}</div>`));
        if (!r.urls.length) side.append(h('<div class="d">No network address found. Connect this Mac to Wi-Fi, or use Tailscale below.</div>'));
        row.append(side);
        out.append(row);
      };
      box.append(go, out);
      c.append(box);

      c.append(h('<div class="section-title">Hey Siri, Relay (iPhone Shortcut)</div>'));
      const sc = h('<div class="card" style="padding:14px"></div>');
      sc.append(h('<div class="note" style="margin:0 0 10px;line-height:1.5">Safari only allows its microphone on a secure (https) address, so hold to talk needs Tailscale. A Shortcut works on plain Wi-Fi: say “Hey Siri, Relay”, talk, and it speaks the answer. Make the key here, then build the Shortcut below (about two minutes).</div>'));
      const mk = h('<button class="btn primary" id="skey">Make a Shortcut key</button>');
      const so = h('<div id="skout" style="margin-top:12px"></div>');
      // The key is shown once, so it is kept here: making it changes the paired phones, which redraws this page, and it must not vanish.
      const showKey = (r) => {
        so.innerHTML = '';
        so.append(h(`<div><div class="d" style="margin-bottom:4px">Address</div><div style="user-select:text;font:12px ui-monospace,Menlo,monospace;word-break:break-all">${esc(r.url)}</div></div>`));
        so.append(h(`<div><div class="d" style="margin:10px 0 4px">Key (shown once)</div><div style="user-select:text;font:12px ui-monospace,Menlo,monospace;word-break:break-all">Bearer ${esc(r.token)}</div></div>`));
        const file = h('<button class="btn primary" style="margin:10px 8px 10px 0">Save the Shortcut file</button>');
        file.onclick = async () => { file.textContent = 'Making it…'; const f = await relay.shortcutFile({ url: r.url, token: r.token }); file.textContent = f.ok ? 'Saved: AirDrop it to your iPhone' : 'Save the Shortcut file'; if (!f.ok) alert(f.error); };
        const share = h('<button class="btn primary" style="margin:10px 8px 10px 0">Save “Send to Relay” (share sheet)</button>');
        share.onclick = async () => { share.textContent = 'Making it…'; const f = await relay.shortcutFile({ url: r.url, token: r.token, kind: 'share' }); share.textContent = f.ok ? 'Saved: AirDrop it to your iPhone' : 'Save “Send to Relay” (share sheet)'; if (!f.ok) alert(f.error); };
        const copy = h('<button class="btn" style="margin:10px 8px 10px 0">Copy the key</button>');
        copy.onclick = () => relay.copyText(`Bearer ${r.token}`);
        so.append(file, share, copy);
        so.append(h('<div class="d" style="line-height:1.6">The file is the finished Shortcut. It is saved in your Downloads folder and shown in Finder: AirDrop it to your iPhone, tap it, and tap <b>Add Shortcut</b>. <b>Send to Relay</b> adds Relay to the iPhone share sheet: share a photo, a PDF, a web page or some text, say what to do with it (“what is this?”, “add this to my notes”), and Relay answers out loud. Then say “Hey Siri, Relay”, or put it on the Action Button (Settings, Action Button, Shortcut, Relay). Or build it by hand:</div>'));
        so.append(h(`<ol class="d" style="line-height:1.7;margin-left:18px"><li>Open <b>Shortcuts</b> on the iPhone, tap +, and name it <b>Relay</b>.</li><li>Add <b>Dictate Text</b>.</li><li>Add <b>Get Contents of URL</b>. URL: the address above. Show More: Method <b>POST</b>; Headers: <code>Authorization</code> = the key you copied, <code>X-Relay-Remote</code> = <code>1</code>; Request Body <b>JSON</b> with <code>text</code> (Text) = the <b>Dictated Text</b> variable and <code>wait</code> (Text) = <code>true</code>.</li><li>Add <b>Get Dictionary Value</b> for the key <code>reply</code> from the Contents of URL.</li><li>Add <b>Speak Text</b> with that value.</li></ol>`));
        so.append(h('<div class="note" style="margin-top:6px">The key is saved as a paired phone named Siri Shortcut: unpair it below to cancel it. Tailscale must be on on the phone when you are away from home.</div>'));
      };
      mk.onclick = async () => {
        const r = await relay.shortcutKey();
        if (r.error) { so.textContent = r.error; return; }
        window.__scKey = r;
        showKey(r);
      };
      if (window.__scKey) showKey(window.__scKey);
      sc.append(mk, so);
      c.append(sc);

      c.append(h('<div class="section-title">Paired phones</div>'));
      const dev = h('<div class="card"></div>');
      if (!R.devices.length) dev.append(h('<div class="empty" style="text-align:center">None yet.</div>'));
      for (const d of R.devices) {
        const row = h(`<div class="row" style="min-height:44px;padding:8px 14px"><div class="grow"><div class="t">${esc(d.name)}</div><div class="d">Last used ${timeAgo(d.lastSeen)}</div></div><button class="btn" data-rm="${esc(d.id)}">Unpair</button></div>`);
        row.onclick = (e) => e.target.dataset.rm && confirm(`Unpair ${d.name}? It will need a new code.`) && relay.removePhone(d.id);
        dev.append(row);
      }
      c.append(dev);
    }

    c.append(h('<div class="section-title">Away from home: Tailscale</div>'));
    const T = R.tailscale || {};
    // Tailscale may have been installed or signed in after Relay started: look again when this page is shown (at most every 4 s).
    if (Date.now() - (window.__tsCheck || 0) > 4000) { window.__tsCheck = Date.now(); relay.remoteTailscaleCheck?.(); }
    const again = () => { const b = h('<button class="btn" style="margin-top:10px">Check again</button>'); b.onclick = async () => { b.textContent = 'Checking…'; await relay.remoteTailscaleCheck(); }; return b; };
    const ts = h('<div class="card" style="padding:14px"></div>');
    if (!T.installed) ts.append(h('<div class="note" style="line-height:1.5">Tailscale is free. It joins your phone and Mac in a private, encrypted network, so Relay Remote works from anywhere, and it gives the phone the secure address its microphone needs for hold to talk. Install Tailscale on the Mac and on the phone (tailscale.com/download), sign in with the same account, then come back here.</div>'), again());
    else if (!T.running) ts.append(h('<div class="note">Tailscale is installed but not connected. Open it and sign in, then come back here.</div>'), again());
    else if (T.serving) {
      ts.append(h(`<div class="t">Secure link on</div><div class="d" style="user-select:text;margin:4px 0 10px">${esc(T.https || '')}</div>`));
      const off = h('<button class="btn">Turn off</button>');
      off.onclick = () => relay.remoteTailscale(false);
      ts.append(off);
    } else {
      ts.append(h(`<div class="note" style="margin-bottom:10px;line-height:1.5">Connected as ${esc(T.name || 'this Mac')}. This makes an https address on your tailnet for the phone page. In the Tailscale admin page, MagicDNS and HTTPS Certificates must be turned on first.</div>`));
      const on = h('<button class="btn primary">Make the secure link</button>');
      on.onclick = async () => { const r = await relay.remoteTailscale(true); if (!r.ok) alert(r.error); };
      ts.append(on);
    }
    c.append(ts);

    c.append(h('<div class="section-title">Good to know</div>'));
    c.append(h('<div class="card" style="padding:12px 14px"><div class="d" style="line-height:1.7">Relay Remote controls your Mac, not the phone itself: it cannot open your phone\'s own apps. Anything that sends or deletes still asks for approval on the Mac. On home Wi-Fi the connection is not encrypted (the pairing token travels in the clear), so pair at home on a network you trust, and use Tailscale away from home. Only phones on your own network (or Tailscale) are allowed in. Unpair a phone any time.</div></div>'));
  },

  connectors(c) {
    const C = S.connectors || { notion: {}, google: { accounts: [] }, apps: {} };
    C.apps = C.apps || {};
    c.append(h('<div class="lead">Let Relay read and write in the services you use. Each one is connected by you, on this Mac, and the secrets are kept encrypted here. Reading is free; sending an email always asks you first. Background agents can use them too.</div>'));

    // Notion
    c.append(h('<div class="section-title" style="margin-top:0">Notion</div>'));
    const n = h('<div class="card" style="padding:14px"></div>');
    if (C.notion.connected) {
      n.append(h(`<div class="row" style="padding:0;min-height:36px"><div class="grow"><div class="t">Connected to ${esc(C.notion.name || 'Notion')}</div><div class="d">Relay can search, read, add to and create pages that you shared with it.</div></div><button class="btn" id="nout">Disconnect</button></div>`));
      $('#nout', n).onclick = () => relay.clearNotion();
    } else {
      n.append(h('<div class="note" style="margin:0 0 10px;line-height:1.5">1. Open notion.so/profile/integrations and make a new internal integration (any name, e.g. Relay). 2. Copy its secret. 3. In Notion, open the pages you want Relay to see, choose ••• > Connections, and add the integration. 4. Paste the secret here.</div>'));
      const row = h('<div class="field-row"><input class="field" id="ntok" type="password" placeholder="Integration secret"><button class="btn primary" id="nset" style="height:28px">Connect</button></div>');
      const go = async () => {
        const btn = $('#nset', row); btn.textContent = 'Checking…';
        const r = await relay.setNotionToken($('#ntok', row).value);
        btn.textContent = 'Connect';
        if (!r.ok) alert(r.error);
      };
      $('#nset', row).onclick = go;
      $('#ntok', row).onkeydown = (e) => e.key === 'Enter' && go();
      n.append(row);
    }
    c.append(n);

    // Google
    c.append(h('<div class="section-title">Gmail, Google Calendar, Drive and Sheets</div>'));
    const g = h('<div class="card" style="padding:14px"></div>');
    g.append(h('<div class="note" style="margin:0 0 10px;line-height:1.5">Relay signs in to Google with your own app, so nothing goes through anyone else. One time: in console.cloud.google.com make a project, turn on the Gmail, Google Calendar, Google Drive and Google Sheets APIs (accounts connected before Drive and Sheets were added need to be removed and connected again), set up the OAuth consent screen (External, add yourself as a test user), then create an OAuth client of type Desktop app. Paste its client ID and secret here, then connect each Google account you want.</div>'));
    const cr = h(`<div class="field-row" style="margin-bottom:10px"><input class="field" id="gid" placeholder="Client ID" value="${esc(C.google.clientId || '')}"><input class="field" id="gsec" type="password" placeholder="${C.google.hasSecret ? 'Client secret saved (paste to replace)' : 'Client secret'}"><button class="btn" id="gsave" style="height:28px">Save</button></div>`);
    $('#gsave', cr).onclick = () => relay.setGoogleClient($('#gid', cr).value, $('#gsec', cr).value).then(() => { $('#gsec', cr).value = ''; });
    g.append(cr);
    for (const email of C.google.accounts) {
      const row = h(`<div class="row" style="padding:6px 0;min-height:36px"><div class="grow"><div class="t">${esc(email)}</div><div class="d">Gmail, Calendar, Drive and Sheets connected</div></div><button class="btn" data-rm="${esc(email)}">Remove</button></div>`);
      row.onclick = (e) => e.target.dataset.rm && confirm(`Remove ${email}?`) && relay.removeGoogle(email);
      g.append(row);
    }
    const add = h(`<div style="margin-top:8px"><button class="btn primary" id="gconn" ${C.google.clientId && C.google.hasSecret ? '' : 'disabled'}>${C.google.accounts.length ? 'Connect another account' : 'Connect a Google account'}</button> <span class="note" id="gstat" style="margin-left:8px"></span></div>`);
    $('#gconn', add).onclick = async () => {
      $('#gstat', add).textContent = 'Waiting for Google in your browser…';
      const r = await relay.connectGoogle();
      $('#gstat', add).textContent = r.ok ? `Connected ${r.email}` : '';
      if (!r.ok) alert(r.error);
    };
    g.append(add);
    c.append(g);

    // Composio (or any MCP server)
    c.append(h('<div class="section-title">All your other apps (Composio)</div>'));
    const ap = h('<div class="card" style="padding:14px"></div>');
    if (C.apps.connected) {
      ap.append(h(`<div class="row" style="padding:0;min-height:36px"><div class="grow"><div class="t">Connected to ${esc(C.apps.url)}</div><div class="d">${C.apps.count} tools. Relay can look things up and, after asking you, send, create and change. It never deletes.</div></div><button class="btn" id="aout">Disconnect</button></div>`));
      $('#aout', ap).onclick = () => relay.clearApps();
    } else {
      ap.append(h('<div class="note" style="margin:0 0 10px;line-height:1.5">Composio reaches Gmail, Slack, GitHub, Linear, Google Sheets and hundreds of other apps with the logins you already set up there. In Composio, make a Tool Router session or MCP server, and copy its <b>MCP URL</b> and your <b>API key</b>. Paste them here (any other MCP server over https works too). The key is kept encrypted on this Mac, and Relay asks you before anything is sent or changed. Anything that deletes is refused.</div>'));
      const row = h('<div class="field-row"><input class="field" id="aurl" placeholder="MCP URL (https://…)"><input class="field" id="akey" type="password" placeholder="API key"><button class="btn primary" id="aset" style="height:28px">Connect</button></div>');
      const go = async () => {
        const btn = $('#aset', row); btn.textContent = 'Checking…';
        const r = await relay.setApps($('#aurl', row).value, $('#akey', row).value, 'x-api-key');
        btn.textContent = 'Connect';
        if (!r.ok) alert(r.error);
      };
      $('#aset', row).onclick = go;
      $('#akey', row).onkeydown = (e) => e.key === 'Enter' && go();
      ap.append(row);
    }
    c.append(ap);

    c.append(h('<div class="section-title">Try saying</div>'));
    c.append(h('<div class="card" style="padding:12px 14px"><div class="d" style="line-height:1.8">“Do I have any unread email from Anna?” · “Read me my last email from the bank” · “What is on my Google calendar this week?” · “Add dentist Friday at 3 to my calendar” · “Draft an email to Sam saying I will be late” · “Search Notion for the trip plan” · “In the background, summarize my Notion trip notes into a new page”.</div></div>'));
  },

  memory(c) {
    c.append(h('<div class="lead">What Relay knows about you. Tell it by saying “remember that my sister is Anna”, or add it here. Relay uses these in every request, and keeps them only on this Mac. Say “forget …” or delete one here. It never keeps passwords or card numbers.</div>'));
    const on = S.settings.memory !== false;
    const sw = h('<div class="card flat" style="margin-bottom:18px"></div>');
    sw.append(toggleRow('Remember things about me', 'Off: Relay does not use or collect memories, and “remember …” does nothing.', 'settings.memory'));
    c.append(sw);
    const row = h('<div class="field-row" style="margin-bottom:22px"><input class="field" id="min" placeholder="Something to remember, e.g. I am vegetarian"><button class="btn primary" id="madd" style="height:28px">Add</button></div>');
    const add = () => {
      const v = $('#min', row).value;
      if (v.trim()) relay.addMemory(v).then((r) => { $('#min', row).value = ''; if (r && r.status === 'failed') alert(r.reply); });
    };
    $('#madd', row).onclick = add;
    $('#min', row).onkeydown = (e) => e.key === 'Enter' && add();
    c.append(row);
    const list = S.memories || [];
    c.append(h(`<div class="section-title" style="margin-top:0"><span>${list.length} thing${list.length === 1 ? '' : 's'}${on ? '' : ' (off)'}</span>${list.length ? '<button class="btn" id="mall">Forget all</button>' : ''}</div>`));
    if (!list.length) c.append(h('<div class="note" style="font-size:15px">Nothing yet.</div>'));
    else {
      const card = h(`<div class="card">${list.map((m) => `<div class="row" style="min-height:40px;padding:8px 14px"><div class="t">${esc(m.text)}</div><button class="btn" data-del="${esc(m.id)}">Forget</button></div>`).join('')}</div>`);
      card.onclick = (e) => e.target.dataset.del && relay.removeMemory(e.target.dataset.del);
      c.append(card);
    }
    if (S.settings.flags?.memoryV2) {
      const inf = S.inferred || [];
      const pend = inf.filter((x) => x.status === 'pending');
      c.append(h('<div class="section-title">Learned about you</div>'));
      c.append(h('<div class="d" style="margin:-6px 4px 10px">Relay notices things from what you ask. Nothing here is used until you approve it, and unapproved ones disappear after 30 days.</div>'));
      if (!inf.length) c.append(h('<div class="note" style="font-size:15px">Nothing yet.</div>'));
      else {
        const card = h(`<div class="card">${inf.map((m) => `<div class="row" style="min-height:40px;padding:8px 14px"><div class="t">${esc(m.text)}${m.status === 'approved' ? ' <span class="d" style="display:inline">· in use</span>' : ''}</div><div style="display:flex;gap:8px">${m.status === 'pending' ? `<button class="btn" data-ap="${esc(m.id)}">Approve</button>` : ''}<button class="btn" data-ed="${esc(m.id)}">Edit</button><button class="btn" data-xd="${esc(m.id)}">Delete</button></div></div>`).join('')}</div>`);
        card.onclick = (e) => {
          const t = e.target.dataset;
          if (t.ap) relay.memoryAct('inferred-approve', t.ap);
          else if (t.xd) relay.memoryAct('inferred-delete', t.xd);
          else if (t.ed) { const cur = inf.find((x) => x.id === t.ed); const v = prompt('Edit', cur?.text || ''); if (v && v.trim()) relay.memoryAct('inferred-edit', t.ed, { text: v }); }
        };
        c.append(card);
      }
      const ls = S.lessons || [];
      c.append(h(`<div class="section-title">Lessons from your corrections</div>`));
      c.append(h('<div class="d" style="margin:-6px 4px 10px">When you say “that’s wrong, I meant…”, Relay keeps what it should do next time and uses the few that match each request.</div>'));
      if (!ls.length) c.append(h('<div class="note" style="font-size:15px">Nothing yet.</div>'));
      else {
        const card = h(`<div class="card">${ls.map((l) => `<div class="row" style="min-height:40px;padding:8px 14px"><div class="grow"><div class="t">${esc(l.trigger)}</div><div class="d">${esc(l.fix)}</div></div><div style="display:flex;gap:8px"><button class="btn" data-le="${esc(l.id)}">Edit</button><button class="btn" data-ld="${esc(l.id)}">Delete</button></div></div>`).join('')}</div>`);
        card.onclick = (e) => {
          const t = e.target.dataset;
          if (t.ld) relay.memoryAct('lesson-delete', t.ld);
          else if (t.le) { const cur = ls.find((x) => x.id === t.le); const fix = prompt('What Relay should do', cur?.fix || ''); if (fix && fix.trim()) relay.memoryAct('lesson-edit', t.le, { fix }); }
        };
        c.append(card);
      }
    }
    const all = $('#mall', c);
    if (all) all.onclick = () => confirm('Forget everything Relay remembers about you?') && relay.clearMemory();
  },

  general(c) {
    const title = (t) => c.append(h(`<div class="title-flat">${t}</div>`));
    title('Listening');
    const card = h('<div class="card flat"></div>');
    const talk = h(`<div class="row talk" style="flex-wrap:wrap"><div class="t">Talking</div><div class="seg">${[['tap-or-hold', 'Tap or hold'], ['tap', 'Tap'], ['hold', 'Hold']].map(([v, l]) => `<button data-v="${v}" class="${S.settings.talking === v ? 'on' : ''}">${l}</button>`).join('')}</div><div class="note foot" style="flex-basis:100%">Tap to start and tap to send, or hold while you talk and let go.</div></div>`);
    talk.onclick = (e) => e.target.dataset.v && relay.set('settings.talking', e.target.dataset.v);
    card.append(talk, toggleRow('Welcome back when I unlock', 'When you unlock the Mac after being away a while, Jarvis says “Welcome back, Sir” and what happened: what finished, what failed, your next meeting, a low battery. No model is asked, so it is instant.', 'settings.welcome.enabled'), welcomeRow(), toggleRow('Faster answers', 'On: Relay skips extended thinking and does not re-check every action it just did, so things happen sooner. Off: slower, but it thinks longer and double-checks. Applies to Claude and to the Codex backup.', 'settings.fastMode'), toggleRow('Play sounds', '', 'settings.playSounds'), toggleRow('Recent asks on the left edge', 'Rest the pointer on the thin tab at the middle of the left edge to open a list of what you asked lately. Click one to ask it again.', 'settings.recent'), recentDelayRow(), toggleRow('Lower the volume while I talk', 'Turns the volume down to 30% while Relay listens and puts it back exactly when you stop. Off: your volume is never touched.', 'settings.duckAudio'), toggleRow('Dictation', 'Right ⌘ types what you say. Off: the shortcut is disabled.', 'settings.dictation'), toggleRow('Make 3D models from real photos', 'When there is no good ready-made model, Relay finds real photos of the thing (Wikipedia, Wikimedia Commons, or a photo it found while researching) and turns one into a realistic 3D model with a free online service (Stable Fast 3D on Hugging Face). Only the public photo is sent, never anything about you. It can be busy or out of its free daily limit; then Relay tries another option.', 'settings.models3dFromPhotos'), toggleRow('3D models', 'Ask to see something in 3D (“show me a 3D model of a skull”) and a hologram floats on your screen: no window, no border. Drag its glowing base to move it, drag the model to turn it, scroll to resize, pin it to keep it, switch to other models, and drop one hologram on another to combine them. Relay looks for real models on Wikimedia Commons first (free, with the maker and license shown), else builds a simple one from shapes and says so.', 'settings.models3d'), toggleRow('Answer cards with pictures', 'For “who is…”, “what does … look like” and “show me … options”, a card with a picture, key facts and links appears beside the answer. Pictures come from Wikipedia and Wikimedia Commons, fetched by Relay itself.', 'settings.cards'), toggleRow('Show usage after each ask', 'A small line under the answer: the model, how long it took, tokens, and how much of your Claude limit is used. It is never read aloud.', 'settings.showUsage'), toggleRow('Learn my words from corrections', 'After you dictate, Relay looks at that text in the field. A word you fixed by hand twice becomes a word fix in Vocabulary. Only the changed words are kept; password fields are never read.', 'settings.learnWords'), toggleRow('Keep dictation history', 'Off: dictated text is typed but not saved in History.', 'settings.saveDictation'));
    const modes = h(`<div class="row talk" style="flex-wrap:wrap"><div class="grow"><div class="t">Work mode</div><div class="d">Changes how Jarvis responds. Say “set work mode to coding” to switch by voice.</div></div><div class="seg">${[['personal', 'Personal'], ['homework', 'Homework'], ['coding', 'Coding'], ['focus', 'Focus']].map(([v,l]) => `<button data-v="${v}" class="${(S.settings.workMode || 'personal') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`);
    modes.onclick = e => { if (e.target.dataset.v) relay.set('settings.workMode', e.target.dataset.v); };
    card.append(modes);
    c.append(card);
    // Better 3D from photos: a free Hugging Face token unlocks the stronger generators (TRELLIS), which need more free GPU time than anonymous use allows.
    const hf = h(`<div class="row"><div class="grow"><div class="t">Hugging Face token (optional)</div><div class="d">${S.hasHfToken ? 'Saved on this Mac (encrypted with your Keychain). Photo models now try the sharper TRELLIS generators first.' : 'Without it Relay uses Stable Fast 3D, which is fast but blobby. A free account\'s token at huggingface.co/settings/tokens (a “read” token) gives enough free GPU time for TRELLIS: much cleaner shapes and textures, about a minute each. Only the public photo is sent.'}</div></div><input class="field" type="password" style="width:200px" placeholder="${S.hasHfToken ? 'Paste to replace' : 'hf_…'}"><button class="btn">Save</button><button class="btn" id="hftest">Test it</button></div><div class="note" id="hfout" style="margin:0 14px 10px;line-height:1.5"></div>`);
    $('button', hf).onclick = async () => { const r = await relay.setHfToken($('input', hf).value); if (r && !r.ok) alert(r.error); else $('input', hf).value = ''; };
    $('#hftest', hf).onclick = async () => {
      const out = $('#hfout', hf), btn = $('#hftest', hf);
      btn.disabled = true; btn.textContent = 'Testing… (up to two minutes)';
      out.textContent = 'Making a model of a car from the clearest photo, trying the generators in order…';
      const r = await relay.testModels3d();
      btn.disabled = false; btn.textContent = 'Test it';
      const lines = (r.attempts || []).map((a) => `${a.ok ? '✓' : '✗'} ${a.name}: ${a.ok ? `made it in ${a.seconds} s` : `${a.error || 'failed'} (${a.seconds} s)${a.raw ? ` [${a.raw.replace(/\s+/g, ' ').slice(0, 150)}]` : ''}`}`);
      out.textContent = `${r.ok ? `Worked with ${r.name} in ${r.seconds} s: it is on your screen as a hologram.` : `Did not work: ${r.error}`}${r.hasToken ? '' : ' (No token saved: only Stable Fast 3D is tried.)'}\n${lines.join('\n')}`;
      out.style.whiteSpace = 'pre-wrap';
    };
    const hfCard = h('<div class="card flat" style="margin-top:12px"></div>');
    hfCard.append(hf);
    c.append(hfCard);

    // Holograms: where the buttons go, slow turning; and Hand control (the camera), with how to use it.
    title('Holograms and hands');
    const hv = S.settings.holoUi || { controls: 'menu', spin: true, spinDelay: 10 };
    const segRow = (label, desc, opts, current, onPick) => {
      const row = h(`<div class="row talk" style="flex-wrap:wrap"><div class="grow"><div class="t">${label}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="seg">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(current) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div></div>`);
      row.onclick = (e) => e.target.dataset.v !== undefined && onPick(e.target.dataset.v);
      return row;
    };
    const hcard = h('<div class="card flat"></div>');
    hcard.append(segRow('Buttons on a hologram', 'Menu: one small ⋯ button that opens the list. Side: a slim column beside the model. Bar: a row under its name. All stay clear of the model.', [['menu', 'Menu'], ['side', 'Side'], ['bar', 'Bar']], hv.controls, (v) => relay.set('settings.holoUi.controls', v)));
    hcard.append(segRow('File when I drag a hologram into an app', 'The hologram button "Drag to an app" hands over the model as a file you can drop into Fusion, FreeCAD, a slicer, a folder or a message. STL for printing, 3MF for slicers (keeps millimetres), STEP for CAD.', [['stl', 'STL'], ['3mf', '3MF'], ['step', 'STEP']], hv.dragFormat || 'stl', (v) => relay.set('settings.holoUi.dragFormat', v)));
    {
      const ppi0 = hv.pointsPerInch || 125;
      const cal = h(`<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="t">Screen size (for real size)</div><div class="d">Hold a credit card flat against the screen and drag the slider until the outline below is exactly as wide as the card. Then “show it life size” is true to the millimetre.</div></div><div style="flex-basis:100%;padding-top:8px"><div id="calcard" style="height:${Math.round(53.98 / 25.4 * ppi0)}px;width:${Math.round(85.6 / 25.4 * ppi0)}px;border:2px solid var(--accent,#59dcff);border-radius:${Math.round(3.2 / 25.4 * ppi0)}px;margin-bottom:10px"></div><input id="calsl" type="range" min="70" max="260" step="1" value="${ppi0}" style="width:260px"> <span id="calv">${ppi0}</span> points per inch</div></div>`);
      const sl = $('#calsl', cal);
      sl.oninput = () => { const v = +sl.value; const c = $('#calcard', cal); c.style.width = `${Math.round(85.6 / 25.4 * v)}px`; c.style.height = `${Math.round(53.98 / 25.4 * v)}px`; c.style.borderRadius = `${Math.round(3.2 / 25.4 * v)}px`; $('#calv', cal).textContent = v; };
      sl.onchange = () => relay.set('settings.holoUi.pointsPerInch', +sl.value);
      hcard.append(cal);
    }
    hcard.append(toggleRow('Holograms slowly turn', 'A hologram turns by itself until you touch it.', 'settings.holoUi.spin'));
    hcard.append(segRow('Leave it still after I touch it', 'How long before it starts turning again.', [[3, '3 s'], [10, '10 s'], [30, '30 s'], [120, '2 min']], hv.spinDelay, (v) => relay.set('settings.holoUi.spinDelay', Number(v))));
    const hs = S.handsInfo || { status: 'off', message: '' };
    const handsOn = !!S.settings.hands?.enabled;
    const hrow = h(`<div class="row"><div class="grow"><div class="t">Hand control (camera)</div><div class="d">${hs.status === 'error' ? esc(hs.message || 'It could not start.') : handsOn ? (hs.status === 'running' ? 'On. Hold a hand up to the camera: you should see a small glowing ring follow it.' : 'Starting…') : 'Move holograms in the air. Turn it on, allow the camera when macOS asks (Relay only looks at where your hands are, on this Mac; no picture is kept or sent), then hold an open hand up to the camera.'}</div></div><div class="toggle ${handsOn && hs.status !== 'error' ? 'on' : ''}"></div></div>`);
    hrow.onclick = async () => { const r = await relay.setHands(!(handsOn && hs.status !== 'error')); if (r && !r.ok) alert(r.error); };
    hcard.append(hrow);
    const handMargin = Math.round((S.settings.hands?.margin ?? 0.22) * 100);
    const handCal = h(`<div class="row"><div class="grow"><div class="t">Hand reach</div><div class="d">Increase this to reach the edges with smaller movements. The dashed box in Hand view shows the tracking area; drag its header to move the view. Swipe an open hand to shift a panel, or hold a thumbs-down to close it.</div></div><input type="range" min="4" max="35" value="${handMargin}" aria-label="Hand reach"><span>${handMargin}%</span></div>`);
    const handRange = $('input', handCal);
    handRange.oninput = () => { $('span', handCal).textContent = `${handRange.value}%`; };
    handRange.onchange = () => relay.set('settings.hands.margin', Number(handRange.value) / 100);
    hcard.append(handCal);
    const pvOn = !!S.settings.hands?.preview;
    const prow = h(`<div class="row"><div class="grow"><div class="t">Show hand view (top right)</div><div class="d">A small window in the top right of the screen shows the camera, the outline of each hand it finds, what each hand is doing (fist, pinch, peace sign…) and how many hands it sees. The picture stays in that window; nothing is saved or sent. You can also say "hands" to open it and "hide hands" to put it away.</div></div><div class="toggle ${pvOn ? 'on' : ''}"></div></div>`);
    prow.onclick = async () => { if (!pvOn && !handsOn) { const r = await relay.setHands(true); if (r && !r.ok) { alert(r.error); return; } } relay.setHandsPreview(!pvOn); };
    hcard.append(prow);
    hcard.append(h('<div class="row" style="display:block"><div class="t">What your hands do</div><div class="d" style="line-height:1.8">Open hand: moves the ring.  Fist: grab a hologram or a piece and carry it; open the hand to let go.  Thumb and finger tapped together: click; held and moved: turn the model.  Two hands pinching: resize (turn them like a wheel to roll it).  Two fists pulled apart: take it apart; together: put it back.  Quick swipe: next or previous model.  Thumb up held: keep it; thumb down held: close it.  Peace sign held: talk to Relay about the hologram your hand is on.  Point at a piece for a moment: pick it.</div></div>'));
    c.append(hcard);

    title('Ask Relay');
    const ask = h('<div class="card flat"></div>');
    const lookNow = S.settings.look === 'classic' ? 'classic' : 'jarvis';
    const look = h(`<div class="row talk" style="flex-wrap:wrap"><div class="t">Look</div><div class="seg">${[['jarvis', 'Jarvis'], ['classic', 'Classic']].map(([v, l]) => `<button data-v="${v}" class="${lookNow === v ? 'on' : ''}">${l}</button>`).join('')}</div><div class="note foot" style="flex-basis:100%">Jarvis: a reactor appears in the middle of the screen while you talk, then works in the top left corner. Classic: the compact pill.</div></div>`);
    look.onclick = (e) => e.target.dataset.v && relay.set('settings.look', e.target.dataset.v);
    ask.append(
      look,
      (() => {
        const hwc = S.settings.homework || {};
        const row = h(`<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="t">Homework helper</div><div class="d">Select an assignment (or open it on screen) and say “outline this essay”, “walk me through this problem”, “give me a template for this assignment”, “check my answer”, “give me feedback on my essay” or “do this assignment”. Results are saved in Documents/Relay Homework as a Word file or PDF, and code as a folder. Use it only where your teacher allows AI help, and use what it makes to learn, not just to hand in. Say “use this as my writing sample” with some of your own writing selected so drafts sound like you.</div></div>
          <div style="flex-basis:100%;display:flex;gap:8px;margin-top:8px;align-items:center"><span class="d" style="margin:0">Save as</span><div class="select" style="margin:0"><span id="hwfname"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="hwfmt"><option value="docx">Word</option><option value="pdf">PDF</option><option value="md">Plain text</option></select></div></div>
          <input class="field" id="hwstyle" style="flex-basis:100%;margin-top:8px" placeholder="How you would describe your writing voice (optional)" value="${esc(hwc.voiceStyle || '')}">
          <textarea class="field" id="hwsample" rows="4" style="flex-basis:100%;margin-top:8px;resize:vertical" placeholder="A sample of your own writing (optional)">${esc(hwc.voiceSample || '')}</textarea></div>`);
        const sel = $('#hwfmt', row);
        sel.value = ['docx', 'pdf', 'md'].includes(hwc.format) ? hwc.format : 'docx';
        $('#hwfname', row).textContent = sel.options[sel.selectedIndex].text;
        sel.onchange = () => { relay.set('settings.homework.format', sel.value); $('#hwfname', row).textContent = sel.options[sel.selectedIndex].text; };
        $('#hwstyle', row).onchange = (e) => relay.set('settings.homework.voiceStyle', e.target.value.trim().slice(0, 400));
        $('#hwsample', row).onchange = (e) => relay.set('settings.homework.voiceSample', e.target.value.trim().slice(0, 4000));
        return row;
      })(),
      toggleRow('Allow whole solutions (complete the assignment)', 'On: “do this assignment” makes the complete solution (a full draft, a working project, every step of a problem). Off: it makes a template or outline to fill in instead.', 'settings.homework.full'),
      toggleRow('Explain what it made', 'Adds a short “How it works” section to a full solution so you can explain it in your own words.', 'settings.homework.explain'),
      toggleRow('Keep answers on screen until I dismiss them', 'An answer stays up until you say “ok” (or “thanks”, “got it”, “close”), press Esc, or ask the next thing. Short replies like “Paused” still go by themselves. An answer you walked away from goes after ten minutes. Off: answers go after a few seconds.', 'settings.answerStays'),
      toggleRow('Let Relay do things for you', 'Off: it only types what you say.', 'settings.actEnabled'),
      toggleRow('Ask before leaving my home folder', 'On: Relay asks first whenever a tool reads, opens, moves or runs something outside your home folder (an external drive, Applications, system folders). Background agents are refused instead of asking. Programs in /usr/bin and temporary files are not counted.', 'settings.homeOnly'),
      toggleRow('Relay cursor', "Shows Relay's own pointer, drawings and step-by-step guides on your screen.", 'settings.cursor'),
      toggleRow('Cursor buddy', 'A small arrow follows your pointer, like a second cursor, and flies to what Relay points at. Off: it is put away.', 'settings.buddy'),
      (() => {
        const row = h(`<div class="row"><div class="grow"><div class="t">Name in the reactor</div><div class="d">Shown in the middle of the big reactor when you ask by voice.</div></div><input class="field" style="width:160px" value="${esc(S.settings.assistantName || 'J.A.R.V.I.S')}"></div>`);
        $('input', row).onchange = (e) => relay.set('settings.assistantName', e.target.value.trim().slice(0, 14) || 'J.A.R.V.I.S');
        return row;
      })(),
      toggleRow('Listen for “Hey Jarvis”', 'Relay listens on this Mac for your wake phrase, so you can start without a key. Nothing is recorded or sent anywhere; the words are read and thrown away. The orange microphone dot stays on while it listens, and it uses some battery.', 'settings.wake.enabled'),
      (() => {
        const row = h(`<div class="row"><div class="grow"><div class="t">Wake phrase</div><div class="d">Two or three clear words work best, like “hey jarvis” or “hey relay”.</div></div><input class="field" style="width:200px" value="${esc((S.settings.wake && S.settings.wake.phrase) || 'hey jarvis')}"></div>`);
        $('input', row).onchange = (e) => { const v = e.target.value.trim().toLowerCase(); if (v) relay.set('settings.wake.phrase', v); };
        return row;
      })(),
      (() => {
        const row = h(`<div class="row"><div class="grow"><div class="t">Only listen in these apps</div><div class="d">Optional. Names separated by commas, like “Xcode, Terminal”: “Hey Jarvis” then only works while one of them is in front, which cuts false triggers. Leave empty to listen everywhere, always.</div></div><input class="field" style="width:200px" placeholder="everywhere" value="${esc(((S.settings.wake && S.settings.wake.apps) || []).join(', '))}"></div>`);
        $('input', row).onchange = (e) => relay.set('settings.wake.apps', e.target.value.split(',').map((x) => x.trim()).filter(Boolean));
        return row;
      })(),
      toggleRow('Keep listening after an answer', 'After you ask out loud and Relay answers, it listens for a few seconds more, so you can say “and the next one?” without pressing anything.', 'settings.followUp.enabled'),
      toggleRow('Interrupt by talking', 'While Relay is speaking, say “stop” or just start talking and it stops mid-sentence. Works best with headphones (without them it can hear itself).', 'settings.bargeIn.enabled'),
      (() => {
        const cur = (S.settings.bargeIn && S.settings.bargeIn.mode) || 'talk';
        const row = h(`<div class="row"><div class="grow"><div class="t">Interrupt with</div><div class="d">“Any speech” also stops when you talk over it. “Stop words only” listens just for stop, quiet, wait and similar.</div></div><div class="seg sm">${[['talk', 'Any speech'], ['word', 'Stop words only']].map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}" style="width:110px">${l}</button>`).join('')}</div></div>`);
        row.onclick = (e) => e.target.dataset.v && relay.set('settings.bargeIn.mode', e.target.dataset.v);
        return row;
      })(),
      (() => {
        const row = h(`<div class="row"><div class="grow"><div class="t">Focus mode closes these apps</div><div class="d">Say “focus mode for 25 minutes”: these apps are quit, a timer starts, and they reopen when it ends. For Do Not Disturb, make two Shortcuts named “Relay Focus On” and “Relay Focus Off” with the Set Focus action.</div></div><input class="field" style="width:230px" value="${esc(((S.settings.focus && S.settings.focus.apps) || []).join(', '))}"></div>`);
        $('input', row).onchange = (e) => relay.set('settings.focus.apps', e.target.value.split(',').map((x) => x.trim()).filter(Boolean));
        return row;
      })(),
      toggleRow('Pause music when I leave the desk', 'Uses the camera, all the time while on (the green light stays on): it only counts faces once a second, on this Mac. Nothing is recognised, saved or sent. When nobody has been there for a minute it pauses the music, and plays it again when you are back.', 'settings.presence.enabled'),
      toggleRow('Lock my Mac when I leave too', 'Also locks the screen when you have been away.', 'settings.presence.lock'),
      (() => {
        const cur = (S.settings.presence && S.settings.presence.awayAfter) || 60;
        const row = h(`<div class="row"><div class="grow"><div class="t">Count me as away after</div><div class="d">How long with no face in front of the camera. Short enough to notice you left, long enough not to fire when you look away.</div></div><div class="seg sm">${[[30, '30 s'], [60, '1 min'], [180, '3 min'], [600, '10 min']].map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}" style="width:64px">${l}</button>`).join('')}</div></div>`);
        row.onclick = (e) => e.target.dataset.v && relay.set('settings.presence.awayAfter', Number(e.target.dataset.v));
        return row;
      })(),
      (() => {
        const b = S.settings.briefing || {};
        const row = h(`<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="t">Morning briefing</div><div class="d">Say “good morning” or “brief me”: the weather, today's calendar (this Mac's and Google's), what is due, and important unread email. To hear it every day, say “every weekday at 7 brief me”. Your city is only used to look up the weather.</div></div><input class="field" id="bcity" style="width:170px" placeholder="City, e.g. Hollywood, Florida" value="${esc(b.city || '')}"><input class="field" id="bname" style="width:110px;margin-left:8px" placeholder="Your name" value="${esc(b.name || '')}"></div>`);
        $('#bcity', row).onchange = (e) => relay.set('settings.briefing.city', e.target.value.trim().slice(0, 80));
        $('#bname', row).onchange = (e) => relay.set('settings.briefing.name', e.target.value.trim().slice(0, 30));
        return row;
      })(),
      (() => {
        const r = (S.settings.robotics || {});
        const row = h(`<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="t">Robotics log sheet</div><div class="d">Say “log this, drifted left on the ramp” and Relay adds a line (time, note) to this Google Sheet. Paste the sheet's link. Needs a connected Google account. Also: “what devices are connected”, “what's on my SD card”, and “start the match day checklist”.</div></div><input class="field" id="rsheet" style="width:230px" placeholder="Google Sheet link" value="${r.sheetId ? 'Sheet set (ends ' + esc(r.sheetId.slice(-6)) + ')' : ''}"></div>`);
        $('#rsheet', row).onchange = (e) => { const m = e.target.value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/); relay.set('settings.robotics.sheetId', m ? m[1] : ''); };
        return row;
      })(),
      (() => {
        const m = S.settings.meeting || {};
        const row = h(`<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="t">Private meeting answers</div><div class="d">Say “meeting assistant” (or use the menu bar) and Relay listens for questions in your meeting, then shows a short answer top right within a second or two, and checks it online. The window is kept out of screen sharing and recordings, takes no clicks, and Relay never speaks while it is on. It hears what this Mac's microphone hears: on headphones that is only you, so pick a loopback audio source (such as BlackHole) below to hear the call. Tell people if you record. Use it only where AI help is allowed: not in tests, graded work or interviews that forbid it.</div></div><input class="field" id="mnames" style="width:230px" placeholder="Names to answer to, e.g. Sergey, Serge" value="${esc(m.names || '')}"><div style="flex-basis:100%;display:flex;gap:8px;margin-top:8px"><div class="select" style="margin:0;max-width:300px"><span id="msrc" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="msrcsel"></select></div><button class="btn" id="mtest">Test the private window</button></div></div>`);
        $('#mnames', row).onchange = (e) => relay.set('settings.meeting.names', e.target.value.trim().slice(0, 120));
        $('#mtest', row).onclick = () => relay.ask.open('test the private window');
        const sel = $('#msrcsel', row);
        const fill = (info) => {
          const opts = [['', 'Same as the microphone setting'], ...(info?.list || []).map((d) => [d.uid, d.name])];
          sel.innerHTML = opts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
          sel.value = opts.some(([v]) => v === (m.input || '')) ? (m.input || '') : '';
          $('#msrc', row).textContent = sel.options[sel.selectedIndex]?.text || '';
        };
        fill(null);
        relay.inputDevices().then((info) => { if (page === 'general') fill(info); });
        sel.onchange = () => { relay.set('settings.meeting.input', sel.value); $('#msrc', row).textContent = sel.options[sel.selectedIndex].text; };
        return row;
      })(),
      toggleRow('Hide the answer window from screen sharing', 'On: the private window is excluded from screen shares and recordings. It is not guaranteed with every capture tool, so use “Test the private window” with the app you share with. Off: it shows like any window.', 'settings.meeting.hidden'),
      toggleRow('Only answer when my name is said', 'Off: any question in the meeting gets an answer. On: only a question with one of your names right before or after it.', 'settings.meeting.nameOnly'),
      toggleRow('Evening recap', 'Around 8:30 PM Relay shows a notification with what it did today: what it changed, anything worth a second look (sent, moved to the Trash, ran a command), and what you can undo with one tap in History > Actions. Say “daily recap” or “what did you do today” any time. Only shown on days when something changed.', 'settings.recap.enabled'),
      toggleRow('Clipboard history', 'Remembers the text you copy, so you can ask “what did I copy earlier?”. Kept only in memory (never saved to disk, gone when Relay quits), for a day. Never kept: anything a password manager marks as secret, or that looks like a password, key, card or social security number. Say “clear my clipboard history” any time.', 'settings.clipboardHistory.enabled'),
      toggleRow('Workshop mode', 'For teaching younger students: Relay speaks slowly and calmly, keeps answers short and simple, and can show holograms of how attacks and defences work (“show me how phishing works”: phishing, man in the middle, DDoS, SQL injection, password hashing, encryption, firewalls). Say “workshop mode” to turn it on, “end workshop mode” to turn it off.', 'settings.workshop.enabled'),
      toggleRow('Tidy my Downloads each evening', 'Around 9 PM Relay looks at new files in Downloads and shows where each would go (pictures, PDFs, documents…). Nothing moves until you say “apply the plan”, nothing is ever deleted, and you can undo it.', 'settings.downloadsTidy.enabled'),
      toggleRow('Speak replies', 'Reads each answer aloud.', 'settings.speakReplies'),
      toggleRow('Liquid glass pill', "Draws the pill with your Mac's real see-through glass. Off: a plain dark pill.", 'settings.glass')
    );
    c.append(ask);

    title('Startup');
    const st = h('<div class="card flat"></div>');
    st.append(toggleRow('Open at login', '', 'settings.openAtLogin'), toggleRow('Show in Dock', '', 'settings.showInDock'));
    c.append(st);

    title('Privacy');
    c.append(h('<div class="card flat"><div class="row"><div><div class="t">No analytics</div><div class="d">Your voice is turned into words on this Mac. Only the words go to Claude, and only when you ask Relay to do something.</div></div></div></div>'));
    c.append(h('<div style="height:10px"></div>'));
  },

  speech(c) {
    const sp = S.speech;
    c.append(h('<div class="section-title" style="margin-top:0">Speech</div>'));
    const card = h('<div class="card"></div>');
    let status;
    if (!sp.available) status = '<span class="bad">Not installed</span>';
    else if (sp.error) status = `<span class="bad">${esc(sp.error)}</span>`;
    else if (sp.preparing !== null && sp.preparing !== undefined) status = `<span class="note">Getting ready ${Math.round(sp.preparing * 100)}%</span>`;
    else if (sp.prepared) status = '<span class="ok" style="display:inline-flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" style="fill:var(--accent)"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="color:var(--link)">In use</span></span>';
    else status = '<span class="note">Getting ready…</span>';
    card.append(h(`<div class="row"><div class="grow"><div class="t" style="font-weight:600">Apple on-device speech</div><div class="d">Fast and accurate for everyday talking. Built into your Mac.</div>${sp.preparing != null ? `<div class="progress"><i style="width:${Math.round(sp.preparing * 100)}%"></i></div>` : ''}</div><div>${status}</div></div>`));
    const lang = h('<div class="row"><div class="grow"><div class="t" style="font-weight:600">Language</div><div class="d">What you speak in.</div></div><div class="select" style="margin:0"><span id="lname"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="lsel"></select></div></div>');
    const sel = $('#lsel', lang);
    const cur = S.settings.speech.locale;
    const fill = (list) => {
      const items = list && list.length ? list : [{ id: cur, name: cur }];
      sel.innerHTML = items.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
      sel.value = items.some((l) => l.id === cur) ? cur : items[0].id;
      $('#lname', lang).textContent = sel.options[sel.selectedIndex]?.text || cur;
    };
    fill(locales);
    if (!locales) relay.speechLocales().then((l) => { locales = l; if (page === 'speech') fill(l); });
    sel.onchange = () => { relay.setSpeechLocale(sel.value); $('#lname', lang).textContent = sel.options[sel.selectedIndex].text; };
    card.append(lang);
    card.append(h('<div class="row"><div class="grow"><div class="d">You can also change it by voice: say “speak Spanish”, “habla español” or “parle français”. Relay understands and answers in any language; the microphone listens in one at a time, and answers are read in the language they are written in.</div></div></div>'));
    {
      const replyNow = (S.settings.language && S.settings.language.reply) || 'auto';
      const names = [['auto', 'The language I asked in'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ru', 'Russian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['tr', 'Turkish'], ['pl', 'Polish']];
      const row = h(`<div class="row"><div class="grow"><div class="t" style="font-weight:600">Answers in</div><div class="d">Auto: the language you spoke or typed. Or always one language.</div></div><div class="select" style="margin:0"><span id="rlname"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="rlsel">${names.map(([v, n]) => `<option value="${v}" ${v === replyNow ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`);
      const rs = $('#rlsel', row);
      $('#rlname', row).textContent = rs.options[rs.selectedIndex].text;
      rs.onchange = () => { relay.set('settings.language.reply', rs.value); $('#rlname', row).textContent = rs.options[rs.selectedIndex].text; };
      card.append(row);
    }
    {
      const uiNow = (S.settings.language && S.settings.language.ui) || 'en';
      const row = h(`<div class="row"><div class="grow"><div class="t" style="font-weight:600">Menus and settings in</div><div class="d">Relay's menu bar, sidebar, page titles and setting names. The longer explanations stay in English for now.</div></div><div class="select" style="margin:0"><span id="uiname"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="uisel"><option value="en" ${uiNow === 'en' ? 'selected' : ''}>English</option><option value="es" ${uiNow === 'es' ? 'selected' : ''}>Español</option></select></div></div>`);
      const us = $('#uisel', row);
      $('#uiname', row).textContent = us.options[us.selectedIndex].text;
      us.onchange = () => { relay.set('settings.language.ui', us.value); };
      card.append(row);
    }
    const mic = h('<div class="row"><div class="grow"><div class="t" style="font-weight:600">Microphone</div><div class="d" id="mdesc"></div></div><div class="select" style="margin:0;max-width:260px"><span id="mname" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="msel"></select></div></div>');
    const msel = $('#msel', mic);
    const curIn = S.settings.speech.input || 'auto';
    const fillMic = (info) => {
      const opts = [['auto', 'Automatic'], ['default', `System default${info?.default ? ` (${info.default})` : ''}`], ...(info?.list || []).map((d) => [d.uid, d.name])];
      msel.innerHTML = opts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
      msel.value = opts.some(([v]) => v === curIn) ? curIn : 'auto';
      $('#mname', mic).textContent = msel.options[msel.selectedIndex]?.text || 'Automatic';
      $('#mdesc', mic).textContent = curIn === 'auto' ? `Using ${info?.using || sp.device || 'the system default'}. The built-in mic is used when a headset is connected, so it does not drop into call quality.` : `Using ${info?.using || sp.device || 'the selected microphone'}.`;
    };
    fillMic(null);
    relay.inputDevices().then((info) => { if (page === 'speech') fillMic(info); });
    msel.onchange = () => { relay.setInput(msel.value); $('#mname', mic).textContent = msel.options[msel.selectedIndex].text; };
    card.append(mic);
    c.append(card);
    // ---- spoken replies ----
    c.append(h('<div class="section-title">Spoken replies</div>'));
    const vcard = h('<div class="card"></div>');
    const vrow = h('<div class="row"><div class="grow"><div class="t" style="font-weight:600">Voice</div><div class="d" id="vdesc">Used when Speak replies is on (General).</div></div><div style="display:flex;gap:8px;align-items:center"><div class="select" style="margin:0;max-width:240px"><span id="vname" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="vsel"></select></div><button class="btn" id="vprev">Preview</button></div></div>');
    const vsel = $('#vsel', vrow);
    const curVoice = S.settings.voice || 'auto';
    const fillVoices = (info) => {
      const list = info?.voices || [];
      const opts = [['auto', `Automatic${info?.picked ? ` (${info.picked.replace(/ \(.*$/, '')})` : ''}`], ['jarvis', `Jarvis (British${info?.jarvis ? `, ${info.jarvis.replace(/ \(.*$/, '')}` : ''})`], ...list.map((v) => [v.name, `${v.name.replace(/ \(.*$/, '')}${v.kind === 'Standard' ? '' : ' · ' + v.kind}${v.lang !== 'en_US' ? ' · ' + v.lang.replace('_', '-') : ''}`])];
      const seen = new Set();
      vsel.innerHTML = opts.filter(([v]) => !seen.has(v) && seen.add(v)).map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
      vsel.value = [...vsel.options].some((o) => o.value === curVoice) ? curVoice : 'auto';
      $('#vname', vrow).textContent = vsel.options[vsel.selectedIndex]?.text || 'Automatic';
      const natural = list.some((v) => v.lang === 'en_US' && (v.kind === 'Premium' || v.kind === 'Siri' || v.kind === 'Enhanced'));
      $('#vdesc', vrow).innerHTML = natural ? 'A natural voice is installed and used automatically.' : 'Download a natural voice for a much better sound: <span class="link" id="vget">System Settings › Accessibility › Spoken Content › System Voice › Manage Voices</span>.';
      $('#vget', vrow) && ($('#vget', vrow).onclick = () => relay.openVoiceSettings());
    };
    fillVoices(null);
    relay.voices().then((info) => { if (page === 'speech') fillVoices(info); });
    vsel.onchange = () => { relay.set('settings.voice', vsel.value); $('#vname', vrow).textContent = vsel.options[vsel.selectedIndex].text; };
    $('#vprev', vrow).onclick = () => relay.previewVoice(vsel.value, S.settings.voiceRate);
    vcard.append(vrow);
    const jrow = h('<div class="row"><div class="grow"><div class="t" style="font-weight:600">Sound like Jarvis</div><div class="d">A calm British male voice, and replies read aloud. With the on-device voice installed it uses George; otherwise Daniel (download his Premium or Enhanced version for the best sound).</div></div><button class="btn" id="jset">Use it</button></div>');
    $('#jset', jrow).onclick = () => {
      relay.set('settings.voice', 'jarvis');
      relay.set('settings.speakReplies', true);
      if (S.kokoro && S.kokoro.installed) { relay.set('settings.tts.engine', 'kokoro'); relay.set('settings.tts.kokoro.voice', 'bm_george'); }
      relay.previewVoice('jarvis', S.settings.voiceRate);
    };
    vcard.append(jrow);
    const softOn = ((S.settings.voices && S.settings.voices.quiet && S.settings.voices.quiet.volume) ?? 0.55) < 1;
    const qrow = h(`<div class="row"><div class="grow"><div class="t">Soft voice for confirmations</div><div class="d">“Timer set for 5 minutes” and similar are spoken quietly. Long answers are read a little slower.</div></div><div class="toggle ${softOn ? 'on' : ''}"></div></div>`);
    qrow.onclick = () => relay.set('settings.voices.quiet.volume', softOn ? 1 : 0.55);
    vcard.append(qrow);
    const rrow = h(`<div class="row"><div class="grow"><div class="t" style="font-weight:600">Speed</div></div><div class="seg sm">${[['slower', 'Slower'], ['normal', 'Normal'], ['faster', 'Faster']].map(([v, l]) => `<button data-v="${v}" class="${(S.settings.voiceRate || 'normal') === v ? 'on' : ''}" style="width:78px">${l}</button>`).join('')}</div></div>`);
    rrow.onclick = (e) => e.target.dataset.v && relay.set('settings.voiceRate', e.target.dataset.v);
    vcard.append(rrow);
    c.append(vcard);
    // ---- more natural voices ----
    c.append(h('<div class="section-title">More natural voices</div>'));
    const T = S.settings.tts || { engine: 'system' };
    const ecard = h('<div class="card"></div>');
    const ENGINES = [['system', 'System'], ['kokoro', 'On-device (beta)'], ['openai', 'OpenAI'], ['elevenlabs', 'ElevenLabs']];
    const eseg = h(`<div class="row talk" style="flex-wrap:wrap"><div class="t">Voice engine</div><div class="seg">${ENGINES.map(([v, l]) => `<button data-v="${v}" class="${T.engine === v ? 'on' : ''}">${l}</button>`).join('')}</div><div class="note foot" style="flex-basis:100%">${{
      system: 'The voice chosen above. Free and instant.',
      kokoro: 'A natural voice that runs on this Mac. Free, no key, and your replies never leave your Mac. Apple Silicon only.',
      openai: 'Natural voices from OpenAI, using your own OpenAI API key. OpenAI bills your account; Relay takes nothing.',
      elevenlabs: 'Some of the most human-sounding voices, using your own ElevenLabs key. ElevenLabs bills your account; Relay takes nothing.'
    }[T.engine] || ''}</div></div>`);
    eseg.onclick = (e) => e.target.dataset.v && relay.set('settings.tts.engine', e.target.dataset.v);
    ecard.append(eseg);
    const field = (label, value, key, { type = 'text', ph = '', wide } = {}) => {
      const row = h(`<div class="row"><div class="grow"><div class="t">${label}</div></div><input class="field" type="${type}" style="width:${wide || 240}px" placeholder="${esc(ph)}" value="${esc(value || '')}"></div>`);
      $('input', row).onchange = (e) => relay.set(key, e.target.value.trim());
      return row;
    };
    const keyRow = (engine, name, url) => {
      const has = S.hasTtsKeys && S.hasTtsKeys[engine];
      const row = h(`<div class="row"><div class="grow"><div class="t">${name} key</div><div class="d">${has ? 'Saved on this Mac (encrypted with your Keychain).' : `Needed. <span class="link" data-get>Get one</span>`}</div></div><input class="field" type="password" style="width:200px" placeholder="${has ? '••••••••••••' : 'Paste your key'}"><button class="btn">Save</button></div>`);
      $('[data-get]', row) && ($('[data-get]', row).onclick = () => relay.openExternal(url));
      $('button', row).onclick = async () => { const v = $('input', row).value.trim(); if (v) { await relay.setTtsKey(engine, v); } };
      return row;
    };
    if (T.engine === 'openai') {
      ecard.append(keyRow('openai', 'OpenAI', 'https://platform.openai.com/api-keys'));
      const vsel = h(`<div class="row"><div class="grow"><div class="t">Voice</div></div><div class="select" style="margin:0"><span>${esc(T.openai.voice)}</span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select>${['coral', 'marin', 'cedar', 'alloy', 'ash', 'ballad', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map((v) => `<option ${v === T.openai.voice ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`);
      $('select', vsel).onchange = (e) => relay.set('settings.tts.openai.voice', e.target.value);
      ecard.append(vsel, field('Model', T.openai.model, 'settings.tts.openai.model'), field('Style', T.openai.instructions, 'settings.tts.openai.instructions', { ph: 'How it should speak', wide: 320 }));
    } else if (T.engine === 'elevenlabs') {
      ecard.append(keyRow('elevenlabs', 'ElevenLabs', 'https://elevenlabs.io/app/settings/api-keys'));
      const vrow2 = field('Voice ID', T.elevenlabs.voiceId, 'settings.tts.elevenlabs.voiceId', { ph: 'Copy it from your voice library' });
      ecard.append(vrow2, field('Model', T.elevenlabs.model, 'settings.tts.elevenlabs.model'));
      ecard.append(h('<div class="row"><div class="grow"><div class="d">Pick a voice in the <span class="link" data-lib>ElevenLabs voice library</span>, add it to your voices, and paste its ID here.</div></div></div>'));
      $('[data-lib]', ecard).onclick = () => relay.openExternal('https://elevenlabs.io/app/voice-library');
    } else if (T.engine === 'kokoro') {
      const k = S.kokoro || {};
      if (!k.supported) ecard.append(h('<div class="row"><div class="grow"><div class="d">The on-device voice needs an Apple Silicon Mac. Use a Mac voice or an online voice instead.</div></div></div>'));
      else if (k.installed) {
        const sel = h(`<div class="row"><div class="grow"><div class="t">Voice</div><div class="d">Installed. Runs fully on this Mac.</div></div><div class="select" style="margin:0"><span>${esc((KOKORO_VOICES.find(([v]) => v === T.kokoro.voice) || KOKORO_VOICES[0])[1])}</span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select>${KOKORO_VOICES.map(([v, l]) => `<option value="${v}" ${v === T.kokoro.voice ? 'selected' : ''}>${l}</option>`).join('')}</select></div><button class="btn" data-rm>Remove</button></div>`);
        $('select', sel).onchange = (e) => relay.set('settings.tts.kokoro.voice', e.target.value);
        $('[data-rm]', sel).onclick = () => relay.removeKokoro();
        ecard.append(sel);
      } else {
        const pct = Math.round((k.progress || 0) * 100);
        const row = h(`<div class="row"><div class="grow"><div class="t">Download the voice</div><div class="d">${k.installing ? `Downloading… ${pct}%${k.stage ? ` (${esc(k.stage)})` : ''}` : 'About 270 MB, once. Needs internet only for this download.'}</div></div><button class="btn primary" ${k.installing ? 'disabled' : ''}>${k.installing ? 'Downloading…' : 'Download'}</button></div>`);
        $('button', row).onclick = () => relay.installKokoro();
        ecard.append(row);
      }
    }
    const trow = h(`<div class="row"><div class="grow"><div class="t">Try it</div><div class="d" id="tstatus" style="${S.voiceProblem ? 'color:var(--orange)' : ''}">${esc(S.voiceProblem || 'Plays a short sentence in the voice above.')}</div></div><button class="btn">Test voice</button></div>`);
    $('button', trow).onclick = async () => { $('#tstatus', trow).textContent = 'Speaking…'; const r = await relay.testTts(); if (r && r.ok) $('#tstatus', trow).textContent = 'That is the voice. Turn on Speak replies in General to hear it on every answer.'; };
    ecard.append(trow);
    c.append(ecard);
    // ---- dictation style by app ----
    c.append(h('<div class="section-title">Dictation style by app</div>'));
    const STYLE_OPTS = [['default', 'As spoken'], ['casual', 'Casual'], ['chat', 'Chat (press Return)']];
    const styles = S.settings.appStyles || [];
    const scard = h('<div class="card"></div>');
    const styleSelect = (cur) => `<div class="select" style="margin:0"><span>${esc((STYLE_OPTS.find(([v]) => v === cur) || STYLE_OPTS[0])[1])}</span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select>${STYLE_OPTS.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    styles.forEach((r, i) => {
      const row = h(`<div class="row" style="min-height:44px"><div class="grow"><div class="t" style="font-weight:600">${esc(r.app)}</div></div>${styleSelect(r.style)}<button class="btn" data-del>Remove</button></div>`);
      $('select', row).onchange = (e) => relay.set('settings.appStyles', styles.map((x, j) => (j === i ? { ...x, style: e.target.value } : x)));
      $('[data-del]', row).onclick = () => relay.set('settings.appStyles', styles.filter((_, j) => j !== i));
      scard.append(row);
    });
    const addRow = h(`<div class="row" style="min-height:44px"><input class="field" id="sapp" list="runapps" placeholder="App name, such as Messages" style="max-width:240px"><datalist id="runapps"></datalist>${styleSelect('casual')}<button class="btn primary" id="sadd">Add</button></div>`);
    relay.runningApps().then((apps) => { $('#runapps', addRow).innerHTML = apps.map((a) => `<option value="${esc(a)}">`).join(''); });
    $('select', addRow).onchange = (e) => { $('.select span', addRow).textContent = STYLE_OPTS.find(([v]) => v === e.target.value)[1]; };
    $('#sadd', addRow).onclick = () => {
      const app = $('#sapp', addRow).value.trim();
      if (!app) return;
      relay.set('settings.appStyles', [...styles.filter((x) => x.app.toLowerCase() !== app.toLowerCase()), { app, style: $('select', addRow).value }]);
    };
    scard.append(addRow);
    c.append(scard);
    c.append(h('<div class="note" style="margin:10px 4px 0">Casual types lowercase with no final period. Chat does the same, then presses Return to send. Say "new line", "new paragraph" or "scratch that" while dictating.</div>'));
    c.append(h(`<div class="lockline">${icon('lock')}<span>Speech is turned into words on this Mac. Your voice isn't sent anywhere. Only the words go to Claude when you ask Relay to do something.</span></div>`));
  },

  shortcuts(c) {
    c.append(h('<div class="section-title plain">Click a shortcut to change it</div>'));
    const card = h('<div class="card"></div>');
    const row = (key, ic, t, d, blue) => {
      const active = capturing && capturing.key === key;
      const lbl = active ? 'Press keys…' : S.labels[key];
      const el = h(`<div class="row" style="min-height:59px;--div:54px;padding:10px 16px 10px 17px"><div style="display:flex;gap:15px;align-items:center"><span class="get-row" style="padding:0;min-height:0;width:22px"><span class="ic ${blue ? 'blue' : ''}">${icon(ic)}</span></span><div><div class="ttl">${t}</div><div class="d s13">${d}</div></div></div><button class="kbd" style="${active ? 'background:var(--accent);color:#fff' : ''}">${esc(lbl)}</button></div>`);
      $('.kbd', el).onclick = () => { setCapturing({ key, mod: null }); render(); };
      return el;
    };
    card.append(row('ask', 'wave', 'Ask Relay', 'Talk, then send. Press while it works to stop it.', true));
    card.append(row('dictate', 'mic', 'Dictate', 'Talk; the words are typed where your cursor is.'));
    card.append(row('type', 'keyboard', 'Type a request', "For when talking isn't an option. Press again to close."));
    card.append(row('mark', 'record', 'Mark the screen', 'Hold it and move the pointer round something, then let go and ask about it. No clicking. Use one modifier key on its own.'));
    c.append(card);
    c.append(h('<div class="note" style="margin:16px 12px;line-height:16px">A key with ⌃, ⌥ or ⌘, an F-key, or one modifier on its own like Right ⌥. Esc cancels.<br><span class="link" id="reset">Reset to defaults</span></div>'));
    $('#reset', c).onclick = () => relay.resetShortcuts();
  },

  doctor(c) {
    if (!doctorData && !doctorBusy) { doctorBusy = true; relay.doctorRun().then((d) => { doctorData = d; doctorBusy = false; if (page === 'doctor') render(); }); }
    const d = doctorData;
    c.append(h('<div class="section-title" style="margin-top:0">Relay Doctor</div>'));
    const card = h('<div class="card"></div>');
    if (!d) card.append(h('<div class="row"><div class="grow"><div class="t">Checking…</div></div></div>'));
    for (const r of d?.results || []) {
      const colour = { ok: '#30d158', warn: '#ff9f0a', fail: '#ff453a' }[r.status];
      const word = { ok: 'OK', warn: 'Look', fail: 'Broken' }[r.status];
      const auto = r.fix?.policy === 'auto';
      const row = h(`<div class="row" style="align-items:flex-start"><span style="width:8px;height:8px;border-radius:50%;background:${colour};margin-top:7px;flex:none"></span><div class="grow"><div class="t">${esc(r.title)} <span class="d" style="display:inline">· ${word}</span></div><div class="d">${esc(r.cause || '')}</div></div>${r.fix && !auto ? '<button class="btn fix"></button>' : ''}${auto ? '<span class="d">Fixed automatically</span>' : ''}</div>`);
      if (r.fix && !auto) {
        const b = $('.fix', row);
        b.textContent = r.fix.label;
        b.onclick = async () => { b.disabled = true; const res = await relay.doctorFix(r.fix.id); b.textContent = res.copied ? 'Copied' : 'Done'; setTimeout(() => { doctorData = null; render(); }, 1200); };
      }
      card.append(row);
    }
    c.append(card);
    const bar = h('<div class="row" style="gap:10px;justify-content:flex-start;flex-wrap:wrap"><button class="btn" id="dragain">Check again</button><button class="btn" id="dcopy">Copy report</button><button class="btn" id="dbug">Report a bug</button><button class="btn" id="dfeat">Request a feature</button></div>');
    $('#dragain', bar).onclick = () => { doctorData = null; render(); };
    $('#dcopy', bar).onclick = async (e) => { await relay.doctorReport(); e.target.textContent = 'Copied'; };
    $('#dbug', bar).onclick = () => relay.doctorIssue('bug');
    $('#dfeat', bar).onclick = () => relay.doctorIssue('feature');
    c.append(bar);
    c.append(h('<div class="d" style="margin:4px 4px 14px">The report has your home folder, emails, keys and network addresses removed. Report a bug and Request a feature copy it, then open GitHub in your browser; nothing is sent until you press submit there.</div>'));

    const mode = S.settings.doctor?.fix || 'ask';
    const fm = h(`<div class="card"><div class="row"><div class="grow"><div class="t">When Doctor can fix something</div><div class="d">Small fixes (restarting Relay's own phone server) can run by themselves. Permissions and signing always ask you.</div></div><div class="select"><span id="dfn"></span><select><option value="ask">Ask first</option><option value="small">Fix small things</option><option value="never">Only tell me</option></select></div></div></div>`);
    const sel = $('select', fm);
    sel.value = mode;
    $('#dfn', fm).textContent = sel.options[sel.selectedIndex].text;
    sel.onchange = () => relay.set('settings.doctor.fix', sel.value);
    c.append(fm);

    if (Object.keys(S.flagList || {}).length) c.append(h('<div class="section-title">Experimental</div>'));
    const ex = h('<div class="card"></div>');
    for (const [name, f] of Object.entries(S.flagList || {})) {
      const on = !!S.settings.flags?.[name];
      const row = h(`<div class="row"><div class="grow"><div class="t">${esc(f.label)}</div><div class="d">${esc(f.desc)}</div><div class="d warn" hidden></div></div><div class="toggle ${on ? 'on' : ''}"></div></div>`);
      row.onclick = async () => { const res = await relay.setFlag(name, !on); if (res && res.ok === false) { const w = $('.warn', row); w.textContent = res.why; w.hidden = false; } };
      ex.append(row);
    }
    if (ex.children.length) c.append(ex, h('<div class="d" style="margin:4px 4px 14px">New features start off. Turn one on to try it; turn it off again any time.</div>'));
    if (S.settings.flags?.proactive) {
      const pr = S.settings.proactive || { mode: 'silent-urgent', quiet: { on: true, from: 22, to: 7 } };
      c.append(h('<div class="section-title">Speak up on its own</div>'));
      const hours = Array.from({ length: 24 }, (_, i) => `<option value="${i}">${i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}</option>`).join('');
      const bx = h(`<div class="card"><div class="row"><div class="grow"><div class="t">How loud</div><div class="d">Relay tells you about a meeting about to start, a long job that finished, or a low battery.</div></div><div class="select"><span id="prm"></span><select id="prs"><option value="silent-urgent">Quiet banner, speak only if urgent</option><option value="silent">Always quiet</option><option value="speak">Speak anything important</option></select></div></div><div class="row"><div class="grow"><div class="t">Quiet hours</div><div class="d">Nothing is spoken then, and only the most urgent things reach your phone.</div></div><div style="display:flex;gap:8px;align-items:center"><select id="pqf">${hours}</select><span class="d">to</span><select id="pqt">${hours}</select><div class="toggle ${pr.quiet?.on ? 'on' : ''}" id="pqo"></div></div></div></div>`);
      const ps = $('#prs', bx); ps.value = pr.mode || 'silent-urgent'; $('#prm', bx).textContent = ps.options[ps.selectedIndex].text;
      ps.onchange = () => relay.set('settings.proactive.mode', ps.value);
      $('#pqf', bx).value = String(pr.quiet?.from ?? 22); $('#pqt', bx).value = String(pr.quiet?.to ?? 7);
      $('#pqf', bx).onchange = (e) => relay.set('settings.proactive.quiet.from', Number(e.target.value));
      $('#pqt', bx).onchange = (e) => relay.set('settings.proactive.quiet.to', Number(e.target.value));
      $('#pqo', bx).onclick = () => relay.set('settings.proactive.quiet.on', !pr.quiet?.on);
      c.append(bx);
    }
    if (S.settings.flags?.offline) {
      c.append(h('<div class="section-title">Offline mode</div>'));
      c.append(h(`<div class="card"><div class="row"><div class="grow"><div class="t">${S.offlineNow ? 'Offline right now' : 'Online'}</div><div class="d">With no internet, Relay answers plain questions with a local model (Ollama, the one chosen in Account). Anything that needs the Mac or the web waits until you are back online.</div></div></div></div>`));
    }
    if (S.settings.flags?.folderQa) {
      c.append(h('<div class="section-title">Ask my notes</div>'));
      const nl = S.notesList || [];
      const box = h('<div class="card"></div>');
      if (!nl.length) box.append(h('<div class="row"><div class="grow"><div class="d">No folders yet. Add a folder of notes, documents or PDFs, then ask “what did I write about …”. Files named like passwords or keys, and hidden folders, are never read.</div></div></div>'));
      for (const f of nl) {
        const row = h(`<div class="row" style="align-items:flex-start"><div class="grow"><div class="t">${esc(f.path.split('/').pop())}</div><div class="d">${esc(f.path)}</div><div class="d">${f.indexing ? 'Indexing…' : f.chunks ? `${f.files} files, ${f.chunks} passages, searched by ${f.mode === 'meaning' ? 'meaning' : 'words'}${f.skipped ? `, ${f.skipped} without readable text` : ''}${f.truncated ? '. Too big: only the first part is searchable' : ''}.` : 'Not indexed yet.'}</div><div class="d warn" hidden></div></div><div style="display:flex;gap:8px"><button class="btn" data-ni="${esc(f.path)}">${f.chunks ? 'Update' : 'Index now'}</button><button class="btn" data-nr="${esc(f.path)}">Remove</button></div></div>`);
        row.onclick = async (e) => {
          const t = e.target.dataset;
          if (t.nr) relay.notesRemove(t.nr);
          else if (t.ni) { e.target.disabled = true; e.target.textContent = 'Indexing…'; const r = await relay.notesIndex(t.ni); if (!r.ok) { const w = $('.warn', row); w.textContent = r.error || 'Could not index it.'; w.hidden = false; e.target.disabled = false; e.target.textContent = 'Index now'; } }
        };
        box.append(row);
      }
      c.append(box);
      const addb = h('<div class="row" style="margin:12px 0"><button class="btn primary" id="nadd">Add a folder</button><div class="d warn" id="nerr"></div></div>');
      $('#nadd', addb).onclick = async () => { const r = await relay.notesAdd(); if (r && r.error) $('#nerr', addb).textContent = r.error; };
      c.append(addb);
      c.append(h('<div class="d" style="margin:4px 4px 14px">Everything is searched on this Mac. Only the few passages that answer a question are sent to Claude, as part of that question.</div>'));
    }
    if (S.settings.flags?.plugins) {
      c.append(h('<div class="section-title">Plugins</div>'));
      const pl = S.pluginList || [];
      const box = h('<div class="card"></div>');
      if (!pl.length) box.append(h('<div class="row"><div class="grow"><div class="d">No plugins installed. Paste a GitHub link or a folder path below to look at one.</div></div></div>'));
      for (const p of pl) {
        const row = h(`<div class="row" style="align-items:flex-start"><div class="grow"><div class="t">${esc(p.name)} <span class="d" style="display:inline">${esc(p.version)}${p.running ? ' · running' : ''}</span></div><div class="d">${esc(p.description || '')}</div>${p.ok ? p.permissions.map((l) => `<div class="d${l.warn ? ' warn' : ''}">${esc(l.text)}</div>`).join('') : `<div class="d warn">${esc(p.error)}</div>`}${p.changed ? '<div class="d warn">Changed since you approved it, so it is not used. Install it again to approve the change.</div>' : ''}<div class="d" id="pu-${esc(p.name)}"></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn" data-pu="${esc(p.name)}">Check for update</button><button class="btn" data-pr="${esc(p.name)}">Remove</button><div class="toggle ${p.enabled ? 'on' : ''}" data-pe="${esc(p.name)}"></div></div></div>`);
        row.onclick = async (e) => {
          const t = e.target.dataset;
          if (t.pe) relay.pluginEnable(t.pe, !p.enabled);
          else if (t.pr) { if (confirm(`Remove the ${t.pr} plugin and its files?`)) relay.pluginRemove(t.pr); }
          else if (t.pu) { const r = await relay.pluginUpdateCheck(t.pu); $(`[id="pu-${t.pu}"]`, row).textContent = r.available ? `A newer version exists (${String(r.sha).slice(0, 7)}). Paste its link below to look at what changed.` : 'Up to date.'; }
        };
        box.append(row);
      }
      c.append(box);
      const add = h('<div class="field-row" style="margin:12px 0"><input class="field" id="pin" placeholder="github.com/owner/repo, owner/repo or a folder path"><button class="btn primary" id="pgo">Look at it</button></div>');
      const out = h('<div class="card" hidden></div>');
      $('#pgo', add).onclick = async () => {
        const v = $('#pin', add).value.trim();
        if (!v) return;
        out.hidden = false; out.innerHTML = '<div class="row"><div class="d">Looking…</div></div>';
        const r = await relay.pluginInspect(v);
        if (!r.ok) { out.innerHTML = ''; out.append(h(`<div class="row"><div class="d warn">${esc(r.error)}</div></div>`)); return; }
        out.innerHTML = '';
        out.append(h(`<div class="row" style="align-items:flex-start"><div class="grow"><div class="t">${esc(r.name)} ${esc(r.version)}${r.update ? ` <span class="d" style="display:inline">(you have ${esc(r.installedVersion)})</span>` : ''}</div><div class="d">${esc(r.description)}</div><div class="d">Tools: ${esc(r.tools.join(', '))}. ${r.files} files, ${Math.round(r.bytes / 1024)} KB.${r.sha ? ` Exact version: ${esc(r.sha.slice(0, 12))}.` : ''}</div>${r.permissions.map((l) => `<div class="d${l.warn ? ' warn' : ''}">${esc(l.text)}</div>`).join('')}${r.changes.length ? `<div class="t" style="margin-top:8px">What changed</div>${r.changes.map((x) => `<div class="d">${esc(x)}</div>`).join('')}` : ''}</div><div style="display:flex;gap:8px"><button class="btn" id="pno">Cancel</button><button class="btn primary" id="pyes">${r.update ? 'Approve update' : 'Approve and install'}</button></div></div>`));
        $('#pno', out).onclick = () => { relay.pluginCancel(r.token); out.hidden = true; };
        $('#pyes', out).onclick = async () => { const res = await relay.pluginInstall(r.token); if (res.ok) { out.hidden = true; $('#pin', add).value = ''; } else out.append(h(`<div class="row"><div class="d warn">${esc(res.error)}</div></div>`)); };
      };
      c.append(add, out);
      c.append(h('<div class="d" style="margin:4px 4px 14px">A plugin runs as its own program with only what you approve here. Anything it returns is treated as data, never as instructions, and after a plugin has answered, sending, deleting and running commands always ask you first.</div>'));
    }
    if (S.settings.flags?.imessage) {
      c.append(h('<div class="section-title">Command Relay by text</div>'));
      const ib = S.inboundInfo || {};
      const tx = h(`<div class="card"><div class="row"><div class="grow"><div class="t">${ib.paired ? 'Paired with your own message thread' : 'Not paired yet'}</div><div class="d">${ib.paired ? 'Text yourself a request and Relay runs it and texts the answer back. Texts from anyone else are never read.' : 'Press Show code, then text the six digits to yourself in Messages (your own number or Apple ID). The code works once, for 10 minutes.'}${ib.error ? ` <span class="warn">${esc(ib.error)}</span>` : ''}</div><div class="d" id="ibcode" style="font-size:22px;letter-spacing:4px"></div></div><button class="btn" id="ibbtn">${ib.paired ? 'Unpair' : 'Show code'}</button></div><div class="row"><div class="grow"><div class="t">When a question is not answered</div><div class="d">A risky request sent by text asks on the Mac and by text. The first answer wins.</div></div><div class="select"><span id="ibun"></span><select><option value="expire">Skip it after 30 minutes</option><option value="reask">Ask again every hour, 3 times</option><option value="forever">Wait until I answer</option></select></div></div></div>`);
      $('#ibbtn', tx).onclick = async () => { if (ib.paired) { await relay.inboundUnpair(); return; } const r = await relay.inboundCode(); $('#ibcode', tx).textContent = r.code || ''; };
      const isel = $('select', tx);
      isel.value = S.settings.inbound?.unanswered || 'expire';
      $('#ibun', tx).textContent = isel.options[isel.selectedIndex].text;
      isel.onchange = () => relay.set('settings.inbound.unanswered', isel.value);
      c.append(tx);
      const held = (S.queue || []).filter((i) => i.state === 'review');
      if (held.length) {
        const hb = h(`<div class="card">${held.map((i) => `<div class="row"><div class="grow"><div class="t">${esc(i.text)}</div><div class="d">Texted over a day ago, so Relay did not run it.</div></div><div style="display:flex;gap:8px"><button class="btn" data-qn="${esc(i.id)}">Run now</button><button class="btn" data-qd="${esc(i.id)}">Drop</button></div></div>`).join('')}</div>`);
        hb.onclick = (e) => { const t = e.target.dataset; if (t.qn) relay.queueReview(t.qn, true); else if (t.qd) relay.queueReview(t.qd, false); };
        c.append(hb);
      }
      c.append(h('<div class="d" style="margin:4px 4px 14px">Needs Full Disk Access so Relay can read your own thread in Messages; Doctor checks it. Turn on “Queue while the Mac sleeps” above so texts sent while the Mac sleeps wait and a later text can cancel one.</div>'));
    }
  },
  permissions(c) {
    c.append(h('<div class="section-title" style="margin-top:0">On this Mac</div>'));
    const card = h('<div class="card"></div>');
    const prow = (ic, color, t, d, right) => h(`<div class="row" style="min-height:57px;--div:60px;padding:10px 16px"><div style="display:flex;gap:14px;align-items:center"><span class="icon-box" style="background:${color};--bc:${color};width:30px;height:30px;border-radius:8px">${ic}</span><div><div class="ttl">${t}</div><div class="d">${d}</div></div></div><div>${right}</div></div>`);
    const mic = prow(glyph('mic'), '#2a9ee0', 'Microphone', 'Hears you while you use a shortcut.', perms.mic ? allowed : `<button class="btn primary" data-p="mic">${perms.micStatus === 'denied' ? 'Open Settings' : 'Allow'}</button>`);
    const a = prow(glyph('accessibility'), '#1f86cf', 'Accessibility', 'Types for you and works in your apps.', perms.accessibility ? allowed : '<button class="btn primary" data-p="acc">Allow</button>');
    const s = prow(glyph('screen'), '#2aa5d8', 'Screen Recording', "Sees apps it can't read any other way.", perms.screen ? allowed : '<button class="btn primary" data-p="screen">Allow</button>');
    const i = prow(glyph('input'), '#1f86cf', 'Input Monitoring', 'Hears your shortcut keys from any app.', S.hotkeysRunning && S.hotkeysSeen ? allowed : S.hotkeysRunning ? '<span class="note" style="color:var(--dim)">Press any key to check</span>' : '<button class="btn primary" data-p="input">Open Settings</button>');
    const camera = prow(glyph('screen'), '#537bbb', 'Camera', 'Lets hand control see your hands.', perms.camera ? allowed : `<button class="btn primary" data-p="camera">Open Settings</button>`);
    card.append(mic, a, s, i, camera);
    card.onclick = (e) => {
      const p = e.target.dataset.p;
      if (p === 'mic') (perms.micStatus === 'denied' ? relay.openPane('mic') : relay.requestMic());
      if (p === 'acc') relay.requestAccessibility().then(() => relay.openPane('accessibility'));
      if (p === 'screen') relay.openPane('screen');
      if (p === 'input') relay.openPane('input');
      if (p === 'camera') relay.openPane('camera');
    };
    c.append(card);
    if (S.hotkeysError) c.append(h(`<div class="note warn" style="margin-top:10px">Shortcuts are not running: ${esc(S.hotkeysError)}. Grant Accessibility and Input Monitoring, then reopen Relay.</div>`));
    c.append(h('<div class="note" style="margin:11px 4px 0;font-size:13px">Relay asks before anything that sends or deletes, whatever is allowed here.</div>'));

    c.append(h('<div class="section-title">Apps Relay works in</div>'));
    const apps = h('<div class="card"></div>');
    const APPS = [['Notes', 'Works in Notes for you.'], ['Reminders', 'Works in Reminders for you.'], ['Messages', 'Works in Messages for you.'], ['Calendar', 'Reads and adds events.'], ['Finder', 'Shows, opens and trashes files.'], ['Firefox', 'Opens pages and switches tabs.']];
    for (const [name, d] of APPS) {
      const st = automation[name];
      const right = st === 'ok' ? allowed : st === 'denied' ? '<span class="bad">Denied. <span class="link" data-a="pane">Open Settings</span></span>' : '<span class="note" style="color:var(--dim)">Asks the first time</span> <button class="btn" data-a="test" style="margin-left:10px">Test</button>';
      const el = h(`<div class="row" style="min-height:57px;--div:60px;padding:10px 16px"><div style="display:flex;gap:14px;align-items:center"><span class="appicon">${appIcons[name] ? `<img src="${appIcons[name]}">` : ''}</span><div><div class="ttl">${name}</div><div class="d">${d}</div></div></div><div style="text-align:right">${right}</div></div>`);
      el.onclick = async (e) => {
        if (e.target.dataset.a === 'pane') relay.openPane('automation');
        if (e.target.dataset.a === 'test') {
          const r = await relay.testAutomation(name);
          automation[name] = r.ok ? 'ok' : r.denied ? 'denied' : undefined;
          localStorage.setItem('automation', JSON.stringify(automation));
          render();
        }
      };
      apps.append(el);
    }
    c.append(apps);

    c.append(h('<div class="section-title">Firefox</div>'));
    const ff = h(`<div class="card"><div class="row"><div class="grow"><div class="ttl">Better page control</div><div class="d">Optional extension so Relay can read pages, switch tabs and click or type inside them. ${S.firefoxConnected ? '<span class="ok">Connected.</span>' : S.settings.firefox.enabled ? '<span class="warn">Waiting for the extension.</span>' : ''}</div></div><div style="display:flex;gap:10px;align-items:center"><div class="toggle ${S.settings.firefox.enabled ? 'on' : ''}" id="fft"></div><button class="btn" id="show">Show Me</button></div></div></div>`);
    $('#fft', ff).onclick = () => relay.set('settings.firefox.enabled', !S.settings.firefox.enabled);
    $('#show', ff).onclick = () => { relay.extensionAction('reveal'); relay.extensionAction('debugging'); };
    c.append(ff);
    c.append(h('<div class="note" style="margin:12px 4px;line-height:1.45">Show Me opens the extension folder and Firefox\'s about:debugging page. Choose “Load Temporary Add-on…”, then pick manifest.json. Firefox forgets temporary add-ons when it quits, so repeat after a restart or use Firefox Developer Edition.</div>'));
  },

  account(c) {
    const cl = S.claude || {};
    const m = S.settings.model;
    c.append(h('<div class="section-title" style="margin-top:0">Account</div>'));
    const card = h('<div class="card"></div>');
    const av = `<div class="av">${icon('lock').replace('<svg', '<svg stroke="currentColor" fill="none" stroke-width="1.8"')}</div>`;
    const person = `<div class="av"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="3.6"/><path d="M5 20c1-3.6 3.8-5.2 7-5.2s6 1.6 7 5.2z"/></svg></div>`;
    if (!cl.checked) {
      card.append(h(`<div class="who">${av}<div><div class="nm">Checking…</div></div></div>`));
    } else if (!cl.installed) {
      card.append(h(`<div class="who" style="align-items:flex-start">${av}<div style="flex:1"><div class="nm">Claude Code isn't installed</div><div class="em">Relay signs in through Claude Code, Anthropic's own app. Run this once in Terminal, then check again.</div>
        <div class="code" style="margin-top:10px">curl -fsSL https://claude.ai/install.sh | bash</div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="cp">${icon('copy')}Copy</button><button class="btn primary" id="chk">Check Again</button></div></div></div>`));
      $('#cp', card).onclick = () => navigator.clipboard?.writeText('curl -fsSL https://claude.ai/install.sh | bash');
      $('#chk', card).onclick = () => relay.claudeStatus();
    } else if (cl.loggedIn) {
      const plan = cl.plan ? ` · Claude ${cl.plan[0].toUpperCase()}${cl.plan.slice(1)}` : '';
      card.append(h(`<div class="who">${person}<div style="flex:1;min-width:0"><div class="nm">Signed in with Claude</div><div class="em">${esc(cl.email || '')}${esc(plan)}</div></div><button class="btn" id="out">Sign Out</button></div>`));
      $('#out', card).onclick = async () => { if (confirm('Sign out of Claude? This also signs out Claude Code on this Mac.')) await relay.claudeLogout(); };
    } else {
      card.append(h(`<div class="who" style="align-items:flex-start">${av}<div style="flex:1"><div class="nm">Not signed in</div><div class="em">Sign in with your Claude account. No API key needed.</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><button class="btn primary" id="in" style="height:30px;padding:0 16px" ${loginBusy ? 'disabled' : ''}>${loginBusy ? 'Waiting for your browser…' : 'Sign in with Claude'}</button>${loginBusy ? '<button class="btn" id="cancel">Cancel</button>' : ''}<span class="bad">${esc(loginError)}</span></div></div></div>`));
      $('#in', card).onclick = signIn;
      $('#cancel', card) && ($('#cancel', card).onclick = () => relay.claudeCancelLogin());
    }
    c.append(card);

    if (m.provider === 'claude') {
      // The backup: Codex, signed in with ChatGPT. It takes over without a word when Claude is out of usage, and Claude comes back when its limit resets.
      const cx = S.codex || {};
      c.append(h('<div class="section-title">Backup when Claude runs out</div>'));
      const bc = h('<div class="card"></div>');
      if (!cx.checked) bc.append(h('<div class="row"><div class="grow"><div class="t">Codex</div><div class="d">Checking…</div></div></div>'));
      else if (!cx.installed) {
        bc.append(h(`<div class="who" style="align-items:flex-start"><div style="flex:1"><div class="nm">Codex isn't installed</div><div class="em">When Claude runs out of usage, Relay can carry on with Codex using your ChatGPT plan (no API key). Install OpenAI's Codex once in Terminal, then check again.</div>
          <div class="code" style="margin-top:10px">npm install -g @openai/codex</div>
          <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="cxcp">${icon('copy')}Copy</button><button class="btn primary" id="cxchk">Check Again</button></div></div></div>`));
        $('#cxcp', bc).onclick = () => navigator.clipboard?.writeText('npm install -g @openai/codex');
        $('#cxchk', bc).onclick = () => relay.codexStatus();
      } else if (cx.usable) {
        bc.append(h(`<div class="who"><div style="flex:1;min-width:0"><div class="nm">Signed in to Codex with ChatGPT</div><div class="em">${cx.using ? 'Claude is out of usage right now, so Codex is answering. Relay goes back to Claude after its limit resets.' : 'Ready. Relay uses it only when Claude is out of usage.'}</div></div><button class="btn" id="cxout">Sign Out</button></div>`));
        $('#cxout', bc).onclick = async () => { if (confirm('Sign out of Codex? This also signs out Codex on this Mac.')) await relay.codexLogout(); };
      } else {
        bc.append(h(`<div class="who" style="align-items:flex-start"><div style="flex:1"><div class="nm">${cx.signedIn ? 'Codex is signed in with an API key' : 'Codex is not signed in'}</div><div class="em">${cx.signedIn ? 'Relay only uses the ChatGPT sign-in (your plan), not a key. Sign in with ChatGPT to use it.' : 'Sign in with your ChatGPT account. No API key needed.'}</div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><button class="btn primary" id="cxin" style="height:30px;padding:0 16px">${cxBusy ? 'Waiting for your browser…' : 'Sign in with ChatGPT'}</button>${cxBusy ? '<button class="btn" id="cxcancel">Cancel</button>' : ''}</div></div></div>`));
        $('#cxin', bc).onclick = async () => { cxBusy = true; render(); const r = await relay.codexLogin(); cxBusy = false; render(); if (!r.ok && r.error) alert(r.error); };
        $('#cxcancel', bc) && ($('#cxcancel', bc).onclick = () => relay.codexCancelLogin());
      }
      bc.append(toggleRow('Switch to Codex when Claude runs out', 'Silent: Relay finishes the same request with Codex and does not mention it, then goes back to Claude once its usage limit has reset. Needs Codex signed in with ChatGPT. Codex can only use Relay\'s own tools, and has the same confirmations as Claude.', 'settings.failover.codex'));
      c.append(bc);
    }

    if (m.provider === 'claude') {
      c.append(h('<div class="section-title">Model</div>'));
      const mc = h(`<div class="card"><div class="row"><div class="grow"><div class="t">Claude model</div><div class="d">Auto answers simple requests with Haiku and moves up to Sonnet when a request is harder. Haiku is fastest, Opus thinks the longest. You can also say “use the fast model” or “use the smarter model”, and “try again” runs the last request on the next model up.</div></div><div class="seg sm">${[['auto', 'Auto'], ['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']].map(([v, l]) => `<button data-v="${v}" class="${m.claudeModel === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="row"><div class="grow"><div class="t">Test connection</div><div class="d" id="tres">${modelTest}</div></div><button class="btn" id="test">Test</button></div></div>`);
      mc.onclick = (e) => e.target.dataset.v && relay.set('settings.model.claudeModel', e.target.dataset.v);
      $('#test', mc).onclick = async () => {
        $('#tres', mc).textContent = 'Testing…';
        const r = await relay.testModel();
        modelTest = r.ok ? '<span class="ok">Connected</span>' : `<span class="bad">${esc(r.error)}</span>`;
        $('#tres', mc).innerHTML = modelTest;
      };
      c.append(mc);
    }

    const adv = h(`<details class="adv" ${m.provider !== 'claude' ? 'open' : ''}><summary>Use an API key or a local model instead</summary><div class="card" style="padding:14px;margin-top:10px"></div></details>`);
    const box = $('.card', adv);
    const PI = S.presetInfo || {};
    const services = [['claude', 'Claude account'], ['anthropic', 'Anthropic API key'], ...Object.entries(PI).filter(([id]) => id !== 'custom').map(([id, p]) => [id, p.label]), ['ollama', 'Ollama (local)'], ['custom', PI.custom?.label || 'Custom address']];
    box.append(h(`<div class="row" style="padding:0 0 14px"><div class="grow"><div class="t" style="font-weight:600">Model service</div></div><div class="select" style="margin:0"><span id="pname"></span><svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select id="psel">${services.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div></div>`));
    const psel = $('#psel', box);
    psel.value = m.provider;
    $('#pname', box).textContent = psel.options[psel.selectedIndex]?.text || '';
    psel.onchange = () => relay.set('settings.model.provider', psel.value);
    if (m.provider === 'anthropic') {
      box.append(h(`<div style="display:flex;flex-direction:column;gap:12px"><div><div class="note" style="margin-bottom:6px">Anthropic API key ${S.hasKey ? '<span class="ok">· saved in your Keychain</span>' : ''}</div><div class="field-row"><input class="field" id="key" type="password" placeholder="${S.hasKey ? '••••••••••••' : 'sk-ant-…'}"><button class="btn" id="savekey" style="height:28px">Save</button></div></div>
        <div><div class="note" style="margin-bottom:6px">Model</div><input class="field" id="mname" value="${esc(m.anthropicModel)}"></div></div>`));
      $('#savekey', box).onclick = async () => { await relay.setApiKey($('#key', box).value); $('#key', box).value = ''; };
      $('#mname', box).onchange = (e) => relay.set('settings.model.anthropicModel', e.target.value.trim());
    } else if (m.provider === 'ollama') {
      box.append(h(`<div style="display:flex;flex-direction:column;gap:12px"><div><div class="note" style="margin-bottom:6px">Ollama address</div><input class="field" id="ourl" value="${esc(m.ollamaUrl)}"></div>
        <div><div class="note" style="margin-bottom:6px">Model (needs tool support; a vision model such as qwen2.5vl lets Relay see the screen)</div><input class="field" id="omodel" value="${esc(m.ollamaModel)}"></div></div>`));
      $('#ourl', box).onchange = (e) => relay.set('settings.model.ollamaUrl', e.target.value.trim());
      $('#omodel', box).onchange = (e) => relay.set('settings.model.ollamaModel', e.target.value.trim());
    } else if (PI[m.provider]) {
      const id = m.provider, info = PI[id], ps = m.presets?.[id] || {}, keyed = S.hasKeys?.[id];
      box.append(h(`<div style="display:flex;flex-direction:column;gap:12px">
        ${id === 'custom' ? `<div><div class="note" style="margin-bottom:6px">Address (OpenAI-compatible, usually ends in /v1)</div><input class="field" id="purl" value="${esc(ps.url || '')}" placeholder="http://127.0.0.1:1234/v1"></div>` : ''}
        <div><div class="note" style="margin-bottom:6px">${esc(info.label)} key${info.keyOptional ? ' (optional)' : ''} ${keyed ? '<span class="ok">· saved in your Keychain</span>' : ''}</div><div class="field-row"><input class="field" id="pkey" type="password" placeholder="${keyed ? '••••••••••••' : 'Paste your key'}"><button class="btn" id="psave" style="height:28px">Save</button></div>${info.keyUrl ? `<div class="note" style="margin-top:6px">Get a key at ${esc(info.keyUrl.replace('https://', ''))}</div>` : ''}</div>
        <div><div class="note" style="margin-bottom:6px">Model</div><input class="field" id="pmodel" value="${esc(ps.model || '')}"></div>
        <div class="note">${id === 'openai' ? 'This uses the OpenAI API, which is billed separately from a ChatGPT subscription. ' : ''}${info.vision ? '' : 'Relay treats this model as text only, so it will not take screenshots. '}Model names change: if the test fails, check the name in the service docs.</div>
        <div style="display:flex;gap:10px;align-items:center"><button class="btn" id="ptest">Test</button><span id="pres">${modelTest}</span></div></div>`));
      $('#psave', box).onclick = async () => { await relay.setPresetKey(id, $('#pkey', box).value); $('#pkey', box).value = ''; };
      $('#pmodel', box).onchange = (e) => relay.set(`settings.model.presets.${id}.model`, e.target.value.trim());
      if (id === 'custom') $('#purl', box).onchange = (e) => relay.set('settings.model.presets.custom.url', e.target.value.trim());
      $('#ptest', box).onclick = async () => {
        $('#pres', box).textContent = 'Testing…';
        const r = await relay.testModel();
        modelTest = r.ok ? '<span class="ok">Connected</span>' : `<span class="bad">${esc(r.error)}</span>`;
        $('#pres', box).innerHTML = modelTest;
      };
    } else {
      box.append(h('<div class="note">Relay uses your Claude account above. Pick another option here only if you would rather use an API key or a local model.</div>'));
    }
    c.append(adv);
  }
};

async function signIn() {
  loginBusy = true;
  loginError = '';
  render();
  const r = await relay.claudeLogin();
  loginBusy = false;
  loginError = r.ok ? '' : (r.error || 'Sign in did not finish.').split('\n').pop();
  render();
}

/* ---------- fix a word ---------- */
function fixWord(sentence) {
  const words = [...new Set(String(sentence).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean))];
  const bg = h(`<div class="modal-bg"><div class="modal"><h3>Fix a word</h3>
    <div class="note" style="margin-bottom:10px">Tap the word that was heard wrongly, then type what it should be.</div>
    <div id="chips" style="margin-bottom:14px">${words.map((w) => `<span class="tag wchip" data-w="${esc(w)}">${esc(w)}</span>`).join('')}</div>
    <div class="field-row"><input class="field" id="ffrom" placeholder="Heard"><input class="field" id="fto" placeholder="Write instead"></div>
    <div class="actions"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div></div></div>`);
  document.body.append(bg);
  $('#chips', bg).onclick = (e) => {
    const w = e.target.dataset.w;
    if (!w) return;
    $('#ffrom', bg).value = w;
    $('#fto', bg).value = w;
    $('#fto', bg).focus();
    $('#fto', bg).select();
  };
  $('#cancel', bg).onclick = () => bg.remove();
  const save = async () => {
    const f = $('#ffrom', bg).value.trim();
    const t = $('#fto', bg).value.trim();
    if (!f || !t) return;
    await relay.addReplacement(f, t);
    bg.remove();
  };
  $('#save', bg).onclick = save;
  $('#fto', bg).onkeydown = (e) => e.key === 'Enter' && save();
}

/* ---------- routine editor ---------- */
function editRoutine(r) {
  const bg = h(`<div class="modal-bg"><div class="modal"><h3>${r.id ? 'Edit routine' : 'New routine'}</h3>
    <div class="note" style="margin-bottom:6px">Name (what you say)</div><input class="field" id="rname" value="${esc(r.name)}" placeholder="start my day">
    <div class="note" style="margin:14px 0 6px">Steps, one request per line</div><textarea class="field" id="rsteps" placeholder="Open Calendar&#10;What's the weather today?">${esc(r.steps.join('\n'))}</textarea>
    <div class="actions"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div></div></div>`);
  document.body.append(bg);
  $('#rname', bg).focus();
  $('#cancel', bg).onclick = () => bg.remove();
  $('#save', bg).onclick = async () => {
    const name = $('#rname', bg).value.trim();
    const steps = $('#rsteps', bg).value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!name || !steps.length) return;
    await relay.saveRoutine({ id: r.id, name, steps });
    bg.remove();
  };
}

/* ---------- shortcut capture ---------- */
// capturing = { key: 'ask' | 'dictate' | 'type' | 'mark', mod: DOM code of a modifier held on its own, or null }
window.addEventListener('keydown', (e) => {
  if (!capturing) return;
  e.preventDefault();
  if (e.code === 'Escape') { setCapturing(null); return render(); }
  if (MOD_CODES.includes(e.code)) {
    if (!capturing.mod && !capturing.other) capturing.mod = e.code;
    else capturing.mod = null;
    return;
  }
  capturing.other = true;
  capturing.mod = null;
  const mods = modsFromEvent(e);
  if (!mods.length && !/^F\d+$/.test(e.code)) return; // plain letters would break typing everywhere
  relay.setShortcut(capturing.key, { code: e.code, mods });
  setCapturing(null);
}, true);
window.addEventListener('keyup', (e) => {
  if (!capturing) return;
  if (capturing.mod && e.code === capturing.mod) {
    relay.setShortcut(capturing.key, { code: e.code, mods: [] });
    setCapturing(null);
  }
}, true);

(async function init() {
  S = await relay.getState();
  perms = await relay.permissions();
  render();
  relay.onNavigate((p) => { if (p === 'recap') { historyTab = 'actions'; go('history'); } else if (PAGES[p]) go(p); });
  relay.onStateChanged(async () => {
    S = await relay.getState();
    perms = await relay.permissions();
    render();
  });
  // Sidebar collapse: the button in the top bar, or Cmd+\. The choice is remembered.
  const appEl = $('.app');
  const setSidebar = (collapsed) => {
    appEl.classList.toggle('collapsed', collapsed);
    $('#sbtn').title = collapsed ? 'Show sidebar (⌘\\)' : 'Hide sidebar (⌘\\)';
    try { localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open'); } catch {}
  };
  const toggleSidebar = () => setSidebar(!appEl.classList.contains('collapsed'));
  $('#sbtn').onclick = toggleSidebar;
  document.addEventListener('keydown', (e) => { if (e.metaKey && e.key === '\\') { e.preventDefault(); toggleSidebar(); } });
  let saved = null;
  try { saved = localStorage.getItem('sidebar'); } catch {}
  setSidebar(saved === 'collapsed');
  relay.claudeStatus();
  relay.codexStatus();
  relay.appIcons().then((i) => { appIcons = i; if (page === 'permissions') render(); });
  setInterval(async () => {
    const p = await relay.permissions();
    if (p.accessibility !== perms.accessibility || p.screen !== perms.screen || p.micStatus !== perms.micStatus) { perms = p; render(); }
  }, 2000);
})();

// Files dropped anywhere on this window go to Relay, which asks what to do with them.
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  window.relay.dropFiles?.(e.dataTransfer.files);
});
