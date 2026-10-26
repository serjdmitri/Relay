const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, systemPreferences, Notification, nativeTheme } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./store');
const { Hotkeys } = require('./hotkeys');
const { label } = require('./shortcuts');
const { FirefoxBridge } = require('./firefoxBridge');
const { Overlay } = require('./overlay');
const { AskController, encryptKey, decryptKey, compatProvider } = require('./askController');
const { Speech } = require('./speech');
const { Speaker } = require('./voice');
const { KokoroVoice } = require('./tts/kokoro');
const { Timers, humanDuration } = require('./timers');
const { Glass } = require('./glass');
const { RecentPanel } = require('./recent');
const { CardPanel } = require('./cards/panel');
const { NotionApi } = require('./connectors/notion');
const { connectAccount: connectGoogle } = require('./connectors/google');
const { Scheduler, describe: describeSchedule, parseScheduleCommand } = require('./schedule');
const perms = require('./permissions');
const { AnthropicProvider } = require('./agent/providers/anthropic');
const { OllamaProvider } = require('./agent/providers/ollama');
const { PRESETS, isPreset } = require('./agent/providers/presets');
const claudeCli = require('./agent/claudeCli');

app.setName('Relay');
if (!app.requestSingleInstanceLock()) app.quit();

let store, bridge, overlay, ask, hotkeys, tray, speech, speaker, timers, glass, kokoro, recent, cardPanel;
let voiceProblem = ''; // why the chosen voice could not speak the last reply, if it could not
let claudeState = { installed: false, loggedIn: false, checked: false };
let speechInfo = { device: null, preparing: null, prepared: false, error: null };
let mainWin = null;
let onboardWin = null;
let quitting = false;

const DEFAULT_SHORTCUTS = { ask: { code: 'AltRight', mods: [] }, dictate: { code: 'MetaRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] }, mark: { code: 'ControlLeft', mods: [] } };

function windowOpts(w, h) {
  return {
    width: w, height: h, minWidth: w, minHeight: Math.min(h, 520), show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d131a' : '#f6f7f9',
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  };
}

function openMain(page) {
  if (!mainWin || mainWin.isDestroyed()) {
    // vibrancy gives the sidebar the native macOS sidebar material, and follows the system's light or dark
    mainWin = new BrowserWindow({ ...windowOpts(820, 620), vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' });
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
  if (store.get('settings.showInDock')) app.dock?.show();
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
  const hasTtsKeys = {};
  for (const id of ['openai', 'elevenlabs']) {
    hasTtsKeys[id] = !!decryptKey(d.settings.tts[id].keyEnc);
    delete d.settings.tts[id].keyEnc;
  }
  const cn = d.settings.connectors || {};
  const connectors = { notion: { connected: !!decryptKey(cn.notion?.tokenEnc), name: cn.notion?.name || '' }, google: { clientId: cn.google?.clientId || '', hasSecret: !!decryptKey(cn.google?.clientSecretEnc), accounts: (cn.google?.accounts || []).map((a) => a.email) } };
  delete d.settings.connectors;
  const hasKeys = {};
  for (const [id, s] of Object.entries(d.settings.model.presets)) {
    hasKeys[id] = !!decryptKey(s.keyEnc);
    delete s.keyEnc;
  }
  return {
    ...d,
    connectors,
    schedules: (d.schedules || []).map((s) => ({ ...s, when: describeSchedule(s) })),
    hasKey,
    hasKeys,
    hasTtsKeys,
    voiceProblem,
    kokoro: kokoro.status(),
    presetInfo: PRESETS,
    history: d.history.slice(0, 200),
    actions: d.actions.slice(0, 300),
    stats: store.stats(),
    labels: { ask: label(d.settings.shortcuts.ask), dictate: label(d.settings.shortcuts.dictate), type: label(d.settings.shortcuts.type), mark: label(d.settings.shortcuts.mark) },
    claude: claudeState,
    speech: { available: speech.available, ...speechInfo },
    dictations: d.dictations.slice(0, 200),
    firefoxConnected: bridge.isConnected(),
    hotkeysRunning: hotkeys.running,
    hotkeysSeen: hotkeys.eventsSeen > 0,
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
    { label: 'Type a Request…', click: () => ask.open() },
    { label: ask.agents.running().length ? `Stop ${ask.agents.running().length} Background Agent${ask.agents.running().length === 1 ? '' : 's'}` : 'No Background Agents', enabled: ask.agents.running().length > 0, click: () => ask.agents.stop() },
    { label: 'Stop Speaking', enabled: !!speaker?.speaking, click: () => ask.interruptSpeech() },
    { label: 'Copy Last Reply', enabled: !!last, click: () => clipboard.writeText(last) },
    { label: last ? `Last: ${last.length > 48 ? last.slice(0, 48) + '…' : last}` : 'Last: nothing yet', enabled: false },
    { type: 'separator' },
    { label: 'Listen for “Hey Jarvis”', type: 'checkbox', checked: !!store.get('settings.wake.enabled'), click: (item) => { store.set('settings.wake.enabled', item.checked); ask.wake.refresh(); broadcast(); rebuildTray(); } },
    { label: 'Recent asks on the left edge', type: 'checkbox', checked: store.get('settings.recent') !== false, click: (item) => { store.set('settings.recent', item.checked); broadcast(); rebuildTray(); } },
    ...(store.get('settings.model.provider') === 'claude' ? [{ label: 'Model Speed', submenu: [['auto', 'Auto'], ['haiku', 'Fast (Haiku)'], ['sonnet', 'Smart (Sonnet)'], ['opus', 'Deep (Opus)']].map(([v, l]) => ({ label: l, type: 'radio', checked: store.get('settings.model.claudeModel') === v, click: () => { store.set('settings.model.claudeModel', v); broadcast(); } })) }] : []),
    { label: 'Show the cursor buddy', type: 'checkbox', checked: store.get('settings.buddy') !== false, click: (item) => { store.set('settings.buddy', item.checked); overlay.applyMode(); broadcast(); rebuildTray(); } },
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

async function refreshClaude() {
  const claudePath = await claudeCli.findClaude();
  claudeState = { ...(await claudeCli.authStatus(claudePath)), path: claudePath || '', checked: true };
}

function glassBinPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'native', 'relay-glass') : path.join(__dirname, '../../native/build/relay-glass');
}

function axBinPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'native', 'relay-ax') : path.join(__dirname, '../../native/build/relay-ax');
}

function speechBinPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'native', 'relay-speech') : path.join(__dirname, '../../native/build/relay-speech');
}

// Loads the on-device speech model so the first dictation starts instantly.
async function prepareSpeech() {
  if (!speech.available) {
    speechInfo = { ...speechInfo, error: 'The dictation helper is missing. Rebuild Relay with npm run pack.' };
    return;
  }
  speechInfo = { ...speechInfo, prepared: false, error: null };
  try {
    speechInfo.device = await speech.inputDevice(store.get('settings.speech.input'));
    await speech.prepare(store.get('settings.speech.locale'), [...store.get('vocabulary'), ...(store.get('replacements') || []).map((r) => r.to)]);
    speechInfo = { ...speechInfo, prepared: true, preparing: null, error: null };
  } catch (e) {
    speechInfo = { ...speechInfo, preparing: null, error: e.message };
  }
  broadcast();
}

// New vocabulary or word fixes: teach the recognizer once you stop editing.
function schedulePrepareSpeech() {
  clearTimeout(prepareTimer);
  prepareTimer = setTimeout(() => prepareSpeech(), 2000);
}

function registerIpc() {
  ipcMain.handle('state:get', () => publicState());
  ipcMain.handle('state:set', (_e, key, value) => {
    if (!key.startsWith('settings.')) throw new Error('Only settings can be set this way.');
    store.set(key, value);
    applyDockAndLogin();
    if (key === 'settings.buddy' || key === 'settings.cursor') { overlay.applyMode(); rebuildTray(); }
    if (key === 'settings.wake.enabled' || key === 'settings.wake.phrase') { ask.wake.refresh(); ask.wake.disarm(); ask.wake.refresh(); rebuildTray(); }
    if (key === 'settings.firefox.enabled' || key === 'settings.firefox.port') startBridge();
    broadcast();
  });
  ipcMain.handle('model:set-key', (_e, key) => {
    store.set('settings.model.anthropicKeyEnc', encryptKey(String(key || '').trim()));
    broadcast();
  });
  ipcMain.handle('model:set-preset-key', (_e, id, key) => {
    if (!isPreset(id)) return;
    store.set(`settings.model.presets.${id}.keyEnc`, encryptKey(String(key || '').trim()));
    broadcast();
  });
  ipcMain.handle('model:test', async () => {
    const m = store.get('settings.model');
    try {
      if (m.provider === 'claude') {
        const claudePath = await claudeCli.findClaude();
        if (!claudePath) return { ok: false, error: 'Claude Code is not installed.' };
        await ask.mcp.start();
        const r = await claudeCli.runClaude({ text: 'ping', system: 'Reply with the single word OK.', tools: [], confirm: async () => false, host: ask.mcp, claudePath, model: m.claudeModel === 'auto' ? 'haiku' : m.claudeModel });
        return r.status === 'done' ? { ok: true, text: r.reply.slice(0, 40) } : { ok: false, error: r.reply };
      }
      const provider = isPreset(m.provider)
        ? compatProvider(m).provider
        : m.provider === 'ollama'
        ? new OllamaProvider({ url: m.ollamaUrl, model: m.ollamaModel })
        : new AnthropicProvider({ apiKey: decryptKey(m.anthropicKeyEnc), model: m.anthropicModel, maxTokens: 16 });
      const r = await provider.step({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], tools: [] });
      return { ok: true, text: r.text.slice(0, 40) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('claude:status', async () => {
    await refreshClaude();
    broadcast();
    return claudeState;
  });
  ipcMain.handle('claude:login', async () => {
    const claudePath = await claudeCli.findClaude();
    if (!claudePath) return { ok: false, error: 'Claude Code is not installed.' };
    const r = await claudeCli.login(claudePath);
    await refreshClaude();
    if (r.ok && claudeState.loggedIn) store.set('settings.model.provider', 'claude');
    broadcast();
    return { ...r, ok: r.ok && claudeState.loggedIn };
  });
  ipcMain.handle('claude:cancel-login', () => claudeCli.login.current?.kill());
  ipcMain.handle('claude:logout', async () => {
    const claudePath = await claudeCli.findClaude();
    if (claudePath) await claudeCli.logout(claudePath);
    await refreshClaude();
    broadcast();
  });
  ipcMain.handle('speech:request-mic', async () => {
    const ok = await systemPreferences.askForMediaAccess('microphone');
    broadcast();
    return ok;
  });
  ipcMain.handle('app:icons', async () => {
    const paths = { Notes: '/System/Applications/Notes.app', Reminders: '/System/Applications/Reminders.app', Messages: '/System/Applications/Messages.app', Calendar: '/System/Applications/Calendar.app', Finder: '/System/Library/CoreServices/Finder.app', Firefox: '/Applications/Firefox.app' };
    const jxa = "ObjC.import('AppKit'); function run(a){ var i=$.NSWorkspace.sharedWorkspace.iconForFile(a[0]); i.setSize($.NSMakeSize(64,64)); var r=$.NSBitmapImageRep.alloc.initWithData(i.TIFFRepresentation); return ObjC.unwrap(r.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({})).base64EncodedStringWithOptions(0)); }";
    const out = {};
    await Promise.all(Object.entries(paths).map(([name, p]) => new Promise((resolve) => {
      require('child_process').execFile('osascript', ['-l', 'JavaScript', '-e', jxa, p], { timeout: 8000 }, (err, stdout) => {
        if (!err && stdout.trim()) out[name] = 'data:image/png;base64,' + stdout.trim();
        resolve();
      });
    })));
    return out;
  });
  ipcMain.handle('voice:list', async () => ({
    voices: (await speaker.voiceList()).filter((v) => v.kind !== 'Novelty' && v.lang.startsWith('en')),
    picked: await speaker.resolve(store.get('settings.voice'))
  }));
  ipcMain.handle('tts:set-key', (_e, engine, key) => {
    if (!['openai', 'elevenlabs'].includes(engine)) return;
    store.set(`settings.tts.${engine}.keyEnc`, encryptKey(String(key || '').trim()));
    voiceProblem = '';
    broadcast();
  });
  ipcMain.handle('tts:test', async () => {
    const r = await speaker.test('Hi, this is how I will sound when I answer you.', { voice: store.get('settings.voice'), rate: store.get('settings.voiceRate') });
    voiceProblem = r.ok ? '' : r.message;
    broadcast();
    return r;
  });
  ipcMain.handle('tts:kokoro-install', async () => {
    try {
      await kokoro.install();
      store.set('settings.tts.engine', 'kokoro');
    } catch (e) {
      voiceProblem = e.message;
    }
    broadcast();
  });
  ipcMain.handle('tts:kokoro-remove', () => {
    kokoro.remove();
    if (store.get('settings.tts.engine') === 'kokoro') store.set('settings.tts.engine', 'system');
    broadcast();
  });
  ipcMain.handle('voice:preview', (_e, voice, rate) => speaker.speak('Hi, this is how I will sound when I answer you.', { voice, rate }));
  ipcMain.handle('app:open-link', (_e, url) => {
    // Only the key and voice pages of the voice providers; nothing a page could choose.
    if (/^https:\/\/(platform\.openai\.com|elevenlabs\.io)\//.test(String(url))) shell.openExternal(String(url));
  });
  ipcMain.handle('voice:open-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.Accessibility-Settings.extension'));
  ipcMain.handle('speech:locales', () => speech.locales().catch(() => []));
  ipcMain.handle('speech:set-locale', async (_e, id) => {
    store.set('settings.speech.locale', id);
    ask.wake.disarm();
    ask.ducker.recover(); // a run that ended while the volume was lowered: put it back
  prepareSpeech().finally(() => ask.wake.refresh()); // a new language: "Hey Jarvis" listens in it once the model is ready
    broadcast();
  });

  ipcMain.handle('perm:status', () => perms.status());
  ipcMain.handle('speech:device', async () => (speechInfo.device = await speech.inputDevice(store.get('settings.speech.input')).catch(() => speechInfo.device)));
  ipcMain.handle('speech:inputs', () => speech.inputDevices(store.get('settings.speech.input')).catch(() => ({ default: null, using: null, list: [] })));
  ipcMain.handle('speech:set-input', async (_e, pref) => {
    store.set('settings.speech.input', pref);
    speechInfo.device = await speech.inputDevice(pref).catch(() => speechInfo.device);
    broadcast();
  });
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

  ipcMain.handle('replace:add', (_e, from, to) => {
    from = String(from || '').trim();
    to = String(to ?? '').trim();
    if (!from || from.toLowerCase() === to.toLowerCase()) return;
    const list = (store.data.replacements || []).filter((r) => r.from.toLowerCase() !== from.toLowerCase());
    list.unshift({ id: crypto.randomUUID(), from, to });
    store.data.replacements = list;
    store.save();
    schedulePrepareSpeech();
    broadcast();
  });
  ipcMain.handle('replace:remove', (_e, id) => {
    store.data.replacements = (store.data.replacements || []).filter((r) => r.id !== id);
    store.save();
    schedulePrepareSpeech();
    broadcast();
  });
  ipcMain.handle('apps:running', () => ask.mac.listApps().catch(() => []));
  ipcMain.handle('vocab:add', (_e, terms) => {
    const set = new Set(store.get('vocabulary'));
    for (const t of terms) if (t.trim()) set.add(t.trim());
    store.data.vocabulary = [...set];
    store.save();
    schedulePrepareSpeech();
    broadcast();
  });
  // Connectors: Notion token, and Google sign-in (the user's own OAuth app; several accounts).
  ipcMain.handle('connectors:notion:set', async (_e, token) => {
    const t = String(token || '').trim();
    if (!t) return { ok: false, error: 'Paste the integration token first.' };
    try {
      const me = await new NotionApi({ token: t }).me();
      store.set('settings.connectors.notion', { tokenEnc: encryptKey(t), name: me.name });
      broadcast();
      return { ok: true, name: me.name };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('connectors:notion:clear', () => { store.set('settings.connectors.notion', { tokenEnc: '', name: '' }); broadcast(); });
  ipcMain.handle('connectors:google:client', (_e, clientId, secret) => {
    store.set('settings.connectors.google.clientId', String(clientId || '').trim());
    if (String(secret || '').trim()) store.set('settings.connectors.google.clientSecretEnc', encryptKey(String(secret).trim()));
    broadcast();
  });
  ipcMain.handle('connectors:google:connect', async () => {
    const g = store.get('settings.connectors.google');
    const secret = decryptKey(g.clientSecretEnc);
    if (!g.clientId || !secret) return { ok: false, error: 'Save the client ID and secret first.' };
    try {
      const r = await connectGoogle({ clientId: g.clientId, clientSecret: secret, openUrl: (u) => shell.openExternal(u) });
      const rest = (store.get('settings.connectors.google.accounts') || []).filter((a) => a.email.toLowerCase() !== r.email.toLowerCase());
      store.set('settings.connectors.google.accounts', [...rest, { email: r.email, refreshEnc: encryptKey(r.refreshToken) }]);
      ask.googleApi = null;
      broadcast();
      return { ok: true, email: r.email };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('connectors:google:remove', async (_e, email) => {
    const list = store.get('settings.connectors.google.accounts') || [];
    const hit = list.find((a) => a.email === email);
    store.set('settings.connectors.google.accounts', list.filter((a) => a.email !== email));
    ask.googleApi = null;
    if (hit) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptKey(hit.refreshEnc))}`, { method: 'POST' }).catch(() => {}); // best effort: take Relay's access away at Google too
    broadcast();
  });
  ipcMain.handle('card:close', () => cardPanel?.hide());
  ipcMain.handle('card:open', (_e, url) => cardPanel?.open(url));
  ipcMain.handle('card:size', (_e, h) => cardPanel?.setSize(h));
  ipcMain.handle('card:hover', (_e, on) => cardPanel?.setHover(on));
  ipcMain.handle('memory:add', (_e, text) => {
    const r = ask.rememberFact(String(text || ''));
    broadcast();
    return r;
  });
  ipcMain.handle('memory:remove', (_e, id) => {
    store.data.memories = (store.data.memories || []).filter((m) => m.id !== id);
    store.save();
    broadcast();
  });
  ipcMain.handle('memory:clear', () => {
    store.data.memories = [];
    store.save();
    broadcast();
  });
  ipcMain.handle('schedule:add', (_e, text) => {
    const cmd = parseScheduleCommand(String(text || ''));
    if (!cmd || cmd.type !== 'schedule-add') return { ok: false, reply: 'Say it like: every weekday at 8am, open my email. (Or: schedule open my email for tomorrow at 7am.)' };
    const s = ask.scheduler.add(cmd);
    broadcast();
    return s ? { ok: true } : { ok: false, reply: 'That time has already passed.' };
  });
  ipcMain.handle('schedule:remove', (_e, id) => { ask.scheduler.removeId(id); broadcast(); });
  ipcMain.handle('schedule:toggle', (_e, id, on) => { ask.scheduler.setEnabled(id, on); broadcast(); });
  ipcMain.handle('vocab:remove', (_e, t) => {
    store.data.vocabulary = store.get('vocabulary').filter((x) => x !== t);
    store.save();
    schedulePrepareSpeech();
    broadcast();
  });
  ipcMain.handle('dictation:delete', (_e, id) => {
    store.data.dictations = store.data.dictations.filter((d) => d.id !== id);
    store.save();
    broadcast();
  });
  ipcMain.handle('dictation:clear', () => {
    store.data.dictations = [];
    store.save();
    broadcast();
  });
  ipcMain.handle('history:clear', () => {
    store.data.history = [];
    store.data.dictations = [];
    store.data.actions = [];
    store.save();
    broadcast();
  });

  ipcMain.handle('shortcut:set', (_e, name, def) => {
    if (!['ask', 'dictate', 'type', 'mark'].includes(name)) return;
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
  ipcMain.handle('recent:ask', async (_e, text) => {
    recent?.close();
    if (typeof text === 'string' && text.trim()) await ask.submit(text);
  });
  ipcMain.handle('recent:size', (_e, h) => recent?.setPanelHeight(h));
  ipcMain.handle('recent:hit', (_e, on) => recent?.setHit(!!on));
  ipcMain.handle('files:drop', (_e, paths) => ask.attachFiles(paths));
  ipcMain.handle('ask:submit', (_e, text) => ask.submit(text));
  ipcMain.handle('ask:cancel', () => ask.cancelAll());
  ipcMain.handle('ask:confirm', (_e, yes) => ask.pendingConfirm?.(!!yes));
  ipcMain.handle('ask:resize', (_e, h) => ask.resize(h));
  ipcMain.handle('ask:interactive', (_e, on) => ask.win && !ask.win.isDestroyed() && ask.win.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.handle('ask:hidden', () => ask.finishHide());
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
  overlay = new Overlay({ isEnabled: () => store.get('settings.cursor'), isBuddy: () => store.get('settings.buddy') !== false, getName: () => store.get('settings.assistantName') || 'J.A.R.V.I.S', getLook: () => store.get('settings.look') || 'jarvis' });
  overlay.watchDisplays();
  recent = new RecentPanel({ getEnabled: () => store.get('settings.recent') !== false, preload: path.join(__dirname, 'preload.js') });
  recent.start();
  cardPanel = new CardPanel({ preload: path.join(__dirname, 'preload.js') });
  overlay.applyMode(); // the always-on ring appears at launch
  speech = new Speech({ binPath: speechBinPath() });
  speech.on('preparing', (f) => {
    speechInfo = { ...speechInfo, preparing: f };
    broadcast();
  });
  kokoro = new KokoroVoice({ dir: path.join(app.getPath('userData'), 'voices', 'kokoro'), onProgress: () => broadcast() });
  speaker = new Speaker({
    kokoro,
    getTts: () => {
      const t = store.get('settings.tts');
      return { engine: t.engine, kokoro: t.kokoro, openai: { ...t.openai, key: decryptKey(t.openai.keyEnc) }, elevenlabs: { ...t.elevenlabs, key: decryptKey(t.elevenlabs.keyEnc) } };
    },
    onProblem: (m) => { voiceProblem = m; broadcast(); }
  });
  timers = new Timers({
    store,
    onFire: (t) => {
      const alarm = t.label === 'Alarm';
      const body = alarm ? 'Your alarm is going off.' : t.label || `Your timer for ${humanDuration(t.seconds)} is done.`;
      const text = t.missed ? `${body} It finished while Relay was closed.` : body;
      if (Notification.isSupported()) new Notification({ title: alarm ? 'Alarm' : 'Timer done', body: text }).show();
      ask.alert(text);
    }
  });
  glass = new Glass({ binPath: glassBinPath() });
  ask = new AskController({ store, bridge, overlay, speech, speaker, timers, glass, axBin: axBinPath(), onChange: broadcast });
  timers.start();
  // Scheduled requests: checked every 15 seconds. What is due runs when Relay is free; what was missed while the Mac slept is only reported.
  ask.scheduler = new Scheduler({ store });
  ask.cardPanel = cardPanel;
  ask.onAgentDone = (a) => { if (Notification.isSupported() && a.status !== 'stopped') new Notification({ title: a.status === 'done' ? 'Agent finished' : 'Agent stopped with a problem', body: `${a.task.slice(0, 80)}: ${a.result.slice(0, 160)}`, silent: true }).show(); };
  setInterval(() => {
    const { due, missed } = ask.scheduler.tick(ask.canRunScheduled());
    for (const s of missed) if (Notification.isSupported()) new Notification({ title: 'Missed a scheduled request', body: `"${s.text}" was due while the Mac was asleep or Relay was closed. It will run next time.` }).show();
    for (const s of due) ask.runScheduled(s);
    if (due.length || missed.length) broadcast();
  }, 15000);
  ask.onLearn = (from, to) => { // a word you keep fixing by hand becomes a word fix
    const list = (store.data.replacements || []).filter((r) => r.from.toLowerCase() !== from.toLowerCase());
    list.unshift({ id: crypto.randomUUID(), from, to });
    store.data.replacements = list;
    store.save();
    schedulePrepareSpeech();
    broadcast();
    if (Notification.isSupported()) new Notification({ title: 'Learned a word', body: `"${from}" will now be typed as "${to}".`, silent: true }).show();
  };
  if (speaker) { const was = speaker.onState; speaker.onState = (on) => { was?.(on); rebuildTray(); }; } // the Stop Speaking item follows whether it is talking
  // Start the glass helper now rather than at the first pill, and give focus straight back if it took it:
  // a new helper started by the front app can end up in front, which would send a dictation nowhere.
  if (glass.supported && store.get('settings.glass') !== false) {
    ask.frontName().catch(() => null).then((before) => {
      glass.onReady = async () => {
        const now = await ask.frontName().catch(() => null);
        if (now === 'relay-glass' && before && before !== 'relay-glass') ask.mac.focusApp(before).catch(() => {});
      };
      glass.start();
    });
  }
  hotkeys = new Hotkeys({ getShortcuts: () => store.get('settings.shortcuts'), onEvent: (n, k) => ask.onShortcut(n, k), onClick: () => ask.guide.onClick() });

  const iconPath = path.join(__dirname, '../../assets/trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Relay');
  tray.on('drop-files', (_e, files) => ask.attachFiles(files)); // drag files onto the menu bar icon
  const statusIcon = (name) => nativeImage.createFromPath(path.join(__dirname, `../../assets/${name}.png`));
  const trayIcons = { idle: icon, listening: [statusIcon('trayListening-1'), statusIcon('trayListening-2')], working: statusIcon('trayWorking') };
  let trayPulse = null;
  // A red pulsing badge while Relay listens, a blue one while it works, the normal icon otherwise.
  ask.onState = (state) => {
    clearInterval(trayPulse);
    if (state === 'listening' || state === 'finishing') {
      let frame = 0;
      tray.setImage(trayIcons.listening[0]);
      tray.setToolTip('Relay is listening');
      trayPulse = setInterval(() => tray.setImage(trayIcons.listening[++frame % 2]), 450);
    } else if (state === 'working' || state === 'confirm') {
      tray.setImage(trayIcons.working);
      tray.setToolTip('Relay is working');
    } else {
      tray.setImage(trayIcons.idle);
      tray.setToolTip('Relay');
    }
  };

  if (process.env.RELAY_E2E) global.__relay = { store, ask, bridge, hotkeys, openMain, openOnboarding };
  registerIpc();
  startBridge();
  applyDockAndLogin();
  rebuildTray();
  startHotkeysWhenTrusted();
  refreshClaude().then(broadcast);
  prepareSpeech().finally(() => ask.wake.refresh()); // "Hey Jarvis" starts listening once the speech model is ready
  // Headsets come and go: keep the microphone label in the title bar current.
  setInterval(async () => {
    if (!speech.child) return;
    const d = await speech.inputDevice(store.get('settings.speech.input')).catch(() => null);
    if (d && d !== speechInfo.device) { speechInfo.device = d; broadcast(); }
  }, 8000);
  if (process.env.RELAY_DEMO) ask.demo(process.env.RELAY_DEMO);

  if (store.get('onboardingDone')) openMain(process.env.RELAY_PAGE || 'home');
  else openOnboarding();
});

app.on('second-instance', () => openMain('home'));
app.on('activate', () => openMain('home'));
app.on('window-all-closed', (e) => e.preventDefault()); // keep running in the menu bar
app.on('before-quit', () => {
  try { ask.ducker.restoreNow((script) => require('child_process').execFileSync('osascript', ['-e', script], { timeout: 3000 }).toString().trim()); } catch {} // never quit with the volume left low
  quitting = true;
  recent?.stop();
  hotkeys?.stop();
  bridge?.stop();
  speaker?.stop();
  glass?.stop();
  speech?.stop();
  ask?.dropWarm(true);
  ask?.mcp.stop();
  ask?.unduck();
  store?.flush();
});
