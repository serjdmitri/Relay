/* global relay, icon, LOGO, h, esc */
let S = null;
let perms = { accessibility: false, screen: false, mic: false, micStatus: 'unknown' };
let step = -1; // -1 = welcome, 0..7 = the eight steps
let askedAccessibility = false;
let lastSig = '';
let usesFirefox = null;
let dictText = '';
let startHistory = 0;
let loginBusy = false;
let loginError = '';

const $ = (sel, root = document) => root.querySelector(sel);
const STEPS = 8;

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
    $('#stage').innerHTML = `<div class="app-icon">${LOGO}</div><h2>Welcome to Relay</h2><p class="sub">Talk to your Mac. Relay types for you, or gets it done.</p><p class="fine">Your voice is turned into words on this Mac and never leaves it.</p>`;
    footer({ back: false, next: 'Get Started' });
    $('#footer .pill-btn:last-child').onclick = () => go(0);
  },

  0() {
    const cl = S.claude || {};
    let body;
    if (!cl.checked) body = chip(false, '', 'Checking…');
    else if (!cl.installed) {
      body = `<p class="sub" style="margin-top:14px">Relay signs in through Claude Code, Anthropic's own app. Run this once in Terminal:</p>
        <div class="form" style="margin-top:12px"><div class="code" style="font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#1d1d1d;border:1px solid #3a3a3a;border-radius:8px;padding:10px 12px;user-select:text">curl -fsSL https://claude.ai/install.sh | bash</div>
        <div style="display:flex;gap:10px;justify-content:center"><button class="btn" id="cp">Copy</button><button class="btn primary" id="chk">Check Again</button></div></div>`;
    } else if (cl.loggedIn) body = chip(true, `Signed in as ${esc(cl.email || 'your Claude account')}`, '');
    else body = `<div style="margin-top:22px"><button class="btn primary big" id="in" style="width:260px" ${loginBusy ? 'disabled' : ''}>${loginBusy ? 'Waiting for your browser…' : 'Sign in with Claude'}</button></div>
      <p class="note" style="margin-top:12px;font-size:14px">${loginError ? `<span class="bad">${esc(loginError)}</span>` : 'Opens your browser. No API key needed.'}</p>`;
    $('#stage').innerHTML = `<div class="app-icon">${LOGO}${cl.loggedIn ? `<div class="badge">${check}</div>` : ''}</div><h2>Sign in with Claude</h2><p class="sub">Relay uses your Claude account to think. Nothing to paste.</p>${body}`;
    $('#in') && ($('#in').onclick = async () => {
      loginBusy = true; loginError = ''; render();
      const r = await relay.claudeLogin();
      loginBusy = false; loginError = r.ok ? '' : (r.error || 'Sign in did not finish.').split('\n').pop();
      render();
    });
    $('#cp') && ($('#cp').onclick = () => navigator.clipboard?.writeText('curl -fsSL https://claude.ai/install.sh | bash'));
    $('#chk') && ($('#chk').onclick = () => relay.claudeStatus());
    footer({ next: cl.loggedIn ? 'Continue' : 'Skip for Now' });
  },

  1() {
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s" style="background:#2a9ee0"></span><div><small>Privacy &amp; Security</small><b>Microphone</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${perms.mic ? 'on' : ''}"></div></div></div>
      <h2>Let Relay hear you</h2><p class="sub">So you can talk instead of type. Audio is turned into words on this Mac and never sent anywhere.</p>${chip(perms.mic, 'Microphone on', 'Waiting for Microphone')}
      ${perms.mic ? '' : `<div style="margin-top:14px"><button class="btn primary" id="allow">${perms.micStatus === 'denied' ? 'Open Settings' : 'Allow Microphone'}</button></div>`}`;
    $('#allow') && ($('#allow').onclick = () => (perms.micStatus === 'denied' ? relay.openPane('mic') : relay.requestMic()));
    footer({ next: perms.mic ? 'Continue' : 'Skip for Now' });
  },

  2() {
    if (!askedAccessibility) { askedAccessibility = true; relay.requestAccessibility(); }
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s"></span><div><small>Privacy &amp; Security</small><b>Accessibility</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${perms.accessibility ? 'on' : ''}"></div></div></div>
      <h2>Let Relay use your Mac</h2><p class="sub">So Relay can hear its shortcut, type for you, and work in your apps.</p>${chip(perms.accessibility, 'Accessibility on', 'Waiting for Accessibility')}
      ${perms.accessibility ? '' : '<div style="margin-top:14px"><button class="btn" id="open">Open Settings</button></div>'}`;
    $('#open') && ($('#open').onclick = () => relay.openPane('accessibility'));
    footer({ next: perms.accessibility ? 'Continue' : 'Skip for Now' });
  },

  3() {
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s"></span><div><small>Privacy &amp; Security</small><b>Screen &amp; System Audio Recording</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${perms.screen ? 'on' : ''}"></div></div></div>
      <h2>One more: Screen Recording</h2><p class="sub">So Relay can see apps it can't read any other way.</p>${chip(perms.screen, 'Screen Recording on', 'Waiting for Screen Recording')}
      ${perms.screen ? '' : '<div style="margin-top:14px"><button class="btn" id="open">Open Settings</button></div><p class="note" style="margin-top:12px;font-size:14px">If it stays off after you turn it on, quit and reopen Relay.</p>'}`;
    $('#open') && ($('#open').onclick = () => relay.openPane('screen'));
    footer({ next: perms.screen ? 'Continue' : 'Skip for Now' });
  },

  4() {
    $('#stage').innerHTML = `<div class="mock"><div class="mh"><span class="s" style="background:#2a9ee0"></span><div><small>Privacy &amp; Security</small><b>Input Monitoring</b></div></div>
      <div class="mr"><span><span class="ghost"></span><span class="bar"></span></span><span></span></div>
      <div class="mr"><span style="display:flex;align-items:center;gap:12px"><span style="width:26px;height:26px;border-radius:7px;display:inline-grid;place-items:center;background:#444">${LOGO.replace('<svg', '<svg width="22" height="22"')}</span><span style="font-size:17px">Relay</span></span><div class="toggle ${S.hotkeysRunning && S.hotkeysSeen ? 'on' : ''}"></div></div></div>
      <h2>Let Relay hear its shortcut</h2><p class="sub">So ${esc(S.labels.ask)} works from any app, not just this window.</p>${chip(S.hotkeysRunning && S.hotkeysSeen, 'Shortcuts on', S.hotkeysRunning ? 'Press any key to check' : 'Waiting for shortcuts')}
      ${S.hotkeysRunning && S.hotkeysSeen ? '' : '<div style="margin-top:14px"><button class="btn" id="open">Open Settings</button></div><p class="note" style="margin-top:12px;font-size:14px">After turning it on, quit and reopen Relay once.</p>'}`;
    $('#open') && ($('#open').onclick = () => relay.openPane('input'));
    footer({ next: S.hotkeysRunning && S.hotkeysSeen ? 'Continue' : 'Skip for Now' });
  },

  5() {
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

  6() {
    $('#stage').innerHTML = `<div class="chat"><div class="bubble">Did you get a chance to look at the plan?</div><div class="bubble me">Yes, looks great</div><div class="bubble">Are you free to talk later today?</div><input id="tf" placeholder="Hold ${esc(S.labels.dictate)} and say the reply" value="${esc(dictText)}"></div>
      <h2>Try dictation</h2><p class="sub">Click the box, hold ${esc(S.labels.dictate)}, say the reply, then let go. Your words appear right where the cursor is.</p><p class="fine" style="margin-top:14px">Tapping ${esc(S.labels.dictate)} once to start and once to finish works too.</p>`;
    const tf = $('#tf');
    tf.focus();
    tf.oninput = () => { dictText = tf.value; footer({ next: dictText.trim() ? 'Continue' : 'Skip for Now' }); };
    footer({ next: dictText.trim() ? 'Continue' : 'Skip for Now' });
  },

  7() {
    const keys = [
      ['tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
      ['caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'return'],
      ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', '⇧'],
      ['fn', '⌃', '⌥', '⌘', '          ', '⌘', '⌥*', '◀', '▲▼', '▶']
    ];
    const hotLabel = S.settings.shortcuts.ask.code === 'AltRight' ? '⌥*' : null;
    $('#stage').innerHTML = `<div class="kb">${keys.map((r) => `<div class="r">${r.map((k) => `<span class="k ${k === hotLabel ? 'hot' : ''}" style="${k.trim() === '' ? 'width:200px' : ''}">${k === '⌥*' ? '⌥' : k.trim()}</span>`).join('')}</div>`).join('')}</div>
      <h2>Now ask it to do something</h2><p class="sub">Press ${esc(S.labels.ask)}, say it, then press ${esc(S.labels.ask)} again. Try one of these:</p>
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
  relay.claudeStatus();
  usesFirefox = S.settings.firefox.enabled ? true : null;
  render();
  const refresh = async () => {
    S = await relay.getState();
    perms = await relay.permissions();
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') return; // keep typing intact (dictation check)
    const sig = JSON.stringify([perms, S.hotkeysRunning, S.hotkeysSeen, S.firefoxConnected, S.history.length, S.claude, S.settings.firefox.enabled]);
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  };
  relay.onStateChanged(refresh);
  setInterval(refresh, 1500);
})();
