const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>';
const KEY = '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M9 14h6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const WARN = '<svg viewBox="0 0 24 24"><path d="M12 4l9.4 16H2.6z"/></svg>';
const $ = (id) => document.getElementById(id);
const stage = $('stage'), goo = $('goo'), neck = $('neck'), body = $('body'), sheen = $('sheen'), pill = $('pill');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Must match AskController: the window is W + 2 * PAD wide, and the pill sits TOP below the window's top edge.
const PAD = 36;
const W = 480;
const NOTCH_W = 190;
let TOP = 43;
let current = 'idle';
let shown = false;
let exitTimer = null;
let meltTimer = null;
let interactive = false;

const rect = (l, t, w, h) => ({ left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
const finalRect = (h) => rect(PAD, TOP, W, h);
// Where the liquid starts and ends: a small blob tucked behind the notch.
const notchRect = () => rect((W + 2 * PAD) / 2 - NOTCH_W / 2, -36, NOTCH_W, 64);

function setRect(r) {
  Object.assign(body.style, r);
  Object.assign(sheen.style, r);
}

function layout() {
  Object.assign(pill.style, { left: PAD + 'px', top: TOP + 'px', width: W + 'px' });
}

const measure = () => Math.ceil(pill.getBoundingClientRect().height);

function fit() {
  requestAnimationFrame(() => {
    const h = measure();
    if (shown) setRect(finalRect(h));
    window.relay.ask.resize(h);
  });
}

function enter() {
  clearTimeout(exitTimer);
  const h = measure();
  window.relay.ask.resize(h);
  stage.classList.remove('in', 'out');
  // Start as a blob behind the notch, with no transition.
  for (const el of [body, sheen]) el.style.transition = 'none';
  setRect(notchRect());
  neck.classList.remove('go');
  neck.style.setProperty('--neck-h', TOP + 18 + 'px');
  goo.classList.add('melt');
  void body.offsetWidth;
  for (const el of [body, sheen]) el.style.transition = '';
  requestAnimationFrame(() => {
    stage.classList.add('in');
    neck.classList.add('go');
    setRect(finalRect(h));
  });
  clearTimeout(meltTimer);
  meltTimer = setTimeout(() => goo.classList.remove('melt'), 640);
  shown = true;
}

function exit() {
  if (!shown) return window.relay.ask.hidden();
  stage.classList.remove('in');
  stage.classList.add('out');
  goo.classList.add('melt');
  neck.classList.remove('go');
  setRect(notchRect());
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => {
    shown = false;
    window.relay.ask.hidden();
  }, 300);
}

// Replaces the pill's content. Once shown, the old content blinks out and the new one fades in
// while the glass body morphs to the new size.
function put(html, bind) {
  if (!shown) {
    pill.innerHTML = html;
    bind?.();
    return;
  }
  pill.classList.add('swap');
  setTimeout(() => {
    pill.innerHTML = html;
    bind?.();
    pill.classList.remove('swap');
    fit();
  }, 80);
}

const HUDSPIN = '<div class="hudspin"></div>';
const SCAN = '<div class="scan"></div>';
const status = (t) => `<span class="status">${t}</span>`;

const BAR_SHAPE = [0.55, 0.85, 1, 0.8, 0.5];

function renderListening(msg) {
  const label = msg.mode === 'dictate' ? msg.dictateLabel : msg.askLabel;
  if (current !== 'listening' || msg.reset) {
    put(`<div class="line"><div class="bars idle" id="bars">${BAR_SHAPE.map(() => '<i></i>').join('')}</div><div class="live empty" id="live">${status(msg.mode === 'dictate' ? 'Dictating' : 'Listening')}<span>${msg.mode === 'dictate' ? 'Dictating…' : 'Listening…'}</span></div><span class="hint">${esc(label)} to ${msg.mode === 'dictate' ? 'finish' : 'send'}</span></div>`);
  }
  const live = $('live');
  if (msg.preparing !== undefined && live && !msg.partial) {
    live.className = 'live empty';
    live.innerHTML = `${status(msg.mode === 'dictate' ? 'Dictating' : 'Listening')}<span>Getting speech ready ${Math.round(msg.preparing * 100)}%</span>`;
  }
  if (msg.partial !== undefined && live) {
    if (msg.partial) {
      live.className = 'live';
      live.innerHTML = `${status(msg.mode === 'dictate' ? 'Dictating' : 'Listening')}<span>${esc(msg.partial)}</span>`;
      fit();
    } else if (msg.reset) {
      live.className = 'live empty';
    }
  }
  if (msg.level !== undefined) {
    const bars = $('bars');
    if (bars) {
      bars.classList.remove('idle');
      [...bars.children].forEach((b, i) => { b.style.height = `${4 + Math.round(msg.level * 20 * BAR_SHAPE[i] + Math.random() * 3)}px`; });
    }
  }
}

function renderInput(msg) {
  if (current !== 'input' || msg.reset) {
    put(`<div class="line"><div class="ico mic">${KEY}</div><input id="in" autocomplete="off" spellcheck="false" placeholder="Type a request"><span class="hint">Return to send</span></div>${msg.notice ? `<div class="notice">${esc(msg.notice)}</div>` : ''}`, () => {
      const input = $('in');
      input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); window.relay.ask.submit(input.value); }
        if (e.key === 'Escape') { e.preventDefault(); window.relay.ask.cancel(); }
      };
      input.focus();
    });
  }
  const input = $('in');
  if (msg.requestSubmit && input) window.relay.ask.submit(input.value);
}

function draw(msg) {
  if (msg.state === 'listening') renderListening(msg);
  else if (msg.state === 'finishing') {
    if (current !== 'finishing') put(`<div class="line"><div class="spin"></div>${HUDSPIN}<div class="label">${status('Processing')}Finishing…</div></div>${SCAN}`);
  } else if (msg.state === 'input') renderInput(msg);
  else if (msg.state === 'working') {
    const label = msg.label || 'Working';
    if (current !== 'working' || msg.label || msg.text) {
      const prev = pill.querySelector('.label small')?.textContent;
      put(`<div class="line"><div class="spin"></div>${HUDSPIN}<div class="label">${status('Working')}${esc(label)}…<small>${esc(msg.text || prev || '')}</small></div><button class="btn" id="stop">Stop</button></div>${SCAN}`, () => {
        $('stop').onclick = () => window.relay.ask.cancel();
      });
    }
  } else if (msg.state === 'confirm') {
    if (msg.question) {
      put(`<div class="q">${esc(msg.question)}</div><div class="acts"><button class="btn" id="no">Cancel</button><button class="btn go" id="yes">Allow</button></div>`, () => {
        $('no').onclick = () => window.relay.ask.confirm(false);
        $('yes').onclick = () => window.relay.ask.confirm(true);
      });
    }
  } else if (msg.state === 'done') {
    if (msg.reply !== undefined) {
      const ok = msg.status === 'done';
      put(`<div class="line"><div class="ico ${ok ? 'ok' : 'bad warn'}">${ok ? CHECK : WARN}</div><div class="reply">${status(ok ? 'Complete' : 'Attention')}${esc(msg.reply)}</div><span class="x" id="x">✕</span></div>`, () => {
        $('x').onclick = () => window.relay.ask.cancel();
      });
    }
  }
}

function render(msg) {
  if (msg.look !== undefined) document.body.classList.toggle('jarvis', msg.look === 'jarvis');
  if (msg.glass !== undefined) stage.classList.toggle('native-glass', !!msg.glass); // real glass is drawn behind this window
  if (msg.top !== undefined && msg.top !== TOP) { TOP = msg.top; layout(); }
  if (msg.hide) return exit();
  if (!shown && !msg.show) return; // late updates while hidden
  if (msg.show) current = 'idle'; // rebuild the content from scratch
  draw(msg);
  current = msg.state;
  if (msg.show) requestAnimationFrame(enter);
  else fit();
}

// The window is click-through except over the pill, so its transparent margin never blocks the menu bar.
document.addEventListener('mousemove', (e) => {
  const r = pill.getBoundingClientRect();
  const over = shown && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
  if (over !== interactive) {
    interactive = over;
    window.relay.ask.interactive(over);
  }
});
document.addEventListener('mouseleave', () => {
  if (interactive) {
    interactive = false;
    window.relay.ask.interactive(false);
  }
});

layout();
window.relay.ask.onState(render);
