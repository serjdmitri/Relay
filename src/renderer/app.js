/* global relay, icon, glyph, ICONS, LOGO, COLORS, h, esc, timeAgo, MOD_CODES, modsFromEvent */
let S = null; // latest state from main
let page = new URLSearchParams(location.search).get('page') || 'home';
let historyTab = 'requests';
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
const automation = JSON.parse(localStorage.getItem('automation') || '{}');

const NAV = [
  [['home', 'Home'], ['history', 'History'], ['routines', 'Routines'], ['vocab', 'Vocabulary']],
  [['general', 'General'], ['speech', 'Speech'], ['shortcuts', 'Shortcuts'], ['permissions', 'Permissions']],
  [['account', 'Account']]
];
const TITLES = Object.fromEntries(NAV.flat());
const NAV_GLYPH = { home: 'home', history: 'history', routines: 'routines', vocab: 'vocab', general: 'general', speech: 'speech', shortcuts: 'shortcuts', permissions: 'permissions', account: 'account' };

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

function render() {
  if (!S) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && $('#content').contains(ae)) {
    applyTheme();
    renderSidebar();
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
}

/* ---------- helpers ---------- */
function toggleRow(title, desc, key) {
  const on = key.split('.').reduce((o, k) => o[k], S);
  const row = h(`<div class="row"><div class="grow"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="toggle ${on ? 'on' : ''}"></div></div>`);
  row.onclick = () => relay.set(key, !on);
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
  return `<div class="req">${mark(x.status)}<div style="flex:1;min-width:0"><div class="tt"><span>${esc(x.text)}</span><span class="when">${timeAgo(x.ts)}</span></div><div class="rp">${esc(x.status === 'stopped' ? 'Stopped at your request. Any earlier actions may already have happened.' : x.reply || '')}</div></div></div>`;
}

const allowed = '<span class="allowed" style="display:inline-flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#34c759"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#1d1d1d" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Allowed</span>';

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
      c.append(h('<div class="note" style="margin-bottom:16px">Every tool call Relay made, newest first. Use this to see what happened when a request did not work.</div>'));
      c.append(h(`<div class="card">${S.actions.length ? S.actions.map((a) => `<div class="act"><svg viewBox="0 0 24 24" width="20" height="20" style="margin-top:2px"><circle cx="12" cy="12" r="10" fill="${a.ok ? '#34c759' : '#ff453a'}"/><path d="${a.ok ? 'M7 12.5l3.5 3.5L17 9' : 'M8 8l8 8M16 8l-8 8'}" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg><div><div class="nm">${esc(a.tool)}</div><div class="ar">${esc(JSON.stringify(a.input))}</div><div class="rs ${a.ok ? '' : 'bad'}">${esc(a.result)}</div></div><span class="note">${timeAgo(a.ts)}</span></div>`).join('') : '<div class="empty">No actions yet.</div>'}</div>`));
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
      const el = h(`<div class="routine"><div class="rn"><span>${esc(r.name)}</span><span style="display:flex;gap:8px"><button class="btn" data-a="run">Run</button><button class="btn" data-a="edit">Edit</button><button class="btn danger" data-a="del">Delete</button></span></div><ol>${r.steps.map((s, i) => `<li><span>${i + 1}</span>${esc(s)}</li>`).join('')}</ol></div>`);
      el.onclick = (e) => {
        const a = e.target.dataset.a;
        if (a === 'run') relay.runRoutine(r.id);
        if (a === 'edit') editRoutine(r);
        if (a === 'del' && confirm(`Delete "${r.name}"?`)) relay.deleteRoutine(r.id);
      };
      list.append(el);
    }
    c.append(list);

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

  general(c) {
    const title = (t) => c.append(h(`<div class="title-flat">${t}</div>`));
    title('Listening');
    const card = h('<div class="card flat"></div>');
    const talk = h(`<div class="row talk" style="flex-wrap:wrap"><div class="t">Talking</div><div class="seg">${[['tap-or-hold', 'Tap or hold'], ['tap', 'Tap'], ['hold', 'Hold']].map(([v, l]) => `<button data-v="${v}" class="${S.settings.talking === v ? 'on' : ''}">${l}</button>`).join('')}</div><div class="note foot" style="flex-basis:100%">Tap to start and tap to send, or hold while you talk and let go.</div></div>`);
    talk.onclick = (e) => e.target.dataset.v && relay.set('settings.talking', e.target.dataset.v);
    card.append(talk, toggleRow('Play sounds', '', 'settings.playSounds'), toggleRow('Lower other audio while listening', '', 'settings.duckAudio'), toggleRow('Dictation', 'Right ⌘ types what you say. Off: the shortcut is disabled.', 'settings.dictation'), toggleRow('Keep dictation history', 'Off: dictated text is typed but not saved in History.', 'settings.saveDictation'));
    c.append(card);

    title('Ask Relay');
    const ask = h('<div class="card flat"></div>');
    ask.append(
      toggleRow('Let Relay do things for you', 'Off: it only types what you say.', 'settings.actEnabled'),
      toggleRow('Relay cursor', "Shows Relay's own pointer, drawings and step-by-step guides on your screen.", 'settings.cursor'),
      toggleRow('Buddy cursor', 'A small helper follows your pointer while Relay listens and works, and flies to what it points at.', 'settings.buddy'),
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
      const opts = [['auto', `Automatic${info?.picked ? ` (${info.picked.replace(/ \(.*$/, '')})` : ''}`], ...list.map((v) => [v.name, `${v.name.replace(/ \(.*$/, '')}${v.kind === 'Standard' ? '' : ' · ' + v.kind}${v.lang !== 'en_US' ? ' · ' + v.lang.replace('_', '-') : ''}`])];
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
    const rrow = h(`<div class="row"><div class="grow"><div class="t" style="font-weight:600">Speed</div></div><div class="seg sm">${[['slower', 'Slower'], ['normal', 'Normal'], ['faster', 'Faster']].map(([v, l]) => `<button data-v="${v}" class="${(S.settings.voiceRate || 'normal') === v ? 'on' : ''}" style="width:78px">${l}</button>`).join('')}</div></div>`);
    rrow.onclick = (e) => e.target.dataset.v && relay.set('settings.voiceRate', e.target.dataset.v);
    vcard.append(rrow);
    c.append(vcard);
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
    c.append(card);
    c.append(h('<div class="note" style="margin:16px 12px;line-height:16px">A key with ⌃, ⌥ or ⌘, an F-key, or one modifier on its own like Right ⌥. Esc cancels.<br><span class="link" id="reset">Reset to defaults</span></div>'));
    $('#reset', c).onclick = () => relay.resetShortcuts();
  },

  permissions(c) {
    c.append(h('<div class="section-title" style="margin-top:0">On this Mac</div>'));
    const card = h('<div class="card"></div>');
    const prow = (ic, color, t, d, right) => h(`<div class="row" style="min-height:57px;--div:60px;padding:10px 16px"><div style="display:flex;gap:14px;align-items:center"><span class="icon-box" style="background:${color};--bc:${color};width:30px;height:30px;border-radius:8px">${ic}</span><div><div class="ttl">${t}</div><div class="d">${d}</div></div></div><div>${right}</div></div>`);
    const mic = prow(glyph('mic'), '#e05577', 'Microphone', 'Hears you while you use a shortcut.', perms.mic ? allowed : `<button class="btn primary" data-p="mic">${perms.micStatus === 'denied' ? 'Open Settings' : 'Allow'}</button>`);
    const a = prow(glyph('accessibility'), '#3d7bf0', 'Accessibility', 'Types for you and works in your apps.', perms.accessibility ? allowed : '<button class="btn primary" data-p="acc">Allow</button>');
    const s = prow(glyph('screen'), '#7f55df', 'Screen Recording', "Sees apps it can't read any other way.", perms.screen ? allowed : '<button class="btn primary" data-p="screen">Allow</button>');
    const i = prow(glyph('input'), '#3d7bf0', 'Input Monitoring', 'Hears your shortcut keys from any app.', S.hotkeysRunning && S.hotkeysSeen ? allowed : S.hotkeysRunning ? '<span class="note" style="color:var(--dim)">Press any key to check</span>' : '<button class="btn primary" data-p="input">Open Settings</button>');
    card.append(mic, a, s, i);
    card.onclick = (e) => {
      const p = e.target.dataset.p;
      if (p === 'mic') (perms.micStatus === 'denied' ? relay.openPane('mic') : relay.requestMic());
      if (p === 'acc') relay.requestAccessibility().then(() => relay.openPane('accessibility'));
      if (p === 'screen') relay.openPane('screen');
      if (p === 'input') relay.openPane('input');
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
    const av = `<div class="av">${icon('lock').replace('<svg', '<svg stroke="#ddd" fill="none" stroke-width="1.8"')}</div>`;
    const person = `<div class="av"><svg viewBox="0 0 24 24" fill="#ddd"><circle cx="12" cy="9" r="3.6"/><path d="M5 20c1-3.6 3.8-5.2 7-5.2s6 1.6 7 5.2z"/></svg></div>`;
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
      c.append(h('<div class="section-title">Model</div>'));
      const mc = h(`<div class="card"><div class="row"><div class="grow"><div class="t">Claude model</div><div class="d">Auto answers simple requests with Haiku and moves up to Sonnet when a request is harder. Haiku is fastest, Opus thinks the longest.</div></div><div class="seg sm">${[['auto', 'Auto'], ['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']].map(([v, l]) => `<button data-v="${v}" class="${m.claudeModel === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
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
// capturing = { key: 'ask' | 'dictate' | 'type', mod: DOM code of a modifier held on its own, or null }
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
  relay.onNavigate((p) => PAGES[p] && go(p));
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
  relay.appIcons().then((i) => { appIcons = i; if (page === 'permissions') render(); });
  setInterval(async () => {
    const p = await relay.permissions();
    if (p.accessibility !== perms.accessibility || p.screen !== perms.screen || p.micStatus !== perms.micStatus) { perms = p; render(); }
  }, 2000);
})();
