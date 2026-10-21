/* global relay, icon, LOGO, h, esc */
let S = null;
let perms = { accessibility: false, screen: false };
let step = -1; // -1 = welcome, 0..6 = the seven steps
let askedAccessibility = false;
let testOk = false;
let testMsg = '';
let lastSig = '';
let usesFirefox = null;
let talkifyText = '';
let startHistory = 0;

const $ = (sel, root = document) => root.querySelector(sel);
const STEPS = 7;

const check = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function dots() {
  const d = $('#dots');
  d.innerHTML = '';
  if (step < 0) return;
  for (let i = 0; i < STEPS; i++) d.append(h(`<i class="${i === step ? 'cur' : i < step ? 'past' : ''}"></i>`));
}

function footer({ back = true, next = 'Continue', nextEnabled = true, nextFn, skip = false }) {
  const f = $('#footer');
  f.innerHTML = '';
  const b = h(`<button class="pill-btn dark" style="${back ? '' : 'visibility:hidden'}">Back</button>`);
  b.onclick = () => go(step - 1);
  const n = h(`<button class="pill-btn" ${nextEnabled ? '' : 'disabled'}>${next}</button>`);
  n.onclick = nextFn || (() => go(step + 1));
  f.append(b, n);
}

function go(n) {
  step = n;
  render();
}

const chip = (ok, on, off) => `<div class="chip-status ${ok ? '' : 'wait'}"><span class="dot">${ok ? check.replace('<svg', '<svg width="10" height="10" stroke="#fff" fill="none" stroke-width="3"') : ''}</span>${ok ? on : off}</div>`;

const SCREENS = {
  '-1'() {
    $('#stage').innerHTML = `<div class="app-icon">${LOGO}</div><h2>Welcome to Relay</h2><p class="sub">Dictate with Talkify, and Relay types for you or gets it done.</p><p class="fine">Dictation stays in Talkify. Relay handles the “do something” part.</p>`;
    footer({ back: false, next: 'Get Started' });
    $('#footer .pill-btn:last-child').onclick = () => go(0);
  },

  0() {
    const m = S.settings.model;
    $('#stage').innerHTML = `<div class="app-icon">${LOGO}<div class="badge">${check}</div></div><h2>Pick the model that does the work</h2><p class="sub">Claude is the most reliable. Ollama keeps everything local.</p>
      <div class="form">
        <div class="seg" style="align-self:center"><button data-v="anthropic" class="${m.provider === 'anthropic' ? 'on' : ''}">Claude</button><button data-v="ollama" class="${m.provider === 'ollama' ? 'on' : ''}">Ollama (local)</button></div>
        ${m.provider === 'anthropic'
          ? `<input class="field" id="key" type="password" placeholder="${S.hasKey ? 'API key saved. Paste a new one to replace it' : 'Anthropic API key (sk-ant-…)'}">`
          : `<input class="field" id="omodel" value="${esc(m.ollamaModel)}" placeholder="Model, e.g. qwen2.5:14b"><input class="field" id="ourl" value="${esc(m.ollamaUrl)}">`}
        <div style="display:flex;gap:12px;align-items:center;justify-content:center"><button class="btn primary" id="test">Test connection</button><span id="res" class="note" style="font-size:15px">${testMsg}</span></div>
      </div>`;
    $('.seg').onclick = (e) => e.target.dataset.v && relay.set('settings.model.provider', e.target.dataset.v);
    $('#key') && ($('#key').onchange = (e) => e.target.value && relay.setApiKey(e.target.value));
    $('#omodel') && ($('#omodel').onchange = (e) => relay.set('settings.model.ollamaModel', e.target.value.trim()));
    $('#ourl') && ($('#ourl').onchange = (e) => relay.set('settings.model.ollamaUrl', e.target.value.trim()));
    $('#test').onclick = async () => {
      if ($('#key') && $('#key').value) await relay.setApiKey($('#key').value);
      testMsg = 'Testing…';
      render();
      const r = await relay.testModel();
      testOk = r.ok;
      testMsg = r.ok ? '<span class="ok">Connected</span>' : `<span class="bad">${esc(r.error)}</span>`;
      render();
    };
    footer({ next: testOk ? 'Continue' : 'Skip for Now' });
  },

  1() {
    if (!askedAccessibility) { askedAccessibility = true; relay.requestAccessibility(); }
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s"></span><div><small>Privacy &amp; Security</small><b>Accessibility</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${perms.accessibility ? 'on' : ''}"></div></div></div>
      <h2>Let Relay use your Mac</h2><p class="sub">So Relay can hear its shortcut, type for you, and work in your apps.</p>${chip(perms.accessibility, 'Accessibility on', 'Waiting for Accessibility')}
      ${perms.accessibility ? '' : '<div style="margin-top:14px"><button class="btn" id="open">Open Settings</button></div>'}`;
    $('#open') && ($('#open').onclick = () => relay.openPane('accessibility'));
    footer({ next: perms.accessibility ? 'Continue' : 'Skip for Now' });
  },

  2() {
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s"></span><div><small>Privacy &amp; Security</small><b>Screen &amp; System Audio Recording</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${perms.screen ? 'on' : ''}"></div></div></div>
      <h2>One more: Screen Recording</h2><p class="sub">So Relay can see apps it can't read any other way.</p>${chip(perms.screen, 'Screen Recording on', 'Waiting for Screen Recording')}
      ${perms.screen ? '' : '<div style="margin-top:14px"><button class="btn" id="open">Open Settings</button></div><p class="note" style="margin-top:12px;font-size:14px">If it stays off after you turn it on, quit and reopen Relay.</p>'}`;
    $('#open') && ($('#open').onclick = () => relay.openPane('screen'));
    footer({ next: perms.screen ? 'Continue' : 'Skip for Now' });
  },

  3() {
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s" style="background:#e0568a"></span><div><small>Privacy &amp; Security</small><b>Input Monitoring</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${S.hotkeysRunning ? 'on' : ''}"></div></div></div>
      <h2>Let Relay hear its shortcut</h2><p class="sub">So ${esc(S.labels.ask)} works from any app, not just this window.</p>${chip(S.hotkeysRunning, 'Shortcuts on', 'Waiting for shortcuts')}
      ${S.hotkeysRunning ? '' : '<div style="margin-top:14px"><button class="btn" id="open">Open Settings</button></div><p class="note" style="margin-top:12px;font-size:14px">After turning it on, quit and reopen Relay once.</p>'}`;
    $('#open') && ($('#open').onclick = () => relay.openPane('input'));
    footer({ next: S.hotkeysRunning ? 'Continue' : 'Skip for Now' });
  },

  4() {
    $('#stage').innerHTML = `<div class="mock" style="height:150px;position:relative"><div style="padding:14px 18px;display:flex;gap:22px;font-size:16px;color:#bbb;border-bottom:1px solid #333"><b style="color:#fff">Firefox</b><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Tools</span></div>
      <div style="padding:16px 22px;font-size:17px;line-height:1.9"><div style="color:#fff">about:debugging</div><div style="color:#bbb">This Firefox ›</div><div style="color:var(--accent)">Load Temporary Add-on…</div></div></div>
      <h2>Better Firefox control</h2><p class="sub">Optional. Lets Relay read pages and switch tabs reliably.</p>
      <p style="margin-top:22px;font-weight:600;font-size:19px">Do you use Firefox?</p>
      <div class="yn"><button data-v="no" class="${usesFirefox === false ? 'on' : ''}">No</button><button data-v="yes" class="${usesFirefox === true ? 'on' : ''}">Yes</button></div>
      ${usesFirefox ? `<div class="steps"><b>1.</b> Click Show Me (opens the extension folder and about:debugging).<br><b>2.</b> Choose Load Temporary Add-on… and pick <b>manifest.json</b>.<br><button class="btn" id="show" style="margin:8px 0">Show Me</button> ${chip(S.firefoxConnected, 'Extension connected', 'Waiting for the extension').replace('margin-top:22px', '')}</div>` : ''}`;
    $('.yn').onclick = (e) => {
      if (!e.target.dataset.v) return;
      usesFirefox = e.target.dataset.v === 'yes';
      relay.set('settings.firefox.enabled', usesFirefox);
      render();
    };
    $('#show') && ($('#show').onclick = () => { relay.extensionAction('reveal'); relay.extensionAction('debugging'); });
    footer({ next: 'Continue', nextEnabled: usesFirefox !== null });
  },

  5() {
    $('#stage').innerHTML = `<div class="chat"><div class="bubble">Did you get a chance to look at the plan?</div><div class="bubble me">Yes, looks great</div><div class="bubble">Are you free to talk later today?</div><input id="tf" placeholder="Dictate the reply here with Talkify" value="${esc(talkifyText)}"></div>
      <h2>Try Talkify</h2><p class="sub">Click the box, hold your Talkify key, say the reply, then let go.</p><p class="fine" style="margin-top:14px">This only checks Talkify is typing where your cursor is.</p>`;
    const tf = $('#tf');
    tf.focus();
    tf.oninput = () => { talkifyText = tf.value; footer({ next: talkifyText.trim() ? 'Continue' : 'Skip for Now' }); };
    footer({ next: talkifyText.trim() ? 'Continue' : 'Skip for Now' });
  },

  6() {
    const keys = [
      ['tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
      ['caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'return'],
      ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', '⇧'],
      ['fn', '⌃', '⌥', '⌘', '          ', '⌘', '⌥*', '◀', '▲▼', '▶']
    ];
    const hotLabel = S.settings.shortcuts.ask.code === 'AltRight' ? '⌥*' : null;
    $('#stage').innerHTML = `<div class="kb">${keys.map((r) => `<div class="r">${r.map((k) => `<span class="k ${k === hotLabel ? 'hot' : ''}" style="${k.trim() === '' ? 'width:200px' : ''}">${k === '⌥*' ? '⌥' : k.trim()}</span>`).join('')}</div>`).join('')}</div>
      <h2>Now ask it to do something</h2><p class="sub">Press ${esc(S.labels.ask)}, dictate with Talkify, then press ${esc(S.labels.ask)} again. Say one of these:</p>
      <div class="suggest"><span>“Show me my Downloads folder”</span><span>“What apps do I have open?”</span><span>“Open Notes”</span></div><div id="live" class="note" style="margin-top:18px;min-height:22px;font-size:16px"></div>`;
    const done = S.history.length > startHistory;
    if (done) $('#live').innerHTML = `<span class="ok">Worked:</span> ${esc(S.history[0].reply)}`;
    footer({ next: done ? 'Finish' : 'Skip for Now', nextFn: () => relay.finishOnboarding() });
  }
};

function render() {
  dots();
  SCREENS[String(step)]();
}

(async function init() {
  S = await relay.getState();
  perms = await relay.permissions();
  startHistory = S.history.length;
  usesFirefox = S.settings.firefox.enabled ? true : null;
  render();
  const refresh = async () => {
    S = await relay.getState();
    perms = await relay.permissions();
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') return; // keep typing intact (Talkify check, API key)
    const sig = JSON.stringify([perms, S.hotkeysRunning, S.firefoxConnected, S.history.length, S.hasKey, S.settings.model.provider, S.settings.firefox.enabled]);
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  };
  relay.onStateChanged(refresh);
  setInterval(refresh, 1500);
})();
