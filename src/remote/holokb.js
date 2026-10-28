// The hologram keyboard on the phone page: a full-screen blue keyboard that stands in for the phone's own keyboard. What you type is shown big at the top, Enter sends it,
// and the X closes it (the words stay for next time). The typing rules (shift, layers, backspace, capital after a full stop) are plain code at the top so they can be
// tested; the drawing is below. Text from the keys goes in with textContent only.
(function () {
  const ROWS = {
    letters: [
      'q w e r t y u i o p'.split(' '),
      'a s d f g h j k l'.split(' '),
      ['{shift}', ...'z x c v b n m'.split(' '), '{back}'],
      ['{num}', ',', '{space}', '.', '{send}']
    ],
    numbers: [
      '1 2 3 4 5 6 7 8 9 0'.split(' '),
      ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
      ['{sym}', '.', ',', '?', '!', "'", '{back}'],
      ['{abc}', '{space}', '{send}']
    ],
    symbols: [
      ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
      ['_', '\\', '|', '~', '<', '>', '€', '£', '¥', '•'],
      ['{num}', '.', ',', '?', '!', "'", '{back}'],
      ['{abc}', '{space}', '{send}']
    ]
  };

  // ---- the typing rules ----
  class KeyState {
    constructor(text = '') {
      this.text = text;
      this.layer = 'letters';
      this.shift = 'once'; // off | once | lock: a capital to start
      this.lastShiftTap = 0;
    }

    get upper() { return this.shift !== 'off'; }

    // A capital after ". ", "? " or "! ", and at the very start.
    autoCap() { return this.text === '' || /[.!?]\s+$/.test(this.text); }

    // Returns { send: true } for Enter, otherwise nothing; `now` is only for the double tap on shift.
    press(key, now = Date.now()) {
      if (key === '{send}') return { send: true };
      if (key === '{back}') { this.text = this.text.slice(0, -1); if (this.shift === 'off' && this.autoCap()) this.shift = 'once'; return {}; }
      if (key === '{space}') { this.text += ' '; this.after(); return {}; }
      if (key === '{shift}') {
        if (this.shift === 'lock') this.shift = 'off';
        else if (this.shift === 'once' && now - this.lastShiftTap < 350) this.shift = 'lock'; // a quick second tap is caps lock
        else this.shift = this.shift === 'once' ? 'off' : 'once';
        this.lastShiftTap = now;
        return {};
      }
      if (key === '{num}') { this.layer = 'numbers'; return {}; }
      if (key === '{sym}') { this.layer = 'symbols'; return {}; }
      if (key === '{abc}') { this.layer = 'letters'; return {}; }
      this.text += this.layer === 'letters' && this.upper ? key.toUpperCase() : key;
      if (this.shift === 'once') this.shift = 'off';
      this.after();
      return {};
    }

    after() { if (this.shift !== 'lock' && this.autoCap()) this.shift = 'once'; }
  }

  const SPECIAL = /^\{[a-z]+\}$/;
  const LABEL = { '{shift}': '⇧', '{back}': '⌫', '{space}': 'space', '{send}': 'SEND ↵', '{num}': '123', '{sym}': '#+=', '{abc}': 'ABC' };

  // ---- the drawing ----
  function HoloKeyboard({ onSend, onClose, root = document.body }) {
    const st = new KeyState('');
    let el = null, readout = null, board = null, repeat = null, hold = null;
    let isOpen = false;
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    function build() {
      el = mk('div', '');
      el.id = 'kb';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Keyboard');
      const head = mk('div', 'kbhead');
      const title = mk('span', 'kbtitle', 'ASK RELAY');
      const x = mk('button', 'kbx', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close the keyboard');
      x.onclick = () => close(true);
      head.append(title, x);
      readout = mk('div', 'kbtext');
      board = mk('div', 'kbboard');
      el.append(head, readout, board);
      el.addEventListener('pointerdown', onDown);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, stopRepeat);
      root.append(el);
    }

    function draw() {
      readout.replaceChildren();
      if (st.text) readout.append(document.createTextNode(st.text)); else readout.append(mk('span', 'ph', 'Type your question…'));
      readout.append(mk('span', 'caret'));
      readout.scrollTop = readout.scrollHeight;
      board.replaceChildren();
      for (const row of ROWS[st.layer]) {
        const r = mk('div', 'kbrow');
        for (const k of row) {
          const mod = SPECIAL.test(k); // '{' and '}' on their own are ordinary keys
          const b = mk('button', `key${mod ? ` mod k-${k.slice(1, -1)}` : ''}`, mod ? LABEL[k] : (st.layer === 'letters' && st.upper ? k.toUpperCase() : k));
          if (k === '{shift}') b.classList.add(st.shift);
          b.type = 'button';
          b.dataset.k = k;
          b.tabIndex = -1;
          r.append(b);
        }
        board.append(r);
      }
    }

    function press(k) {
      const r = st.press(k);
      if (r.send) return send();
      draw();
      const b = board.querySelector(`[data-k="${CSS.escape(k)}"]`);
      if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 90); }
    }

    function send() {
      const t = st.text.trim();
      if (!t) return;
      st.text = ''; st.shift = 'once'; st.layer = 'letters';
      close(false);
      onSend(t);
    }

    function stopRepeat() { clearTimeout(hold); clearInterval(repeat); hold = repeat = null; }

    function onDown(e) {
      const b = e.target.closest('.key');
      if (!b) return;
      e.preventDefault(); // no text selection, no phone keyboard
      const k = b.dataset.k;
      press(k);
      if (k === '{back}') { stopRepeat(); hold = setTimeout(() => { repeat = setInterval(() => press('{back}'), 70); }, 380); }
    }

    function onKey(e) {
      if (!isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') { e.preventDefault(); return send(); }
      if (e.key === 'Escape') { e.preventDefault(); return close(true); }
      if (e.key === 'Backspace') { e.preventDefault(); return press('{back}'); }
      if (e.key.length === 1) { e.preventDefault(); st.text += e.key; st.shift = 'off'; if (st.autoCap()) st.shift = 'once'; draw(); }
    }
    document.addEventListener('keydown', onKey);

    function open() {
      if (!el) build();
      isOpen = true;
      el.hidden = false;
      draw();
    }

    function close(notify) {
      if (!el) return;
      stopRepeat();
      isOpen = false;
      el.hidden = true;
      if (notify) onClose?.();
    }

    return { open, close: () => close(false), toggle() { isOpen ? close(true) : open(); }, get isOpen() { return isOpen; }, state: st };
  }

  const api = { KeyState, ROWS, LABEL, SPECIAL, HoloKeyboard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.HoloKeyboard = HoloKeyboard;
})();
