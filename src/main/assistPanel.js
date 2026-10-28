// The private answer window: a small black-glass panel at the top right that shows answers while you are in a meeting. It is kept out of screen sharing and
// recordings (Electron's content protection, which asks macOS not to include the window in any capture), never takes the keyboard or the mouse (clicks go
// through it), and is not in Mission Control. electron is passed in so this can be tested.

const path = require('path');

const WIDTH = 408;
const HEIGHT = 440;

class AssistPanel {
  // getHidden(): the Settings switch "Hide the answer window from screen sharing" (on unless turned off)
  constructor({ preload, electron = require('electron'), getHidden = () => true, page = path.join(__dirname, '../renderer/assist.html') }) {
    Object.assign(this, { preload, electron, getHidden, page });
    this.win = null;
    this.ready = null;
    this.shown = false;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const { BrowserWindow } = this.electron;
    this.win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, type: 'panel',
      webPreferences: { preload: this.preload, contextIsolation: true }
    });
    this.win.setIgnoreMouseEvents(true); // clicks go to what is behind it
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setHiddenInMissionControl?.(true);
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.protect();
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.win.loadFile(this.page);
    this.win.on('closed', () => { this.win = null; this.shown = false; });
    return this.win;
  }

  // Always applied before the window is shown, and again when the switch changes.
  protect() {
    if (this.win && !this.win.isDestroyed()) this.win.setContentProtection(!!this.getHidden());
  }

  place() {
    const { screen } = this.electron;
    const d = screen.getPrimaryDisplay();
    const wa = d.workArea;
    this.win.setBounds({ x: wa.x + wa.width - WIDTH - 8, y: wa.y + 6, width: WIDTH, height: HEIGHT });
  }

  async send(kind, payload) {
    const win = this.ensure();
    await this.ready;
    this.protect();
    if (!this.shown) { this.place(); win.showInactive(); this.shown = true; }
    win.webContents.send('assist:state', kind, payload);
  }

  update(state) { return this.send('answer', state); }
  status(text) { return this.send('status', { text }); }

  // "Test the private window": shows a big word. If it shows up in a screen share or a recording, the window is not hidden on this Mac.
  async test() {
    await this.send('test', { hidden: !!this.getHidden() });
  }

  hide() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('assist:state', 'clear', {});
    setTimeout(() => { if (this.win && !this.win.isDestroyed()) { this.win.hide(); this.shown = false; } }, 350);
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.shown = false;
  }
}

module.exports = { AssistPanel, WIDTH, HEIGHT };
