const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// The "this is not your computer" screen. One borderless window per display, each a blurred, red-tinted view of what is behind it with the alarm page on top.
// main.js decides when to show and hide it (see ownerGuard.js); the pages ask for the state, so they cannot be told anything else by anyone else.
class IntruderWindow {
  // touchId(): is Touch ID available? fingerprint(): asks for it and, if it is you, stops the alarm (main.js); it throws when the fingerprint is not accepted.
  // autoDelayMs: how long after the alarm starts the Touch ID sheet comes up by itself, so just touching the sensor stops it (no button to click first).
  constructor({ touchId = () => false, fingerprint = async () => ({ ok: false }), autoDelayMs = 900 } = {}) {
    Object.assign(this, { touchId, fingerprint, autoDelayMs });
    this.wins = [];
    this.state = { active: false };
    ipcMain.handle('intruder:fingerprint', async (e) => {
      if (!this.state.active || !this.wins.some((w) => !w.isDestroyed() && w.webContents === e.sender)) return { ok: false };
      return this.askFingerprint();
    });
    ipcMain.handle('intruder:state', (e) => (this.wins.some((w) => !w.isDestroyed() && w.webContents === e.sender) ? this.state : { active: false }));
  }

  // Asks for the fingerprint. The alarm windows step aside while the system sheet is up and come back if it is not accepted. -> { ok, error? }
  async askFingerprint() {
    if (this.busy || !this.state.active) return { ok: false };
    this.busy = true; this.hold();
    try { const r = await this.fingerprint(); if (!r?.ok) this.release(); return { ok: !!r?.ok }; }
    catch (err) { this.release(); return { ok: false, error: String(err?.message || 'Not recognised.').slice(0, 90) }; }
    finally { this.busy = false; }
  }

  show({ seconds, demo = false }) {
    this.state = { active: true, touchId: this.touchId(), mode: 'alarm', endsAt: Date.now() + seconds * 1000, total: seconds, demo };
    this.open();
    // The alarm is the moment the owner needs Touch ID, so the sheet comes up on its own (once). If it is cancelled or not accepted the alarm comes back with its button.
    clearTimeout(this.autoTimer);
    if (this.state.touchId) {
      this.autoTimer = setTimeout(() => { if (this.state.active && this.state.mode === 'alarm' && !this.state.paused) this.askFingerprint().catch(() => {}); }, this.autoDelayMs);
      this.autoTimer.unref?.();
    }
  }

  // The standby screen: you stepped away. Calm, blue, no siren; it stays until main.js hides it.
  showAway() {
    if (this.state.active && this.state.mode === 'alarm') return;
    this.state = { active: true, touchId: this.touchId(), mode: 'away', since: Date.now() };
    this.open();
  }

  // While the system's Touch ID sheet is up, the alarm windows step aside (and the siren stops), so the sheet is not hidden behind them; they come back if it fails.
  hold() { this.state = { ...this.state, paused: true }; for (const w of this.wins) { try { if (!w.isDestroyed()) w.hide(); } catch { /* gone */ } } }
  release() { if (!this.state.active) return; this.state = { ...this.state, paused: false }; for (const w of this.wins) { try { if (!w.isDestroyed()) w.showInactive(); } catch { /* gone */ } } }

  open() {
    if (this.wins.some((w) => !w.isDestroyed())) return;
    this.wins = screen.getAllDisplays().map((d) => {
      const { x, y, width, height } = d.bounds;
      const win = new BrowserWindow({
        x, y, width, height, enableLargerThanScreen: true, acceptFirstMouse: true, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false, show: false, skipTaskbar: true, focusable: false, type: 'panel',
        vibrancy: 'hud', visualEffectState: 'active',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
      });
      win.setBounds({ x, y, width, height }); // macOS keeps a new window below the menu bar unless the bounds are set again with enableLargerThanScreen
      win.setAlwaysOnTop(true, 'screen-saver', 2); win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); win.setHiddenInMissionControl?.(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e) => e.preventDefault());
      win.loadFile(path.join(__dirname, '../renderer/intruder.html'));
      win.once('ready-to-show', () => win.showInactive());
      return win;
    });
  }

  hide() {
    clearTimeout(this.autoTimer);
    this.state = { active: false };
    for (const w of this.wins) { try { if (!w.isDestroyed()) w.close(); } catch { /* gone */ } }
    this.wins = [];
  }
}
module.exports = { IntruderWindow };
