// Relay Remote, the phone page. Text from the Mac goes in with textContent only.
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'relay-remote-token';
  let token = localStorage.getItem(KEY) || '';
  let speakOn = localStorage.getItem('relay-remote-speak') !== '0';
  let mode = 'idle'; // idle | listening | working | speaking
  let serverState = 'idle';
  let waiting = null; // the id of a request this phone sent, until its result comes
  let level = 0;
  let stream = null;

  // ---------- pairing ----------
  function show(which) { $('pair').hidden = which !== 'pair'; $('home').hidden = which !== 'home'; }

  async function api(path, body) {
    const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json', 'x-relay-remote': '1' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 401) { unpair(false); throw new Error('Not paired.'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
    return j;
  }

  const preset = new URLSearchParams(location.search).get('code'); // from the QR code on the Mac
  if (preset) $('code').value = preset.replace(/\D/g, '').slice(0, 6);

  $('pairgo').onclick = async () => {
    $('pairerr').textContent = '';
    try {
      const r = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-remote': '1' }, body: JSON.stringify({ code: $('code').value, name: $('devname').value }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      token = j.token;
      localStorage.setItem(KEY, token);
      start();
    } catch (e) { $('pairerr').textContent = e.message; }
  };

  function unpair(callServer = true) {
    token = '';
    localStorage.removeItem(KEY);
    stream?.abort();
    show('pair');
  }

  // ---------- the reactor ----------
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  let raf = 0;
  function size() {
    const r = $('reactor').getBoundingClientRect();
    const d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * d);
    cv.height = Math.round(r.height * d);
  }
  const arc = (r, a0, a1, w, col) => { ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(); };
  function frame(now) {
    const t = now / 1000;
    const W = cv.width;
    ctx.setTransform(1, 0, 0, 1, W / 2, W / 2);
    ctx.clearRect(-W / 2, -W / 2, W, W);
    const R = W * 0.46;
    const busy = mode === 'working';
    const speed = { idle: 0.45, listening: 1.5, working: 2.3, speaking: 1.1 }[mode];
    const amp = mode === 'listening' ? 0.25 + level * 0.9 : mode === 'speaking' ? 0.35 + 0.3 * Math.abs(Math.sin(t * 7)) : 0.12 + 0.05 * Math.sin(t * 2);
    const main = busy ? '255,204,0' : '0,212,255';
    const halo = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * (1.05 + amp * 0.25));
    halo.addColorStop(0, `rgba(${main},${0.28 + amp * 0.3})`);
    halo.addColorStop(1, `rgba(${main},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, R * (1.05 + amp * 0.25), 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) arc(R * 0.93, t * speed + i * 2.09, t * speed + i * 2.09 + 1.15, W * 0.012, `rgba(${main},.95)`);
    for (let i = 0; i < 3; i++) arc(R * 0.79, -t * speed * 1.3 + i * 2.09, -t * speed * 1.3 + i * 2.09 + 0.8, W * 0.008, `rgba(${main},.75)`);
    for (let i = 0; i < 2; i++) arc(R * 0.65, t * speed * 1.8 + i * 3.14, t * speed * 1.8 + i * 3.14 + 1.3, W * 0.006, 'rgba(255,107,0,.7)');
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${main},.55)`;
    for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2 + t * 0.1; const r0 = R * 1.0; const r1 = R * (i % 5 === 0 ? 1.06 : 1.03); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke(); }
    ctx.strokeStyle = `rgba(${main},.35)`;
    ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.stroke();
    const core = R * (0.36 + amp * 0.05);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, core);
    g.addColorStop(0, '#001a2e'); g.addColorStop(0.7, `rgba(${busy ? '90,70,0' : '0,90,140'},.95)`); g.addColorStop(1, `rgba(${main},.95)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, core, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = W * 0.008; ctx.strokeStyle = `rgba(${main},1)`; ctx.beginPath(); ctx.arc(0, 0, core, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `600 ${W * 0.035}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('J.A.R.V.I.S', 0, 0);
    raf = requestAnimationFrame(frame);
  }
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); });

  // ---------- status ----------
  function setMode(m) {
    mode = m;
    $('status').textContent = { idle: 'IDLE', listening: 'LISTENING', working: 'PROCESSING', speaking: 'SPEAKING' }[m];
    $('status').classList.toggle('busy', m === 'working');
  }
  function line(text, dim) { $('line').textContent = text || ''; $('line').classList.toggle('dim', !!dim); }

  function applyStatus(s) {
    if ('locked' in s) setLocked(!!s.locked);
    serverState = s.state || 'idle';
    $('tasks').replaceChildren(...(s.tasks || []).map((t) => { const li = document.createElement('li'); li.className = t.status; li.textContent = t.text; return li; }));
    $('agents').replaceChildren(...(s.agents || []).filter((a) => a.status === 'running').map((a) => { const d = document.createElement('div'); d.className = 'ag'; const b = document.createElement('b'); b.textContent = a.task; const sp = document.createElement('span'); sp.textContent = `${a.step}…`; d.append(b, sp); return d; }));
    if (mode === 'listening' || mode === 'speaking') return;
    const working = waiting || ['working', 'confirm', 'finishing', 'listening'].includes(serverState);
    setMode(working ? 'working' : 'idle');
    if (working && s.label) line(`${s.label}…`, true);
  }

  // The big padlock: open while the Mac is open, closed while it is locked. Tapping it locks the Mac; unlocking is only done at the Mac itself.
  let macLocked = false;
  function setLocked(on) {
    macLocked = on;
    const b = $('lock');
    b.className = on ? 'locked' : 'open';
    b.setAttribute('aria-label', on ? 'The Mac is locked' : 'Lock my Mac');
    $('locklbl').textContent = on ? 'Mac is locked' : 'Lock my Mac';
  }
  $('lock').onclick = () => {
    if (macLocked) { $('locklbl').textContent = 'Unlock it at the Mac'; setTimeout(() => setLocked(macLocked), 2000); return; }
    $('lock').classList.add('pending');
    setTimeout(() => $('lock').classList.remove('pending'), 4000);
    ask('lock my mac');
  };

  // Sideways, the answer column gets the height the shortcut buttons leave (the CSS reads --quickh).
  const measureQuick = () => document.documentElement.style.setProperty('--quickh', `${$('quick').offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(measureQuick).observe($('quick'));
  addEventListener('resize', measureQuick);

  // The music and shortcut buttons can be hidden (button at the bottom left); the choice is remembered.
  function setQuick(show) {
    document.body.classList.toggle('noquick', !show);
    $('qtog').setAttribute('aria-pressed', String(show));
    try { localStorage.setItem('relay-remote-quick', show ? '1' : '0'); } catch {}
  }
  $('qtog').onclick = () => setQuick(document.body.classList.contains('noquick'));
  setQuick((() => { try { return localStorage.getItem('relay-remote-quick') !== '0'; } catch { return true; } })());

  // The keyboard button: held upright, the phone's own keyboard (a bar at the bottom); turned sideways, the full-screen hologram keyboard. Both show what you typed at the top.
  const landscape = () => window.matchMedia('(orientation: landscape)').matches;
  const kbState = (on) => { $('kbd').setAttribute('aria-pressed', String(on)); document.body.classList.toggle('kbopen', on && kb.isOpen); };
  const kb = window.HoloKeyboard({ onSend: (t) => { kbState(false); ask(t); }, onClose: () => kbState(false) });
  const typing = () => kb.isOpen || !$('bar').hidden;
  function showTyping(on) {
    if (landscape()) {
      $('bar').hidden = true; $('quick').hidden = false;
      if (on) kb.open(); else kb.close();
    } else {
      kb.close();
      $('bar').hidden = !on; $('quick').hidden = on;
      if (on) setTimeout(() => $('text').focus(), 50); else $('text').blur();
    }
    kbState(on);
  }
  $('kbd').onclick = () => showTyping(!typing());
  window.matchMedia('(orientation: landscape)').addEventListener('change', () => showTyping(false)); // turning the phone closes whichever keyboard was open
  $('bar').onsubmit = (e) => { e.preventDefault(); const v = $('text').value.trim(); $('text').value = ''; showTyping(false); if (v) ask(v); };

  // What was asked stays at the top while the answer comes, and above the answer after it.
  function showAsked(t) { const a = $('asked'); a.textContent = t || ''; a.hidden = !t; }

  function showReply(text) { $('reply').textContent = text || ''; }

  function speak(text) {
    if (!speakOn || !('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onstart = () => setMode('speaking');
    u.onend = u.onerror = () => setMode(waiting ? 'working' : 'idle');
    speechSynthesis.speak(u);
  }

  function onEvent(e) {
    if (e.type === 'status') applyStatus(e);
    else if (e.type === 'result') {
      const mine = waiting && e.id === waiting;
      if (mine) waiting = null;
      line('');
      showReply(e.reply);
      if (mine) { setMode('idle'); speak(e.reply); }
      else if (mode !== 'listening') setMode('idle');
    }
  }

  // The event stream, by fetch (it can carry the token in a header). It reconnects by itself.
  async function connect() {
    stream?.abort();
    const ac = new AbortController();
    stream = ac;
    try {
      const res = await fetch('/api/events', { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
      if (res.status === 401) return unpair(false);
      $('conn').className = 'dot on';
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = chunk.match(/^data: (.*)$/m);
          if (m) { try { onEvent(JSON.parse(m[1])); } catch {} }
        }
      }
    } catch {}
    if (ac.signal.aborted || !token) return;
    $('conn').className = 'dot bad';
    setTimeout(connect, 2500);
  }

  // ---------- asking ----------
  async function ask(text) {
    const t = String(text || '').trim();
    if (!t) return;
    unlockSpeech();
    try {
      showReply('');
      showAsked(t);
      line('');
      setMode('working');
      const r = await api('/api/ask', { text: t });
      waiting = r.id;
    } catch (e) { waiting = null; setMode('idle'); line(e.message); }
  }
  for (const b of document.querySelectorAll('#quick button')) b.onclick = () => ask(b.dataset.say);
  
  let unlocked = false;
  function unlockSpeech() { // iOS only lets speech start after a tap; a silent word on the first tap opens it
    if (unlocked || !('speechSynthesis' in window)) return;
    unlocked = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  // ---------- hold to talk ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Try it whenever the browser has speech recognition (Safari does). Some browsers only allow the microphone on a secure address;
  // if so, the error below says so instead of the button being switched off before it is tried.
  const canTalk = !!SR;
  let rec = null;
  let heard = '';
  let blocked = false;
  let holding = false;
  let startedAt = 0;
  let lastErr = '';
  // What the browser's error code means for the person holding the phone. 'no-speech' and 'aborted' are ordinary (nothing said, or stopped).
  const SPEECH_ERRORS = {
    network: 'The speech service could not be reached. Check the phone has internet, and that Siri & Dictation is on.',
    'audio-capture': 'No microphone audio. Another app may be using it: close it and try again.',
    'language-not-supported': 'This phone has no speech recognition for its language. Type instead.',
  };
  function startTalk() {
    if (!canTalk) { showTyping(true); return; }
    // iOS keeps the audio session in "playing" mode for a moment after the phone speaks, and the microphone hears nothing until it is
    // released: so when it was talking, give the session a beat before recognition starts (read before the silent unlock word below).
    const wasTalking = !!speechSynthesis?.speaking;
    unlockSpeech();
    speechSynthesis?.cancel?.();
    heard = '';
    lastErr = '';
    holding = true;
    startedAt = 0;
    const r = new SR();
    rec = r;
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (ev) => { heard = Array.from(ev.results).map((x) => x[0].transcript).join(' '); line(heard, true); level = 0.6; };
    r.onaudiostart = () => { level = 0.4; };
    r.onerror = (ev) => {
      lastErr = ev.error || '';
      if (['not-allowed', 'service-not-allowed'].includes(ev.error)) { blocked = true; line(window.isSecureContext ? 'Allow the microphone and Siri & Dictation for Safari, then try again.' : 'The microphone is blocked on this address. Use the Tailscale https link, or type.', true); }
    };
    r.onend = () => {
      if (rec === r) rec = null;
      setMode('idle'); level = 0;
      const t = heard.trim(); heard = '';
      if (t) ask(t);
      else if (!blocked) line(SPEECH_ERRORS[lastErr] || (lastErr && !['no-speech', 'aborted'].includes(lastErr) ? `Microphone problem (${lastErr}).` : 'Did not catch that. Speak right after it says Listening.'), true);
      blocked = false;
    };
    setMode('listening');
    line('Listening…', true);
    const go = () => {
      if (!holding || rec !== r) { if (rec === r) rec = null; setMode('idle'); line(''); return; } // let go before it began
      startedAt = Date.now();
      try { r.start(); } catch { if (rec === r) rec = null; setMode('idle'); line('Could not start the microphone. Try again.', true); }
    };
    if (wasTalking) setTimeout(go, 300); else go();
  }
  // Letting go straight away would stop it before it heard anything, so it always listens for at least 0.7 seconds.
  function endTalk() {
    holding = false;
    const r = rec;
    if (!r || !startedAt) return;
    setTimeout(() => { try { r.stop(); } catch {} }, Math.max(0, 700 - (Date.now() - startedAt)));
  }
  const reactor = $('reactor');
  reactor.addEventListener('pointerdown', (e) => { e.preventDefault(); reactor.setPointerCapture?.(e.pointerId); startTalk(); });
  for (const ev of ['pointerup', 'pointercancel']) reactor.addEventListener(ev, endTalk);
  setInterval(() => { if (mode === 'listening') level = 0.3 + Math.random() * 0.5; }, 120);

  // ---------- menu ----------
  // What Relay learned about you (Smarter memory on the Mac): approve, or delete from here. Editing stays on the Mac.
  const memBox = $('mem');
  async function loadMemory() {
    let m;
    try { m = await api('/api/memory'); } catch { return; }
    const any = (m.lessons || []).length || (m.inferred || []).length;
    $('memtog').hidden = !any;
    if (!any) { memBox.hidden = true; return; }
    memBox.replaceChildren();
    const section = (title, items, render) => {
      if (!items.length) return;
      const h4 = document.createElement('h4'); h4.textContent = title; memBox.append(h4);
      for (const it of items) memBox.append(render(it));
    };
    const row = (main, sub, buttons) => {
      const d = document.createElement('div'); d.className = 'it';
      const sp = document.createElement('span'); sp.textContent = main;
      if (sub) { const sm = document.createElement('small'); sm.textContent = sub; sp.append(sm); }
      const bx = document.createElement('div');
      for (const [label, action, id] of buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = async () => { b.disabled = true; try { await api('/api/memory', { action, id }); } catch {} loadMemory(); }; bx.append(b); }
      d.append(sp, bx); return d;
    };
    section('Noticed about you', m.inferred || [], (x) => row(x.text, x.status === 'approved' ? 'in use' : 'waiting for you', [...(x.status === 'pending' ? [['Approve', 'inferred-approve', x.id]] : []), ['Delete', 'inferred-delete', x.id]]));
    section('Lessons from corrections', m.lessons || [], (l) => row(l.trigger, l.fix, [['Delete', 'lesson-delete', l.id]]));
  }
  $('memtog').onclick = () => { memBox.hidden = !memBox.hidden; };
  $('gear').addEventListener('click', () => setTimeout(() => { if (!$('menu').hidden) loadMemory(); }, 0)); // after the click that opens the menu

  $('gear').onclick = () => { $('menu').hidden = !$('menu').hidden; };
  $('speak').checked = speakOn;
  $('speak').onchange = () => { speakOn = $('speak').checked; localStorage.setItem('relay-remote-speak', speakOn ? '1' : '0'); if (!speakOn) speechSynthesis?.cancel?.(); };
  $('stop').onclick = () => { api('/api/stop', {}).catch(() => {}); waiting = null; setMode('idle'); line('Stopped', true); $('menu').hidden = true; };
  $('unpair').onclick = () => { if (confirm('Unpair this phone?')) unpair(); };
  $('support').textContent = canTalk ? (window.isSecureContext ? 'Hold the reactor to talk.' : 'Hold the reactor to talk. If it says the microphone is blocked, this address is not secure enough: use the Tailscale https link, or type.') : 'This browser has no speech recognition. Open Relay in Safari to hold and talk, or type and use the keyboard microphone.';
  $('hint').textContent = canTalk ? 'Hold to talk' : 'Open in Safari to talk · or tap the keyboard button';

  // ---------- start ----------
  async function start() {
    show('home');
    size();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    try {
      const s = await api('/api/state');
      $('devtitle').textContent = `Relay · ${s.device}`;
      const last = (s.recent || [])[0];
      if (last) showReply(last.reply);
      applyStatus(s);
    } catch { return; }
    connect();
    // /?say=lock%20my%20mac (a bookmark, or a Shortcut's Open URL) sends that phrase as soon as the page is up, then forgets it
    const say = new URLSearchParams(location.search).get('say');
    if (say) { history.replaceState(null, '', location.pathname); ask(say.slice(0, 300)); }
  }
  if (token) start(); else show('pair');
})();
