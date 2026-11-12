// A short message from Jarvis in the bottom left corner of the screen ("Hand control is on"), for things that should not take over the middle of the screen. It is a small see-through window that
// mouse clicks pass straight through, on every desktop, shown without taking focus, and it goes away by itself. Electron's pieces are passed in so all of it is tested.

const HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:-apple-system,system-ui,sans-serif}
#n{position:absolute;left:6px;bottom:6px;right:6px;box-sizing:border-box;padding:10px 14px 10px 12px;border-radius:16px;display:flex;gap:10px;align-items:center;
 color:#e9f8ff;font-size:13px;line-height:1.35;background:rgba(14,20,36,.86);border:1px solid rgba(110,231,255,.45);box-shadow:0 6px 22px rgba(0,0,0,.35),0 0 14px rgba(110,231,255,.25);
 backdrop-filter:blur(10px);opacity:0;transform:translateY(8px);transition:opacity .18s ease-out,transform .18s ease-out}
#n.on{opacity:1;transform:none}
#o{flex:none;width:12px;height:12px;border-radius:50%;background:#6ee7ff;box-shadow:0 0 10px #6ee7ff}
#n.bad #o{background:#fca5a5;box-shadow:0 0 10px #fca5a5}
</style><div id="n"><div id="o"></div><div id="t"></div></div><script>
function say(text,bad){const n=document.getElementById('n');document.getElementById('t').textContent=text;n.className=bad?'bad':'';void n.offsetWidth;n.className=(bad?'bad ':'')+'on'}
</script>`;

class CornerNote {
  // BrowserWindow, screen: from Electron. The timers are replaceable for tests.
  constructor({ BrowserWindow, screen, setLater = setTimeout, clearLater = clearTimeout, width = 360, height = 92, margin = 14 }) {
    Object.assign(this, { BrowserWindow, screen, setLater, clearLater, width, height, margin });
    this.win = null; this.ready = false; this.pending = null; this.later = null;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = this.win = new this.BrowserWindow({
      width: this.width, height: this.height, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true, type: 'panel',
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

  paint(text, bad) {
    if (!this.ready) { this.pending = [text, bad]; return; }
    try { Promise.resolve(this.win.webContents.executeJavaScript(`say(${JSON.stringify(String(text))},${bad ? 'true' : 'false'})`)).catch(() => {}); } catch { /* the window is going away */ }
  }

  // The corner of the screen the pointer is on (below the menu bar and above the Dock, so work area).
  place(win) {
    const wa = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
    win.setPosition(Math.round(wa.x + this.margin), Math.round(wa.y + wa.height - this.height - this.margin), false);
  }

  show(text, ms = 4500, { bad = false } = {}) {
    if (!text) return;
    const win = this.ensure();
    this.place(win);
    this.paint(text, bad);
    if (!win.isVisible()) win.showInactive();
    this.clearLater(this.later);
    this.later = this.setLater(() => this.hide(), ms);
    this.later && this.later.unref && this.later.unref();
  }

  hide() {
    this.clearLater(this.later); this.later = null;
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  close() {
    this.clearLater(this.later); this.later = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null; this.ready = false;
  }
}

module.exports = { CornerNote };
