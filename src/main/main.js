const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./store');
const { Hotkeys } = require('./hotkeys');
const { label } = require('./shortcuts');
const { FirefoxBridge } = require('./firefoxBridge');
const { Overlay } = require('./overlay');
const { AskController, encryptKey, decryptKey } = require('./askController');
const perms = require('./permissions');
const { AnthropicProvider } = require('./agent/providers/anthropic');
const { OllamaProvider } = require('./agent/providers/ollama');

app.setName('Relay');
if (!app.requestSingleInstanceLock()) app.quit();

let store, bridge, overlay, ask, hotkeys, tray;
let mainWin = null;
let onboardWin = null;
let quitting = false;

const DEFAULT_SHORTCUTS = { ask: { code: 'AltRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } };

function windowOpts(w, h) {
  return {
    width: w, height: h, minWidth: w, minHeight: Math.min(h, 520), show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: '#2b2b2b',
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  };
}

function openMain(page) {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = new BrowserWindow(windowOpts(820, 620));
    mainWin.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { page: page || 'home' } });
    mainWin.once('ready-to-show', () => mainWin.show());
    mainWin.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        mainWin.hide();
      }
    });
  } else {
    mainWin.show();
    mainWin.focus();
    if (page) mainWin.webContents.send('navigate', page);
  }
  app.dock?.show();
}

function openOnboarding() {
  if (onboardWin && !onboardWin.isDestroyed()) return onboardWin.show();
  onboardWin = new BrowserWindow({ ...windowOpts(720, 560), minHeight: 560, resizable: false, maximizable: false });
  onboardWin.loadFile(path.join(__dirname, '../renderer/onboarding.html'));
  onboardWin.once('ready-to-show', () => onboardWin.show());
  onboardWin.on('closed', () => (onboardWin = null));
}

function broadcast() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('state-changed');
  rebuildTray();
}

function publicState() {
  const d = JSON.parse(JSON.stringify(store.data));
  const hasKey = !!decryptKey(d.settings.model.anthropicKeyEnc);
  delete d.settings.model.anthropicKeyEnc;
  return {
    ...d,
    hasKey,
    history: d.history.slice(0, 200),
    actions: d.actions.slice(0, 300),
    stats: store.stats(),
    labels: { ask: label(d.settings.shortcuts.ask), type: label(d.settings.shortcuts.type) },
    firefoxConnected: bridge.isConnected(),
    hotkeysRunning: hotkeys.running,
    hotkeysError: hotkeys.error,
    version: app.getVersion(),
    extensionPath: extensionPath()
  };
}

function extensionPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'firefox-extension') : path.join(__dirname, '../../extension/firefox');
}

function rebuildTray() {
  if (!tray) return;
  const askLabel = label(store.get('settings.shortcuts.ask'));
  const last = store.get('lastReply');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: hotkeys.running ? `Ready · ${askLabel} to ask` : 'Shortcuts off (see Permissions)', enabled: false },
    { label: 'Ask Relay…', click: () => ask.open() },
    { label: 'Copy Last Reply', enabled: !!last, click: () => clipboard.writeText(last) },
    { label: last ? `Last: ${last.length > 48 ? last.slice(0, 48) + '…' : last}` : 'Last: nothing yet', enabled: false },
    { type: 'separator' },
    { label: 'Open Relay', click: () => openMain('home') },
    { label: 'Settings…', accelerator: 'Cmd+,', click: () => openMain('general') },
    { label: 'Welcome Guide…', click: () => openOnboarding() },
    { label: 'About Relay', click: () => app.showAboutPanel() },
    { type: 'separator' },
    { label: 'Quit Relay', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }
  ]));
}

function applyDockAndLogin() {
  const s = store.get('settings');
  if (process.platform === 'darwin') {
    if (s.showInDock) app.dock.show();
    else app.dock.hide();
    app.setLoginItemSettings({ openAtLogin: !!s.openAtLogin });
  }
}

function startHotkeysWhenTrusted() {
  if (hotkeys.running) return;
  const trusted = process.platform !== 'darwin' || perms.status().accessibility;
  if (trusted && hotkeys.start()) {
    broadcast();
    return;
  }
  setTimeout(startHotkeysWhenTrusted, 2000);
}

function registerIpc() {
  ipcMain.handle('state:get', () => publicState());
  ipcMain.handle('state:set', (_e, key, value) => {
    if (!key.startsWith('settings.')) throw new Error('Only settings can be set this way.');
    store.set(key, value);
    applyDockAndLogin();
    if (key === 'settings.firefox.enabled' || key === 'settings.firefox.port') startBridge();
    broadcast();
  });
  ipcMain.handle('model:set-key', (_e, key) => {
    store.set('settings.model.anthropicKeyEnc', encryptKey(String(key || '').trim()));
    broadcast();
  });
  ipcMain.handle('model:test', async () => {
    const m = store.get('settings.model');
    const provider = m.provider === 'ollama'
      ? new OllamaProvider({ url: m.ollamaUrl, model: m.ollamaModel })
      : new AnthropicProvider({ apiKey: decryptKey(m.anthropicKeyEnc), model: m.anthropicModel, maxTokens: 16 });
    try {
      const r = await provider.step({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], tools: [] });
      return { ok: true, text: r.text.slice(0, 40) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('perm:status', () => perms.status());
  ipcMain.handle('perm:request-accessibility', () => perms.requestAccessibility());
  ipcMain.handle('perm:open-pane', (_e, name) => perms.openPane(name));
  ipcMain.handle('perm:test-automation', async (_e, appName) => {
    // Running any AppleScript against the app triggers (or reports) the Automation prompt.
    try {
      await ask.mac.osa(`tell application ${JSON.stringify(appName)} to get name`);
      return { ok: true };
    } catch (e) {
      const denied = /-1743|not authorized|not allowed/i.test(e.message);
      return { ok: false, denied, error: e.message };
    }
  });

  ipcMain.handle('routine:save', (_e, r) => {
    const list = store.get('routines');
    const clean = { id: r.id || crypto.randomUUID(), name: String(r.name).trim(), steps: (r.steps || []).map((s) => String(s).trim()).filter(Boolean) };
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    store.save();
    broadcast();
  });
  ipcMain.handle('routine:delete', (_e, id) => {
    store.data.routines = store.data.routines.filter((r) => r.id !== id);
    store.save();
    broadcast();
  });
  ipcMain.handle('routine:run', async (_e, id) => {
    const r = store.get('routines').find((x) => x.id === id);
    if (!r) return;
    await ask.open();
    await ask.submit(r.name);
  });

  ipcMain.handle('vocab:add', (_e, terms) => {
    const set = new Set(store.get('vocabulary'));
    for (const t of terms) if (t.trim()) set.add(t.trim());
    store.data.vocabulary = [...set];
    store.save();
    broadcast();
  });
  ipcMain.handle('vocab:remove', (_e, t) => {
    store.data.vocabulary = store.get('vocabulary').filter((x) => x !== t);
    store.save();
    broadcast();
  });
  ipcMain.handle('history:clear', () => {
    store.data.history = [];
    store.data.actions = [];
    store.save();
    broadcast();
  });

  ipcMain.handle('shortcut:set', (_e, name, def) => {
    if (!['ask', 'type'].includes(name)) return;
    store.set(`settings.shortcuts.${name}`, def);
    broadcast();
  });
  // While the user is recording a new shortcut, existing ones must not fire.
  ipcMain.handle('shortcut:capturing', (_e, on) => { ask.suspended = !!on; });
  ipcMain.handle('shortcut:reset', () => {
    store.set('settings.shortcuts', JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS)));
    broadcast();
  });

  ipcMain.handle('onboarding:finish', () => {
    store.set('onboardingDone', true);
    onboardWin?.close();
    openMain('home');
    broadcast();
  });
  ipcMain.handle('window:open', (_e, name) => (name === 'onboarding' ? openOnboarding() : openMain(name)));

  ipcMain.handle('firefox:action', (_e, what) => {
    if (what === 'reveal') return shell.showItemInFolder(path.join(extensionPath(), 'manifest.json'));
    if (what === 'debugging') {
      // about: pages cannot be opened with a URL scheme, so ask Firefox directly.
      return ask.mac.openUrl('about:debugging#/runtime/this-firefox').catch(() => require('child_process').execFile('open', ['-a', 'Firefox', 'about:debugging']));
    }
  });

  ipcMain.handle('ask:open', async (_e, text) => {
    await ask.open();
    if (text) await ask.submit(text);
  });
  ipcMain.handle('ask:submit', (_e, text) => ask.submit(text));
  ipcMain.handle('ask:cancel', () => (ask.state === 'working' || ask.state === 'confirm' ? ask.stop() : ask.close()));
  ipcMain.handle('ask:confirm', (_e, yes) => ask.pendingConfirm?.(!!yes));
  ipcMain.handle('ask:resize', (_e, h) => ask.resize(h));
}

function startBridge() {
  bridge.stop();
  const fx = store.get('settings.firefox');
  bridge.port = fx.port;
  if (fx.enabled) bridge.start();
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  bridge = new FirefoxBridge({ port: store.get('settings.firefox.port') });
  bridge.on('status', () => broadcast());
  bridge.on('error', (e) => console.error('Firefox bridge:', e.message));
  overlay = new Overlay({ isEnabled: () => store.get('settings.cursor') });
  ask = new AskController({ store, bridge, overlay, onChange: broadcast });
  hotkeys = new Hotkeys({ getShortcuts: () => store.get('settings.shortcuts'), onEvent: (n, k) => ask.onShortcut(n, k) });

  const iconPath = path.join(__dirname, '../../assets/trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Relay');

  if (process.env.RELAY_E2E) global.__relay = { store, ask, bridge, hotkeys, openMain, openOnboarding };
  registerIpc();
  startBridge();
  applyDockAndLogin();
  rebuildTray();
  startHotkeysWhenTrusted();

  if (store.get('onboardingDone')) openMain('home');
  else openOnboarding();
});

app.on('second-instance', () => openMain('home'));
app.on('activate', () => openMain('home'));
app.on('window-all-closed', (e) => e.preventDefault()); // keep running in the menu bar
app.on('before-quit', () => {
  quitting = true;
  hotkeys?.stop();
  bridge?.stop();
  store?.flush();
});
