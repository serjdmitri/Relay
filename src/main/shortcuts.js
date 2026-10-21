// Pure state machine that turns raw key events into Ask/Type shortcut events.
// Raw events come from uiohook (see hotkeys.js); keys use DOM KeyboardEvent.code names.

const MODIFIERS = new Set([
  'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'
]);
const MOD_GROUP = {
  Alt: ['AltLeft', 'AltRight'],
  Control: ['ControlLeft', 'ControlRight'],
  Shift: ['ShiftLeft', 'ShiftRight'],
  Meta: ['MetaLeft', 'MetaRight']
};

const HOLD_MS = 250;
const TAP_MAX_MS = 350;

class ShortcutMatcher {
  constructor({ getShortcuts, emit, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
    this.getShortcuts = getShortcuts;
    this.emit = emit;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.down = new Set();
    this.modState = null; // state of an in-flight modifier-only shortcut
  }

  isModDown(group) {
    return MOD_GROUP[group].some((c) => this.down.has(c));
  }

  handle(type, code) {
    const { ask, type: typeSc } = this.getShortcuts();
    if (type === 'down') {
      if (this.down.has(code)) return; // key repeat
      this.down.add(code);
      this._onDown(code, { ask, type: typeSc });
    } else {
      this.down.delete(code);
      this._onUp(code, { ask, type: typeSc });
    }
  }

  _onDown(code, sc) {
    // any other key cancels an in-flight modifier-only press (it was a combo, not a tap)
    if (this.modState && code !== this.modState.code) this._cancelMod();

    for (const [name, def] of Object.entries(sc)) {
      if (!def) continue;
      const modOnly = MODIFIERS.has(def.code) && def.mods.length === 0;
      if (modOnly && def.code === code) {
        this.modState = { name, code, t0: this.now(), held: false, timer: null };
        this.modState.timer = this.setTimer(() => {
          if (this.modState && this.modState.code === code) {
            this.modState.held = true;
            this.emit(name, 'hold-start');
          }
        }, HOLD_MS);
      } else if (!modOnly && def.code === code && def.mods.every((m) => this.isModDown(m))) {
        this.emit(name, 'press');
      }
    }
  }

  _onUp(code) {
    const s = this.modState;
    if (!s || s.code !== code) return;
    this.clearTimer(s.timer);
    this.modState = null;
    const heldMs = this.now() - s.t0;
    if (s.held) this.emit(s.name, 'hold-end', { heldMs });
    else if (heldMs <= TAP_MAX_MS) this.emit(s.name, 'tap', { heldMs });
  }

  _cancelMod() {
    if (!this.modState) return;
    this.clearTimer(this.modState.timer);
    this.modState = null;
  }
}

function label(def) {
  const sym = { Alt: '⌥', Control: '⌃', Shift: '⇧', Meta: '⌘' };
  const key = (c) => {
    if (c.startsWith('Alt')) return c === 'AltRight' ? 'Right ⌥' : 'Left ⌥';
    if (c.startsWith('Control')) return c === 'ControlRight' ? 'Right ⌃' : 'Left ⌃';
    if (c.startsWith('Shift')) return c === 'ShiftRight' ? 'Right ⇧' : 'Left ⇧';
    if (c.startsWith('Meta')) return c === 'MetaRight' ? 'Right ⌘' : 'Left ⌘';
    if (c.startsWith('Key')) return c.slice(3);
    if (c.startsWith('Digit')) return c.slice(5);
    return c;
  };
  return def.mods.map((m) => sym[m]).join('') + key(def.code);
}

module.exports = { ShortcutMatcher, MODIFIERS, label, HOLD_MS, TAP_MAX_MS };
