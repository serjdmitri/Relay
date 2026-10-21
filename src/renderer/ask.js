const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const WARN = '<svg viewBox="0 0 24 24"><path d="M12 6v7M12 17v.01"/></svg>';
const pill = document.getElementById('pill');
let current = 'idle';
let value = '';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fit() {
  requestAnimationFrame(() => window.relay.ask.resize(Math.ceil(pill.getBoundingClientRect().height) + 8));
}

function renderInput(msg) {
  if (current !== 'input' || msg.reset) {
    value = '';
    pill.innerHTML = `<div class="line"><div class="mic">${MIC}</div><input id="in" autocomplete="off" spellcheck="false" placeholder="${msg.typed ? 'Type a request' : 'Say it with Talkify…'}"><span class="hint">${esc(msg.askLabel)} to send</span></div>`;
    const input = document.getElementById('in');
    input.oninput = () => (value = input.value);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); window.relay.ask.submit(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); window.relay.ask.cancel(); }
    };
    input.focus();
  }
  const input = document.getElementById('in');
  if (msg.clipboardText && input && !input.value.trim()) { input.value = msg.clipboardText; value = msg.clipboardText; }
  if (msg.requestSubmit && input) window.relay.ask.submit(input.value);
}

function render(msg) {
  if (msg.state === 'input') renderInput(msg);
  else if (msg.state === 'working') {
    const label = msg.label || 'Working';
    if (current !== 'working' || msg.label || msg.text) {
      const prev = pill.querySelector('.label small')?.textContent;
      pill.innerHTML = `<div class="line"><div class="spin"></div><div class="label">${esc(label)}…<small>${esc(msg.text || prev || '')}</small></div><button class="btn" id="stop">Stop</button></div>`;
      document.getElementById('stop').onclick = () => window.relay.ask.cancel();
    }
  } else if (msg.state === 'confirm') {
    if (msg.question) {
      pill.innerHTML = `<div class="q">${esc(msg.question)}</div><div class="acts"><button class="btn" id="no">Cancel</button><button class="btn go" id="yes">Allow</button></div>`;
      document.getElementById('no').onclick = () => window.relay.ask.confirm(false);
      document.getElementById('yes').onclick = () => window.relay.ask.confirm(true);
    }
  } else if (msg.state === 'done') {
    if (msg.reply !== undefined) {
      const ok = msg.status === 'done';
      pill.innerHTML = `<div class="line"><div class="mic ${ok ? 'ok' : 'bad'}">${ok ? CHECK : WARN}</div><div class="reply">${esc(msg.reply)}</div><button class="btn" id="x">Close</button></div>`;
      document.getElementById('x').onclick = () => window.relay.ask.cancel();
    }
  }
  current = msg.state;
  fit();
}

window.relay.ask.onState(render);
