// A small badge that follows the mouse pointer to show what the camera sees of the two-finger swipe: a glowing peace sign when it sees your two fingers up ("ready"), a tightening ring when they point at the
// camera ("now turn"), a grey one when it sees them but you are not recognised ("not you"), and an arrow for the desktop it is moving to. It is a tiny see-through window that the mouse clicks pass straight
// through, on every desktop, and it only exists on screen while there is something to show. Electron's pieces are passed in so all of it is tested.

const HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:-apple-system,system-ui,sans-serif}
#b{position:absolute;left:4px;top:4px;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;
 background:rgba(20,24,40,.72);border:2px solid #6ee7ff;box-shadow:0 0 14px rgba(110,231,255,.65);transition:all .12s ease-out;backdrop-filter:blur(6px)}
#b.turn{border-color:#a78bfa;box-shadow:0 0 18px rgba(167,139,250,.8);transform:scale(.86)}
#b.blocked{border-color:#9ca3af;box-shadow:none;opacity:.65;filter:grayscale(1)}
#b.go{border-color:#86efac;box-shadow:0 0 20px rgba(134,239,172,.85);font-size:28px;transform:scale(1.08)}
#b.pulse{animation:p 1s ease-in-out infinite}@keyframes p{50%{box-shadow:0 0 22px rgba(110,231,255,.95)}}
</style><div id="b">✌️</div><script>
function set(cls,txt){const b=document.getElementById('b');b.className=cls;b.textContent=txt}
</script>`;

const LOOK = { ready: ['pulse', '✌️'], turn: ['turn', '👉'], blocked: ['blocked', '✌️'], fist: ['pulse', '✊'] };

class CursorBadge {
  // BrowserWindow, screen: from Electron. enabled(): is the hint wanted. The timers are replaceable for tests.
  constructor({ BrowserWindow, screen, enabled = () => true, setTimer = setInterval, clearTimer = clearInterval, setLater = setTimeout, clearLater = clearTimeout, offset = 22 }) {
    Object.assign(this, { BrowserWindow, screen, enabled, setTimer, clearTimer, setLater, clearLater, offset });
    this.win = null; this.ready = false; this.pending = null; this.timer = null; this.later = null; this.state = 'hidden'; this.flashing = false;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = this.win = new this.BrowserWindow({
      width: 56, height: 56, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { contextIsolation: true, backgroundThrottling: false }
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.ready = false;
    win.webContents.once('did-finish-load', () => { this.ready = true; if (this.pending) { const p = this.pending; this.pending = null; this.paint(p[0], p[1]); } });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
    return win;
  }

  paint(cls, txt) {
    if (!this.ready) { this.pending = [cls, txt]; return; }
    try { Promise.resolve(this.win.webContents.executeJavaScript(`set(${JSON.stringify(cls)},${JSON.stringify(txt)})`)).catch(() => {}); } catch { /* the window is going away */ }
  }

  follow() {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const p = this.screen.getCursorScreenPoint();
    w.setPosition(Math.round(p.x + this.offset), Math.round(p.y + this.offset), false);
  }

  // state: 'ready' | 'turn' | 'blocked'. Ignored while an arrow is being flashed.
  show(state) {
    if (!this.enabled() || !LOOK[state] || this.flashing) return;
    const win = this.ensure();
    this.state = state;
    this.paint(...LOOK[state]);
    this.follow();
    if (!win.isVisible()) win.showInactive();
    if (!this.timer) this.timer = this.setTimer(() => this.follow(), 16);
  }

  // The swipe happened: an arrow toward the desktop that is coming, for a moment.
  flash(name, ms = 650) { this.note(name === 'left' ? '◀' : '▶', ms); }

  // Any short confirmation in the badge (the arrow above, or a raised hand when hand control turns on).
  note(text, ms = 900) {
    if (!this.enabled()) return;
    const win = this.ensure();
    this.flashing = true; this.state = 'flash';
    this.paint('go', text);
    this.follow();
    if (!win.isVisible()) win.showInactive();
    if (!this.timer) this.timer = this.setTimer(() => this.follow(), 16);
    this.clearLater(this.later);
    this.later = this.setLater(() => { this.flashing = false; this.hide(); }, ms);
    this.later && this.later.unref && this.later.unref();
  }

  hide() {
    if (this.flashing) return;
    this.state = 'hidden';
    this.clearTimer(this.timer); this.timer = null;
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  close() {
    this.clearTimer(this.timer); this.timer = null; this.clearLater(this.later); this.flashing = false;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null; this.ready = false;
  }
}

module.exports = { CursorBadge };
