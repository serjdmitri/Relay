/* global relay, icon, ICONS, LOGO, COLORS, h, esc, timeAgo, MOD_CODES, modsFromEvent */
let S = null; // latest state from main
let page = new URLSearchParams(location.search).get('page') || 'home';
let historyTab = 'requests';
let range = 'all';
let perms = { accessibility: false, screen: false };
let capturing = null; // which shortcut is being recorded
function setCapturing(v) {
  const was = !!capturing;
  capturing = v;
  if (was !== !!v) relay.setCapturing(!!v);
}
const automation = JSON.parse(localStorage.getItem('automation') || '{}');

const NAV = [
  [['home', 'Home'], ['history', 'History'], ['routines', 'Routines'], ['vocab', 'Vocabulary']],
  [['general', 'General'], ['model', 'Model'], ['shortcuts', 'Shortcuts'], ['permissions', 'Permissions']]
];
const TITLES = Object.fromEntries(NAV.flat());
const NAV_ICON = { home: 'home', history: 'history', routines: 'routines', vocab: 'vocab', general: 'gear', model: 'model', shortcuts: 'command', permissions: 'shield' };

const $ = (sel, root = document) => root.querySelector(sel);

function ready() {
  if (!S) return { ok: false, text: 'Loading' };
  if (!S.hotkeysRunning) return { ok: false, text: 'Shortcuts off' };
  const m = S.settings.model;
  if (m.provider === 'anthropic' && !S.hasKey) return { ok: false, text: 'Add a model key' };
  return { ok: true, text: 'Ready' };
}

function renderSidebar() {
  const r = ready();
  const sb = $('#sidebar');
  sb.innerHTML = '';
  for (const group of NAV) {
    const nav = h('<nav class="nav"></nav>');
    for (const [id, name] of group) {
      const item = h(`<div class="nav-item ${page === id ? 'active' : ''}"><span class="icon-box" style="background:${COLORS[id]}">${icon(NAV_ICON[id])}</span>${name}</div>`);
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

function modelLabel() {
  const m = S.settings.model;
  return m.provider === 'ollama' ? `Ollama · ${m.ollamaModel}` : m.anthropicModel;
}

function render() {
  if (!S) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && $('#content').contains(ae)) {
    renderSidebar();
    return; // do not clobber a field the user is typing in
  }
  renderSidebar();
  $('#title').textContent = TITLES[page];
  $('#device').innerHTML = `${icon('chip')}${esc(modelLabel())}`;
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

function statsFor(rangeId) {
  if (rangeId === 'all') return S.stats;
  const since = Date.now() - (rangeId === 'today' ? 86400e3 : 7 * 86400e3);
  const hs = S.history.filter((x) => x.ts >= since);
  const acts = S.actions.filter((x) => x.ts >= since).length;
  const words = hs.reduce((n, x) => n + (x.text.trim() ? x.text.trim().split(/\s+/).length : 0), 0);
  return { requests: hs.length, actions: acts, words, minutesSaved: Math.round(((words / 40) * 60 + acts * 20) / 60) };
}

const mark = (status) => status === 'done'
  ? `<svg class="mark" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#3b8cf5"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  : `<svg class="mark" viewBox="0 0 24 24"><path d="M12 3L22 20H2z" fill="#ff9f0a" stroke="#ff9f0a" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5M12 16.5v.01" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round"/></svg>`;

function requestRow(x) {
  return `<div class="req">${mark(x.status)}<div style="flex:1;min-width:0"><div class="tt"><span>${esc(x.text)}</span><span class="when">${timeAgo(x.ts)}</span></div><div class="rp">${esc(x.status === 'stopped' ? 'Stopped at your request. Any earlier actions may already have happened.' : x.reply || '')}</div></div></div>`;
}

/* ---------- pages ---------- */
const PAGES = {
  home(c) {
    const r = ready();
    const st = statsFor(range);
    const time = st.minutesSaved < 1 ? '<1m' : `${st.minutesSaved}m`;
    c.append(h(`<div class="hero"><div class="app-icon" style="width:46px;height:46px">${LOGO}</div><div><h2>Relay</h2><div class="st"><span class="dot ${r.ok ? '' : 'off'}"></span>${r.text}</div></div></div>`));
    const sel = h(`<div class="select">${{ all: 'All time', today: 'Today', week: 'Last 7 days' }[range]}<svg viewBox="0 0 12 16"><path d="M2 6l4-4 4 4M2 10l4 4 4-4"/></svg><select><option value="all">All time</option><option value="today">Today</option><option value="week">Last 7 days</option></select></div>`);
    $('select', sel).value = range;
    $('select', sel).onchange = (e) => { range = e.target.value; render(); };
    c.append(sel);
    c.append(h(`<div class="card stats">${[[st.requests, 'Requests'], [st.actions, 'Actions taken'], [st.words, 'Words asked'], [time, 'Time saved']].map(([n, l]) => `<div><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>`));

    c.append(h('<div class="section-title">Get started</div>'));
    const gs = h('<div></div>');
    const row = (ic, t, d, right, onclick) => {
      const el = h(`<div class="get-row"><div class="ic">${icon(ic)}</div><div class="grow"><div class="t">${t}</div><div class="d">${d}</div></div>${right}</div>`);
      if (onclick) el.onclick = onclick;
      return el;
    };
    gs.append(row('wave', 'Ask Relay', 'Say what you want done with Talkify. It acts, then checks that it worked.', `<span class="kbd">${esc(S.labels.ask)}</span>`));
    gs.append(row('mic', 'Dictate', 'Use your Talkify key. The words are typed where your cursor is.', '<span class="kbd">Talkify</span>'));
    gs.append(row('keyboard', 'Type a request', "For when talking isn't an option.", `<span class="kbd">${esc(S.labels.type)}</span>`));
    gs.append(row('command', 'Customize your shortcuts', 'Change the keys for any of these.', '<span class="chev">›</span>', () => go('shortcuts')));
    c.append(gs);

    c.append(h('<div class="section-title">Recent<span class="link" id="va">View all</span></div>'));
    $('#va', c).onclick = () => go('history');
    const recent = S.history.slice(0, 3);
    c.append(h(`<div class="card">${recent.length ? recent.map(requestRow).join('') : '<div class="empty">Nothing yet. Press the shortcut and ask for something.</div>'}</div>`));
  },

  history(c) {
    const tabs = h(`<div class="tabs"><button data-t="requests" class="${historyTab === 'requests' ? 'on' : ''}">Requests</button><button data-t="actions" class="${historyTab === 'actions' ? 'on' : ''}">Actions</button></div>`);
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
      $('#clr', c).onclick = () => { if (confirm('Clear all request and action history?')) relay.clearHistory(); };
      c.append(h(`<div class="card">${S.history.length ? S.history.map(requestRow).join('') : '<div class="empty">No requests yet.</div>'}</div>`));
    } else {
      c.append(h('<div class="note" style="margin-bottom:16px">Every tool call Relay made, newest first. Use this to see what happened when a request did not work.</div>'));
      c.append(h(`<div class="card">${S.actions.length ? S.actions.map((a) => `<div class="act"><svg viewBox="0 0 24 24" width="20" height="20" style="margin-top:2px"><circle cx="12" cy="12" r="10" fill="${a.ok ? '#30d158' : '#ff453a'}"/><path d="${a.ok ? 'M7 12.5l3.5 3.5L17 9' : 'M8 8l8 8M16 8l-8 8'}" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg><div><div class="nm">${esc(a.tool)}</div><div class="ar">${esc(JSON.stringify(a.input))}</div><div class="rs ${a.ok ? '' : 'bad'}">${esc(a.result)}</div></div><span class="note">${timeAgo(a.ts)}</span></div>`).join('') : '<div class="empty">No actions yet.</div>'}</div>`));
    }
  },

  routines(c) {
    c.append(h(`<div class="lead">Say a routine's name and Relay does its steps, one after another. Anything that sends or deletes still asks you first.</div>`));
    c.append(h(`<div class="section-title" style="margin-top:0"><span>Routines</span><span style="display:flex;gap:10px"><button class="btn" id="rec" style="display:flex;gap:8px;align-items:center"><svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.8">${ICONS.record}</svg>Record</button><button class="btn" id="new">＋ New Routine</button></span></div>`));
    $('#rec', c).onclick = () => relay.ask.open('start a routine');
    $('#new', c).onclick = () => editRoutine({ name: '', steps: [] });
    const list = h('<div class="card"></div>');
    if (!S.routines.length) list.append(h('<div class="empty">None yet. Make one with the buttons above, by voice, or from an idea below.</div>'));
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
    c.append(h(`<div class="card" style="padding:14px 18px">
      <div class="opt"><svg viewBox="0 0 24 24">${ICONS.record}</svg><div><div class="t">Record it</div><div class="d">Say “start a routine”, do each step, then “save it as start my day”.</div></div></div>
      <div class="opt"><svg viewBox="0 0 24 24">${ICONS.chat}</svg><div><div class="t">Say it in one go</div><div class="d">“When I say start my day, open Calendar and tell me the weather.”</div></div></div>
      <div class="opt"><svg viewBox="0 0 24 24">${ICONS.undo}</svg><div><div class="t">Keep what just worked</div><div class="d">After a request, say “save that as start my day”.</div></div></div></div>`));

    c.append(h('<div class="section-title">Ideas</div>'));
    const ideas = [
      { name: 'start my day', steps: ['Open Calendar', "What's on my calendar today?", "What's the weather today?"] },
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
    c.append(h('<div class="lead">Names, products and terms Relay should expect. Talkify does the transcription, so this helps Relay correct mistakes in what it receives (“Superbase” for Supabase). Listing a term here fixes that.</div>'));
    const row = h('<div class="field-row" style="margin-bottom:22px"><input class="field" id="vin" placeholder="Add a word or name (commas for several)"><button class="btn primary" id="vadd">Add</button></div>');
    const add = () => {
      const v = $('#vin', row).value;
      if (v.trim()) relay.addVocab(v.split(',')).then(() => ($('#vin', row).value = ''));
    };
    $('#vadd', row).onclick = add;
    $('#vin', row).onkeydown = (e) => e.key === 'Enter' && add();
    c.append(row);
    c.append(h(`<div class="section-title" style="margin-top:0">${S.vocabulary.length} term${S.vocabulary.length === 1 ? '' : 's'}</div>`));
    if (!S.vocabulary.length) c.append(h('<div class="note" style="font-size:14px">None yet.</div>'));
    const box = h('<div></div>');
    for (const t of S.vocabulary) {
      const tag = h(`<span class="tag">${esc(t)}<button title="Remove">×</button></span>`);
      $('button', tag).onclick = () => relay.removeVocab(t);
      box.append(tag);
    }
    c.append(box);
  },

  general(c) {
    c.append(h('<div class="section-title">Listening</div>'));
    const card = h('<div class="card"></div>');
    const talk = h(`<div class="row" style="flex-wrap:wrap"><div class="t" style="font-size:15.5px">Talking</div><div class="seg">${[['tap-or-hold', 'Tap or hold'], ['tap', 'Tap'], ['hold', 'Hold']].map(([v, l]) => `<button data-v="${v}" class="${S.settings.talking === v ? 'on' : ''}">${l}</button>`).join('')}</div><div class="note" style="flex-basis:100%;margin-top:-6px">Tap to start and tap to send, or hold while you talk and let go.</div></div>`);
    talk.onclick = (e) => e.target.dataset.v && relay.set('settings.talking', e.target.dataset.v);
    card.append(talk, toggleRow('Play sounds', '', 'settings.playSounds'));
    c.append(card);

    c.append(h('<div class="section-title">Ask Relay</div>'));
    const ask = h('<div class="card"></div>');
    ask.append(
      toggleRow('Let Relay do things for you', 'Off: it only types what you say.', 'settings.actEnabled'),
      toggleRow('Relay cursor', "Shows Relay's own pointer when it clicks or points.", 'settings.cursor'),
      toggleRow('Speak replies', 'Reads each answer aloud.', 'settings.speakReplies'),
      toggleRow('Bring Relay forward while asking', 'Keep on if Talkify does not paste into the request box. Relay hands focus back to your app when you send.', 'settings.pillActivates')
    );
    c.append(ask);

    c.append(h('<div class="section-title">Startup</div>'));
    const st = h('<div class="card"></div>');
    st.append(toggleRow('Open at login', '', 'settings.openAtLogin'), toggleRow('Show in Dock', '', 'settings.showInDock'));
    c.append(st);

    c.append(h('<div class="section-title">Privacy</div>'));
    c.append(h('<div class="card"><div class="row"><div><div class="t">No analytics</div><div class="d">Requests go only to the model you choose. Screenshots are sent only when a request needs to look at the screen.</div></div></div></div>'));
    c.append(h('<div style="height:10px"></div>'));
  },

  model(c) {
    const m = S.settings.model;
    c.append(h('<div class="section-title">Model</div>'));
    const card = h('<div class="card" style="padding:16px"></div>');
    const seg = h(`<div class="seg" style="margin-bottom:16px"><button data-v="anthropic" class="${m.provider === 'anthropic' ? 'on' : ''}">Claude</button><button data-v="ollama" class="${m.provider === 'ollama' ? 'on' : ''}">Ollama (local)</button></div>`);
    seg.onclick = (e) => e.target.dataset.v && relay.set('settings.model.provider', e.target.dataset.v);
    card.append(seg);
    if (m.provider === 'anthropic') {
      card.append(h(`<div style="display:flex;flex-direction:column;gap:12px">
        <div><div class="note" style="margin-bottom:6px">Anthropic API key ${S.hasKey ? '<span class="ok">· saved in your Keychain</span>' : ''}</div><div class="field-row"><input class="field" id="key" type="password" placeholder="${S.hasKey ? '••••••••••••' : 'sk-ant-…'}"><button class="btn" id="savekey">Save</button></div></div>
        <div><div class="note" style="margin-bottom:6px">Model</div><input class="field" id="mname" value="${esc(m.anthropicModel)}"></div></div>`));
      $('#savekey', card).onclick = async () => { await relay.setApiKey($('#key', card).value); $('#key', card).value = ''; };
      $('#mname', card).onchange = (e) => relay.set('settings.model.anthropicModel', e.target.value.trim());
    } else {
      card.append(h(`<div style="display:flex;flex-direction:column;gap:12px">
        <div><div class="note" style="margin-bottom:6px">Ollama address</div><input class="field" id="ourl" value="${esc(m.ollamaUrl)}"></div>
        <div><div class="note" style="margin-bottom:6px">Model (needs tool support; a vision model such as qwen2.5vl or llama3.2-vision lets Relay see the screen)</div><input class="field" id="omodel" value="${esc(m.ollamaModel)}"></div></div>`));
      $('#ourl', card).onchange = (e) => relay.set('settings.model.ollamaUrl', e.target.value.trim());
      $('#omodel', card).onchange = (e) => relay.set('settings.model.ollamaModel', e.target.value.trim());
    }
    const test = h('<div style="display:flex;align-items:center;gap:12px;margin-top:16px"><button class="btn primary" id="test">Test connection</button><span id="res" class="note"></span></div>');
    $('#test', test).onclick = async () => {
      $('#res', test).textContent = 'Testing…';
      const r = await relay.testModel();
      $('#res', test).innerHTML = r.ok ? '<span class="ok">Connected</span>' : `<span class="bad">${esc(r.error)}</span>`;
    };
    card.append(test);
    c.append(card);
    c.append(h('<div class="note" style="margin:22px 8px;font-size:13px;line-height:1.5">Dictation is handled by Talkify on this Mac. Relay only receives the text, and sends it to the model above.</div>'));
  },

  shortcuts(c) {
    c.append(h('<div class="section-title" style="margin-top:0;font-size:15.5px;color:var(--text)">Click a shortcut to change it</div>'));
    const card = h('<div class="card"></div>');
    const row = (key, ic, t, d) => {
      const active = capturing && capturing.key === key;
      const lbl = active ? 'Press keys…' : S.labels[key];
      const el = h(`<div class="row"><div style="display:flex;gap:16px;align-items:center"><span style="color:#5aa0ff;width:24px;display:grid;place-items:center"><svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="1.6">${ICONS[ic]}</svg></span><div><div class="t" style="font-weight:600;font-size:15px">${t}</div><div class="d" style="font-size:14px">${d}</div></div></div><button class="kbd" style="${active ? 'background:var(--accent);color:#fff' : ''}">${esc(lbl)}</button></div>`);
      $('.kbd', el).onclick = () => { setCapturing({ key, mod: null }); render(); };
      return el;
    };
    card.append(row('ask', 'wave', 'Ask Relay', 'Talk with Talkify, then send. Press while it works to stop it.'));
    card.append(h(`<div class="row"><div style="display:flex;gap:16px;align-items:center"><span style="color:var(--dim);width:24px;display:grid;place-items:center"><svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="1.6">${ICONS.mic}</svg></span><div><div class="t" style="font-weight:600;font-size:15px">Dictate</div><div class="d" style="font-size:14px">Handled by Talkify. Set its key in Talkify.</div></div></div><span class="kbd" style="opacity:.6">Talkify</span></div>`));
    card.append(row('type', 'keyboard', 'Type a request', "For when talking isn't an option. Press again to close."));
    c.append(card);
    c.append(h('<div class="note" style="margin:22px 8px;font-size:13px;line-height:1.5">A key with ⌃, ⌥ or ⌘, an F-key, or one modifier on its own like Right ⌥. Esc cancels.<br><span class="link" id="reset">Reset to defaults</span></div>'));
    $('#reset', c).onclick = () => relay.resetShortcuts();
  },

  permissions(c) {
    c.append(h('<div class="section-title" style="margin-top:0;font-size:15.5px;color:var(--text)">On this Mac</div>'));
    const card = h('<div class="card"></div>');
    const prow = (ic, color, t, d, right) => h(`<div class="row"><div style="display:flex;gap:14px;align-items:center"><span class="icon-box" style="background:${color};width:30px;height:30px;border-radius:8px">${icon(ic)}</span><div><div class="t" style="font-weight:600;font-size:15px">${t}</div><div class="d" style="font-size:13px">${d}</div></div></div><div>${right}</div></div>`);
    const state = (ok) => ok ? '<span class="ok" style="font-size:14px">● Allowed</span>' : '';
    const a = prow('wave', '#2d7cf6', 'Accessibility', 'Types for you and works in your apps.', perms.accessibility ? state(true) : '<button class="btn primary" data-p="acc">Allow</button>');
    const s = prow('laptop', '#7a5af0', 'Screen Recording', "Sees apps it can't read any other way.", perms.screen ? state(true) : '<button class="btn primary" data-p="screen">Allow</button>');
    const i = prow('keyboard', '#e0568a', 'Input Monitoring', 'Hears your shortcut keys from any app.', S.hotkeysRunning ? state(true) : '<button class="btn primary" data-p="input">Open Settings</button>');
    card.append(a, s, i);
    card.onclick = (e) => {
      const p = e.target.dataset.p;
      if (p === 'acc') relay.requestAccessibility().then(() => relay.openPane('accessibility'));
      if (p === 'screen') relay.openPane('screen');
      if (p === 'input') relay.openPane('input');
    };
    c.append(card);
    if (S.hotkeysError) c.append(h(`<div class="note warn" style="margin-top:10px">Shortcuts are not running: ${esc(S.hotkeysError)}. Grant Accessibility and Input Monitoring, then reopen Relay.</div>`));
    c.append(h('<div class="note" style="margin:14px 8px;font-size:13px">Relay asks before anything that sends or deletes, whatever is allowed here.</div>'));

    c.append(h('<div class="section-title" style="font-size:15.5px;color:var(--text)">Apps Relay works in</div>'));
    const apps = h('<div class="card"></div>');
    const APPS = [['Firefox', 'Opens pages and switches tabs.'], ['Notes', 'Works in Notes for you.'], ['Reminders', 'Works in Reminders for you.'], ['Messages', 'Works in Messages for you.'], ['Calendar', 'Reads and adds events.'], ['Finder', 'Shows, opens and trashes files.']];
    for (const [name, d] of APPS) {
      const st = automation[name];
      const right = st === 'ok' ? '<span class="ok" style="font-size:14px">● Allowed</span>' : st === 'denied' ? '<span class="bad" style="font-size:13px">Denied. <span class="link" data-a="pane">Open Settings</span></span>' : '<span class="note" style="font-size:14px">Asks the first time</span> <button class="btn" data-a="test" style="margin-left:10px">Test</button>';
      const el = h(`<div class="row"><div><div class="t" style="font-weight:600;font-size:15px">${name}</div><div class="d" style="font-size:13px">${d}</div></div><div style="text-align:right">${right}</div></div>`);
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

    c.append(h('<div class="section-title" style="font-size:15.5px;color:var(--text)">Firefox</div>'));
    const ff = h(`<div class="card"><div class="row"><div class="grow"><div class="t" style="font-weight:600;font-size:15px">Better page control</div><div class="d" style="font-size:13px">Optional extension so Relay can read pages, switch tabs and click or type inside them. ${S.firefoxConnected ? '<span class="ok">Connected.</span>' : S.settings.firefox.enabled ? '<span class="warn">Waiting for the extension.</span>' : ''}</div></div><div style="display:flex;gap:10px;align-items:center"><div class="toggle ${S.settings.firefox.enabled ? 'on' : ''}" id="fft"></div><button class="btn" id="show">Show Me</button></div></div></div>`);
    $('#fft', ff).onclick = () => relay.set('settings.firefox.enabled', !S.settings.firefox.enabled);
    $('#show', ff).onclick = () => { relay.extensionAction('reveal'); relay.extensionAction('debugging'); };
    c.append(ff);
    c.append(h('<div class="note" style="margin:12px 8px;font-size:13px;line-height:1.5">Show Me opens the extension folder and Firefox\'s about:debugging page. Choose “Load Temporary Add-on…”, then pick manifest.json. Firefox forgets temporary add-ons when it quits, so repeat after a restart or use Firefox Developer Edition.</div>'));
  }
};

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
// capturing = { key: 'ask' | 'type', mod: DOM code of a modifier held on its own, or null }
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
  setInterval(async () => {
    const p = await relay.permissions();
    if (p.accessibility !== perms.accessibility || p.screen !== perms.screen) { perms = p; render(); }
  }, 2000);
})();
