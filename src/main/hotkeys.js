const { ShortcutMatcher } = require('./shortcuts');

// Adapter between uiohook-napi (global key events) and the pure ShortcutMatcher.
function buildCodeMap(UiohookKey) {
  const sideNames = { Alt: 'AltLeft', AltRight: 'AltRight', Ctrl: 'ControlLeft', CtrlRight: 'ControlRight', Shift: 'ShiftLeft', ShiftRight: 'ShiftRight', Meta: 'MetaLeft', MetaRight: 'MetaRight' };
  const map = new Map();
  for (const [name, code] of Object.entries(UiohookKey)) {
    let dom = sideNames[name];
    if (!dom) {
      if (/^[A-Z]$/.test(name)) dom = 'Key' + name;
      else if (/^[0-9]$/.test(name)) dom = 'Digit' + name;
      else dom = name; // F1, Space, Tab, Enter, Escape, Backspace, Arrow*
    }
    if (!map.has(code)) map.set(code, dom);
  }
  return map;
}

class Hotkeys {
  constructor({ getShortcuts, onEvent, onClick = null, log = console }) {
    this.getShortcuts = getShortcuts;
    this.onClick = onClick;
    this.onEvent = onEvent;
    this.log = log;
    this.running = false;
    this.error = null;
    this.eventsSeen = 0; // stays 0 when Input Monitoring is off, even though the hook starts
  }

  start() {
    if (this.running) return true;
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      const codes = buildCodeMap(UiohookKey);
      this.matcher = new ShortcutMatcher({ getShortcuts: this.getShortcuts, emit: this.onEvent });
      uIOhook.on('keydown', (e) => {
        this.eventsSeen++;
        const c = codes.get(e.keycode);
        if (c) this.matcher.handle('down', c);
      });
      uIOhook.on('keyup', (e) => {
        const c = codes.get(e.keycode);
        if (c) this.matcher.handle('up', c);
      });
      uIOhook.on('mouseup', () => {
        if (this.onClick) this.onClick();
      });
      uIOhook.start();
      this.uIOhook = uIOhook;
      this.running = true;
      this.error = null;
    } catch (e) {
      this.error = e.message;
      this.log.error('Global hotkeys unavailable:', e.message);
    }
    return this.running;
  }

  stop() {
    try {
      this.uIOhook?.stop();
    } catch {}
    this.running = false;
  }
}

module.exports = { Hotkeys, buildCodeMap };
