const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, clipboard, systemPreferences, Notification, nativeTheme, screen, powerMonitor } = require('electron');
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
const { ClipboardHistory } = require('./clipboardHistory');
const doctor = require('./doctor');
const flagsMod = require('./flags');
const { InboundService } = require('./inbound');
const { PluginManager } = require('./plugins');
const { PanelHub, approvalText } = require('./panels/hub');
const { Sampler } = require('./panels/sources');
const { PanelWindows } = require('./panelWindow');
const { NotesService } = require('./notes/service');
const { Alerts, parseCalendar, calendarEvents, batteryEvent } = require('./proactive');
const { Connectivity } = require('./connectivity');
const welcome = require('./welcome');
const { newTopic } = require('./notify');
const { shapeToModel } = require('./hands/shape');
const { PresenceControl } = require('./presence');
const { Stickies } = require('./stickies');
const { StickyPanel } = require('./stickyPanel');
const { HoloLibrary } = require('./holo/library');
const { nightlyDue, dayKey } = require('./drive/nightly');
const uiText = require('../renderer/ui-es');
const { AssistPanel } = require('./assistPanel');
const { LockWatch } = require('./lockState');
const { profileFor } = require('./voiceProfile');
const { KokoroVoice } = require('./tts/kokoro');
const { Timers, humanDuration } = require('./timers');
const { Glass } = require('./glass');
const { RecentPanel } = require('./recent');
const { CardPanel } = require('./cards/panel');
const { HoloManager } = require('./holo/manager');
const { Drive } = require('./drive');
const { HandControl } = require('./hands/control');
const { ExternalDrag } = require('./hands/externalDrag');
const os = require('os');
const { execFile } = require('child_process');
const holoWin = require('./holo/windows');
const { downloadStl } = require('./models/lookup');
const { ModelCache } = require('./models/cache');
const { RemoteService } = require('./remote/service');
const { NotionApi } = require('./connectors/notion');
const { McpRemote } = require('./connectors/mcp');
const { connectAccount: connectGoogle } = require('./connectors/google');
const { Scheduler, describe: describeSchedule, parseScheduleCommand } = require('./schedule');
const perms = require('./permissions');
const { AnthropicProvider } = require('./agent/providers/anthropic');
const { OllamaProvider } = require('./agent/providers/ollama');
const { PRESETS, isPreset } = require('./agent/providers/presets');
const claudeCli = require('./agent/claudeCli');

app.setName('Relay');
if (!app.requestSingleInstanceLock()) app.quit();

let lastThrown = null;
let presence, stickyPanel, store, bridge, overlay, ask, hotkeys, tray, speech, speaker, timers, glass, kokoro, recent, cardPanel, assistPanel, holos, remote, hands, inbound, pluginMgr, panelHub, panelWins, notesSvc, connectivity;
let prepareTimer = null;
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
  holos?.refreshUi();
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
  const hasHfToken = !!decryptKey(d.settings.hfTokenEnc);
  delete d.settings.hfTokenEnc;
  const cn = d.settings.connectors || {};
  const connectors = { notion: { connected: !!decryptKey(cn.notion?.tokenEnc), name: cn.notion?.name || '' }, google: { clientId: cn.google?.clientId || '', hasSecret: !!decryptKey(cn.google?.clientSecretEnc), accounts: (cn.google?.accounts || []).map((a) => a.email) }, apps: { connected: !!(cn.apps?.url && decryptKey(cn.apps?.keyEnc)), url: cn.apps?.url ? (() => { try { return new URL(cn.apps.url).host; } catch { return ''; } })() : '', count: cn.apps?.count || 0, headerName: cn.apps?.headerName || 'x-api-key' } };
  delete d.settings.connectors;
  const hasKeys = {};
  for (const [id, s] of Object.entries(d.settings.model.presets)) {
    hasKeys[id] = !!decryptKey(s.keyEnc);
    delete s.keyEnc;
  }
  return {
    ...d,
    connectors,
    remote: remote ? remote.info() : null,
    schedules: (d.schedules || []).map((s) => ({ ...s, when: describeSchedule(s) })),
    hasKey,
    hasKeys,
    hasTtsKeys,
    hasHfToken,
    activity: { state: ask?.state || 'idle', question: ask?.pendingConfirm ? ask.confirmQuestion || '' : '', tasks: ask?.taskList?.() || [], agents: ask?.agents?.view?.() || [] },
    handsInfo: { status: hands?.status || 'off', message: hands?.message || '' },
    presenceInfo: { status: presence?.status || 'off', message: presence?.message || '', state: presence?.state || 'unknown', faces: presence?.faces || 0 },
    voiceProblem,
    kokoro: kokoro.status(),
    presetInfo: PRESETS,
    history: d.history.slice(0, 200),
    actions: (() => { const can = ask?.undos?.ids(); return d.actions.slice(0, 300).map((a) => (can && can.has(a.id) ? { ...a, undoable: true } : a)); })(),
    recap: ask?.recapData?.() || null,
    stats: store.stats(),
    labels: { ask: label(d.settings.shortcuts.ask), dictate: label(d.settings.shortcuts.dictate), type: label(d.settings.shortcuts.type), mark: label(d.settings.shortcuts.mark) },
    claude: claudeState,
    codex: ask?.codexInfo ? { installed: ask.codexInfo.installed, signedIn: ask.codexInfo.signedIn, method: ask.codexInfo.method, usable: ask.codexInfo.usable, checked: true, using: !!ask.failover?.active } : { checked: false },
    speech: { available: speech.available, ...speechInfo },
    dictations: d.dictations.slice(0, 200),
    firefoxConnected: bridge.isConnected(),
    hotkeysRunning: hotkeys.running,
    hotkeysSeen: hotkeys.eventsSeen > 0,
    hotkeysError: hotkeys.error,
    version: app.getVersion(),
    flagList: flagsMod.offered(),
    pluginList: pluginMgr?.list() || [],
    notesList: notesSvc?.status() || [],
    offlineNow: !!ask?.offline,
    inboundInfo: inbound?.status() || { running: false, paired: false },
    extensionPath: extensionPath()
  };
}

function extensionPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'firefox-extension') : path.join(__dirname, '../../extension/firefox');
}

// Hand control on or off (the menu bar item and Settings both use this). Turning it on asks macOS for the camera the first time.
async function setHands(on, { quiet = false } = {}) {
  if (on) {
    store.set('settings.hands.enabled', true);
    const r = await hands.enable();
    if (!r.ok) { store.set('settings.hands.enabled', false); ask.notice(r.error, 'failed'); }
    else if (!quiet) ask.notice('Hand control is on. Hold up an open hand: it moves a ring. Fist grabs, thumb and finger tap clicks, peace sign talks.', 'done');
    broadcast();
    return r;
  }
  store.set('settings.hands.enabled', false);
  hands.disable();
  broadcast();
  return { ok: true };
}

// Presence (opt-in): the camera counts faces so Relay knows when you leave the desk.
async function setPresence(on) {
  if (on) {
    const r = await presence.enable();
    if (!r.ok) { store.set('settings.presence.enabled', false); ask.notice(r.error, 'failed'); }
  } else presence.disable();
  broadcast();
}

// The camera view in the top right (hands, outlines, gesture, count). Needs hand control on to show anything.
function setHandsPreview(on) {
  store.set('settings.hands.preview', !!on);
  hands.setPreview(!!on);
  broadcast();
}

// "hands" said to Relay: show / hide the view (turning control on if it is off) or stop it.
async function handsCommand(cmd) {
  if (cmd === 'dashboard') { const r = await panelHub.show({ title: 'Jarvis dashboard', sources: ['dashboard'] }); return r.ok ? 'Here is your dashboard.' : r.error; }
  if (cmd === 'undo') { if (!lastThrown) return 'There is no thrown item to restore.'; const undo = lastThrown; try { await undo(); if (lastThrown === undo) lastThrown = null; return 'Restored the last thrown item.'; } catch { return 'I could not restore the thrown item.'; } }
  if (cmd === 'help') { const r = await panelHub.show({ title: 'Hand gestures', html: require('./hands/help').HTML }); return r.ok ? 'Here is the hand gesture guide.' : r.error; }
  if (cmd === 'pause' || cmd === 'resume') { if (!hands.enabled) return 'Hand control is off.'; hands.setPaused(cmd === 'pause'); return `Hand control ${cmd === 'pause' ? 'paused' : 'resumed'}.`; }
  if (cmd === 'calibrate') { if (!hands.enabled) { const r = await setHands(true, { quiet: true }); if (!r.ok) return r.error; } setHandsPreview(true); const r = hands.calibrate(); return r.ok ? 'Move your hand around the edges of the camera view for eight seconds.' : r.error; }
  if (cmd === 'off') { await setHands(false); return 'Hand control is off.'; }
  if (cmd === 'hide') { setHandsPreview(false); return hands.enabled ? 'Hand view hidden. Hand control is still on.' : 'Hand control is off.'; }
  setHandsPreview(true);
  if (!hands.enabled) {
    const r = await setHands(true, { quiet: true });
    if (!r.ok) { setHandsPreview(false); return r.error || 'Hand control could not start.'; }
  }
  return 'Hand view is on, top right. Hold a hand up to the camera.';
}

function rebuildTray() {
  if (!tray) return;
  const askLabel = label(store.get('settings.shortcuts.ask'));
  const last = store.get('lastReply');
  tray.setContextMenu(Menu.buildFromTemplate(uiText.localizeMenu([
    { label: hotkeys.running ? `Ready · ${askLabel} to ask` : 'Shortcuts off (see Permissions)', enabled: false },
    { label: 'Type a Request…', click: () => ask.open() },
    { label: ask.agents.running().length ? `Stop ${ask.agents.running().length} Background Agent${ask.agents.running().length === 1 ? '' : 's'}` : 'No Background Agents', enabled: ask.agents.running().length > 0, click: () => ask.agents.stop() },
    { label: holos?.holos.size ? `Clear ${holos.holos.size} Hologram${holos.holos.size === 1 ? '' : 's'}` : 'No Holograms', enabled: !!holos?.holos.size, click: () => holos.closeAll() },
    { label: hands?.status === 'error' ? 'Hand control (camera): problem, click to retry' : 'Hand control (camera)', type: 'checkbox', checked: !!store.get('settings.hands.enabled') && hands?.status !== 'error', click: (item) => setHands(item.checked) },
    { label: 'Show Hand View (top right)', type: 'checkbox', checked: !!store.get('settings.hands.preview'), enabled: !!store.get('settings.hands.enabled'), click: (item) => setHandsPreview(item.checked) },
    { label: 'Stop Speaking', enabled: !!speaker?.speaking, click: () => ask.interruptSpeech() },
    { label: 'Copy Last Reply', enabled: !!last, click: () => clipboard.writeText(last) },
    { label: last ? `Last: ${last.length > 48 ? last.slice(0, 48) + '…' : last}` : 'Last: nothing yet', enabled: false },
    { type: 'separator' },
    { label: 'Private Meeting Answers', type: 'checkbox', checked: !!ask.assistOn, click: (item) => { (item.checked ? ask.startMeeting({ assist: true }).then((r) => ask.notice(r.reply, r.status === 'failed' ? 'failed' : 'done')) : Promise.resolve(ask.assistStop())).finally(() => rebuildTray()); } },
    { label: 'Take Meeting Notes', type: 'checkbox', checked: !!ask.meeting?.active, click: (item) => { (item.checked ? ask.startMeeting().then((r) => ask.notice(r.reply, r.status === 'failed' ? 'failed' : 'done')) : ask.stopMeeting().then((r) => r && ask.notice(r.reply, r.status === 'failed' ? 'failed' : 'done'))).finally(() => rebuildTray()); } },
    { label: 'Listen for “Hey Jarvis”', type: 'checkbox', checked: !!store.get('settings.wake.enabled'), click: (item) => { store.set('settings.wake.enabled', item.checked); ask.wake.refresh(); broadcast(); rebuildTray(); } },
    { label: 'Recent asks on the left edge', type: 'checkbox', checked: store.get('settings.recent') !== false, click: (item) => { store.set('settings.recent', item.checked); broadcast(); rebuildTray(); } },
    ...(store.get('settings.model.provider') === 'claude' ? [{ label: 'Model Speed', submenu: [['auto', 'Auto'], ['haiku', 'Fast (Haiku)'], ['sonnet', 'Smart (Sonnet)'], ['opus', 'Deep (Opus)']].map(([v, l]) => ({ label: l, type: 'radio', checked: store.get('settings.model.claudeModel') === v, click: () => { store.set('settings.model.claudeModel', v); broadcast(); } })) }] : []),
    { label: 'Relay Remote (phone)', type: 'checkbox', checked: !!store.get('settings.remote.enabled'), click: async (item) => { store.set('settings.remote.enabled', item.checked); await remote.sync(); broadcast(); } },
    { label: 'Show the cursor buddy', type: 'checkbox', checked: store.get('settings.buddy') !== false, click: (item) => { store.set('settings.buddy', item.checked); overlay.applyMode(); broadcast(); rebuildTray(); } },
    { type: 'separator' },
    { label: 'Open Relay', click: () => openMain('home') },
    { label: 'Settings…', accelerator: 'Cmd+,', click: () => openMain('general') },
    { label: 'Welcome Guide…', click: () => openOnboarding() },
    { label: 'About Relay', click: () => app.showAboutPanel() },
    { type: 'separator' },
    { label: 'Quit Relay', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }
  ], store.get('settings.language.ui'))));
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

// Command Relay by text runs only while its switch is on.
function syncInbound() {
  if (!inbound) return;
  if (flagsMod.isOn(store.get('settings'), 'imessage')) inbound.start(); else inbound.stop();
}


// "Welcome back, Sir" with what happened while the screen was locked. Quick: no model is asked, only what the app already knows.
async function welcomeBack(lockedAt, lastWelcome) {
  const cfg = store.get('settings.welcome') || {};
  if (!lockedAt || !welcome.shouldGreet({ enabled: cfg.enabled !== false, awayMs: Date.now() - lockedAt, minAwayMs: (cfg.minAwayMin ?? 5) * 60000, minGapMs: (cfg.repeatMin ?? 10) * 60000, sinceLastMs: Date.now() - lastWelcome, busy: !!ask.meeting?.active })) return false;
  const [day, battery] = await Promise.all([
    Promise.race([ask.mac.calendarEvents(1).then(parseCalendar).catch(() => []), new Promise((r) => setTimeout(() => r([]), 2500))]),
    new Promise((res) => execFile('/usr/bin/pmset', ['-g', 'batt'], { timeout: 1500 }, (e, out) => res(e ? null : require('./panels/sources').parseBattery(String(out)))))
  ]);
  const w = welcome.buildWelcome({ name: cfg.name || 'Sir', lockedAt, now: Date.now(), history: store.get('history') || [], events: day, battery });
  if (cfg.show !== false && Notification.isSupported()) new Notification({ title: `Welcome back, ${cfg.name || 'Sir'}`, body: w.lines.join(' '), silent: true }).show();
  if (cfg.speak !== false && !ask.speaker?.speaking && ask.state !== 'listening') ask.speakText(w.spoken);
  return true;
}

function registerIpc() {
  ipcMain.handle('state:get', () => publicState());
  ipcMain.handle('skills:review', (_e, id, approve) => {
    const list = store.get('skillSuggestions') || [];
    const item = list.find(x => x.id === id);
    if (!item) return { ok: false, error: 'That suggestion is no longer available.' };
    if (approve) {
      const existing = (store.get('routines') || []).some(r => r.name.toLowerCase() === item.name.toLowerCase());
      if (existing) return { ok: false, error: 'A routine with that name already exists.' };
      ask.upsertRoutine(item.name, item.steps);
    }
    store.set('skillSuggestions', list.filter(x => x.id !== id));
    broadcast();
    return { ok: true };
  });
  ipcMain.handle('state:set', (_e, key, value) => {
    if (!key.startsWith('settings.')) throw new Error('Only settings can be set this way.');
    store.set(key, value);
    applyDockAndLogin();
    if (key === 'settings.buddy' || key === 'settings.cursor') { overlay.applyMode(); rebuildTray(); }
    if (key === 'settings.language.ui') rebuildTray();
    if (key === 'settings.workMode') ask.dropWarm(true);
    if (key === 'settings.hands.margin') hands?.cam?.syncConfig?.();
    if (key === 'settings.hands.appDragging' && hands?.enabled) { if (value === false) { hands.release(); hands.peer?.release(); hands.externalDrag?.close(); } else hands.externalDrag?.start(); }
    if (key === 'settings.meeting.hidden') assistPanel?.protect();
    if (key === 'settings.presence.enabled') setPresence(!!value);
    if (key === 'settings.wake.apps') { ask.watchFront(); ask.wake.refresh(); }
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
  // Codex, the backup for when Claude is out of usage: its own sign-in with ChatGPT (Relay never sees it).
  ipcMain.handle('codex:status', async () => { await ask.codexReady(true); broadcast(); return ask.codexInfo; });
  ipcMain.handle('codex:login', async () => {
    const codexPath = await require('./agent/codexCli').findCodex();
    if (!codexPath) return { ok: false, error: 'Codex is not installed.' };
    const r = await require('./agent/codexCli').codexLogin(codexPath);
    await ask.codexReady(true);
    broadcast();
    return { ...r, ok: r.ok && !!ask.codexInfo?.usable };
  });
  ipcMain.handle('codex:cancel-login', () => require('./agent/codexCli').codexLogin.current?.kill());
  ipcMain.handle('codex:logout', async () => {
    const codexPath = await require('./agent/codexCli').findCodex();
    if (codexPath) await require('./agent/codexCli').codexLogout(codexPath);
    await ask.codexReady(true);
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
    picked: await speaker.resolve(store.get('settings.voice')),
    jarvis: await speaker.resolve('jarvis')
  }));
  ipcMain.handle('models3d:test', () => ask.testPhotoModels().catch((e) => ({ ok: false, error: e.message, attempts: [] })));
  ipcMain.handle('models3d:set-hf-token', (_e, token) => {
    const t = String(token || '').trim();
    if (t && !/^hf_[A-Za-z0-9]{20,}$/.test(t)) return { ok: false, error: 'That does not look like a Hugging Face token (it starts with hf_). Make a free one at huggingface.co/settings/tokens (a "read" token is enough).' };
    store.set('settings.hfTokenEnc', t ? encryptKey(t) : '');
    broadcast();
    return { ok: true };
  });
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
  ipcMain.handle('voice:preview', (_e, voice, rate) => speaker.speak('Hi, this is how I will sound when I answer you.', profileFor('reply', { ...(store.get('settings') || {}), voice, voiceRate: rate })));
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



  // ----- Command Relay by text -----
  ipcMain.handle('inbound:status', () => ({ ...(inbound?.status() || {}), fullDisk: fullDisk(), on: flagsMod.isOn(store.get('settings'), 'imessage') }));
  ipcMain.handle('inbound:code', () => { syncInbound(); return { code: inbound?.newCode() || null }; });
  ipcMain.handle('queue:review', async (_e, id, run) => { const r = await inbound?.releaseReview(String(id), !!run); broadcast(); return r || { ok: false }; });
  ipcMain.handle('inbound:unpair', () => { inbound?.unpair(); broadcast(); return { ok: true }; });



  // ----- Ask my notes -----
  ipcMain.handle('notes:status', () => notesSvc?.status() || []);
  ipcMain.handle('notes:add', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder for Ask my notes', properties: ['openDirectory'], defaultPath: app.getPath('documents') });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try { const p = notesSvc.addFolder(r.filePaths[0]); broadcast(); return { ok: true, path: p }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('notes:remove', (_e, p) => { notesSvc.removeFolder(String(p)); broadcast(); return { ok: true }; });
  ipcMain.handle('notes:index', async (_e, p) => {
    const folder = String(p);
    if (!notesSvc.folders().includes(folder)) return { ok: false, error: 'That folder is not set up.' };
    const run = async (force) => { try { const r = await notesSvc.reindex(folder, { force }); broadcast(); return { ok: true, ...r }; } catch (e) { if (e.tooBig && !force) { const ok = (await dialog.showMessageBox({ type: 'question', buttons: ['Index it', 'Cancel'], defaultId: 1, cancelId: 1, message: 'This folder is large', detail: `${e.message} Reading it can take a while. Index it anyway?` })).response === 0; return ok ? run(true) : { ok: false, error: 'Not indexed.' }; } return { ok: false, error: e.message }; } };
    return run(false);
  });

  // ----- Plugins -----
  ipcMain.handle('plugins:list', () => pluginMgr?.list() || []);
  ipcMain.handle('plugins:inspect', async (_e, input) => { try { return { ok: true, ...(await pluginMgr.inspect(String(input || ''))) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('plugins:install', async (_e, token) => { try { await pluginMgr.install(String(token)); broadcast(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('plugins:cancel', (_e, token) => { pluginMgr?.cancel(String(token)); return { ok: true }; });
  ipcMain.handle('plugins:enable', (_e, name, on) => { pluginMgr?.setEnabled(String(name), !!on); broadcast(); return { ok: true }; });
  ipcMain.handle('plugins:remove', (_e, name) => { pluginMgr?.remove(String(name)); broadcast(); return { ok: true }; });
  ipcMain.handle('plugins:update-check', async (_e, name) => { try { return await pluginMgr.checkUpdate(String(name)); } catch { return { available: false }; } });

  // ----- Relay Doctor and experimental switches -----
  let doctorFixes = new Map(); // fix id -> fix, from the last run
  const codesign = () => new Promise((resolve) => {
    if (!app.isPackaged) return resolve('dev');
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', path.resolve(process.execPath, '../../..')], { timeout: 3000 }, (err, out, errOut) => resolve(doctor.parseSigning(`${out}\n${errOut}`)));
  });
  const fullDisk = () => { // Messages' database can only be opened with Full Disk Access
    try { require('fs').closeSync(require('fs').openSync(path.join(app.getPath('home'), 'Library/Messages/chat.db'), 'r')); return true; } catch (e) { return e.code === 'ENOENT' ? null : false; }
  };
  const doctorEnv = async () => {
    const st = await codesign();
    const offlineOn = flagsMod.isOn(store.get('settings'), 'offline');
    const ollamaUp = offlineOn ? await fetch(`${store.get('settings.model.ollamaUrl')}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false) : null;
    const free = await new Promise((res) => execFile('/bin/df', ['-m', app.getPath('userData')], { timeout: 2000 }, (e, out) => res(e ? null : Number(String(out).trim().split('\n').pop().trim().split(/\s+/)[3]) || null)));
    return {
      claude: () => claudeState, codex: () => ask.codexInfo ? { ...ask.codexInfo, checked: true } : { checked: false },
      failoverOn: () => store.get('settings.failover.codex') !== false,
      perms: () => perms.status(), signing: () => st, remote: () => remote?.info(),
      handsEnabled: () => !!store.get('settings.hands.enabled'), browser: () => ({ connected: bridge.isConnected() }),
      hotkeys: () => ({ running: hotkeys.running, error: hotkeys.error }), speech: () => ({ available: speech.available, voiceProblem }),
      storeInfo: () => ({ freeMb: free }),
      recentErrors: () => store.get('actions').filter((a) => a.ok === false && Date.now() - a.ts < 86400e3).map((a) => ({ tool: a.tool, error: typeof a.result === 'string' ? a.result : '' })),
      toolMisses: () => ({ on: flagsMod.isOn(store.get('settings'), 'toolCategories'), recent: (store.get('toolMisses') || []).filter((x) => Date.now() - x.ts < 86400e3) }),
      offline: () => ({ on: offlineOn, online: connectivity ? connectivity.online : true, ollama: ollamaUp }),
      notes: () => ({ on: flagsMod.isOn(store.get('settings'), 'folderQa'), folders: notesSvc?.status() || [], noEmbed: !!notesSvc?.noEmbed }),
      plugins: () => ({ on: flagsMod.isOn(store.get('settings'), 'plugins'), list: pluginMgr?.list() || [], sandbox: !!pluginMgr?.sandbox }),
      imessage: () => ({ on: flagsMod.isOn(store.get('settings'), 'imessage'), fullDisk: fullDisk(), ...(inbound?.status() || {}) }),
      _signing: st
    };
  };
  const runDoctor = async () => {
    const env = await doctorEnv();
    const results = await doctor.runChecks(env);
    doctorFixes = new Map(results.filter((r) => r.fix).map((r) => [r.fix.id, r.fix]));
    const mode = store.get('settings.doctor.fix') || 'ask';
    const out = results.map((r) => ({ ...r, ...(r.fix ? { fix: { ...r.fix, policy: doctor.fixPolicy(mode, r.fix) } } : {}) }));
    for (const r of out) if (r.fix?.policy === 'auto') { // small things the person chose to let Relay fix without asking
      await applyFix(r.fix).catch(() => {});
    }
    const meta = { version: app.getVersion(), os: process.getSystemVersion?.() || '', arch: process.arch, signing: env._signing, flags: Object.keys(flagsMod.FLAGS).filter((n) => flagsMod.isOn(store.get('settings'), n)), errors: env.recentErrors() };
    return { results: out, worst: doctor.worst(results), meta, report: doctor.buildReport(results, meta, { home: app.getPath('home') }), fixMode: mode, fullDisk: fullDisk() };
  };
  const applyFix = async (fix) => {
    const a = fix.action;
    if (a.type === 'pane') perms.openPane(a.name);
    else if (a.type === 'copy') clipboard.writeText(a.text);
    else if (a.type === 'restart-remote') { remote.stop(); await remote.sync(); }
    else if (a.type === 'login') { if (a.who === 'claude') { const p = await claudeCli.findClaude(); claudeCli.login(p).then(refreshClaude).then(broadcast); } else { const cx = require('./agent/codexCli'); cx.codexLogin(await cx.findCodex()).then(() => ask.codexReady(true)).then(broadcast); } }
    broadcast();
    return { ok: true, copied: a.type === 'copy' };
  };
  ask.doctorRun = async () => { const r = await runDoctor(); openMain('doctor'); return doctor.summarize(r.results); };
  ipcMain.handle('memory2:act', (_e, action, id, payload) => ask.memoryV2Act(String(action), String(id), payload || {}));
  ipcMain.handle('doctor:run', () => runDoctor());
  ipcMain.handle('doctor:fix', async (_e, id) => { const fix = doctorFixes.get(String(id)); return fix ? applyFix(fix) : { ok: false, error: 'Run the checks again first.' }; });
  ipcMain.handle('doctor:report', async () => { const r = await runDoctor(); clipboard.writeText(r.report); return { ok: true }; });
  ipcMain.handle('doctor:issue', async (_e, kind) => {
    const r = await runDoctor();
    clipboard.writeText(r.report);
    shell.openExternal(doctor.issueUrl(kind === 'feature' ? 'feature' : 'bug', { version: app.getVersion() }));
    return { ok: true };
  });
  ipcMain.handle('flags:set', (_e, name, on) => {
    if (!flagsMod.FLAGS[name]) return { ok: false, why: 'Unknown setting.' };
    if (on) { const c = flagsMod.canEnable(name, { fulldisk: fullDisk() === true }); if (!c.ok) return c; }
    store.set(`settings.flags.${name}`, !!on);
    syncInbound();
    if (!flagsMod.isOn(store.get('settings'), 'panels')) panelHub?.closeAll();
    broadcast();
    return { ok: true };
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
  // Your other apps: a Composio (or other MCP server) address and key. It is tried before it is kept.
  ipcMain.handle('connectors:apps:set', async (_e, url, key, headerName) => {
    const u = String(url || '').trim(), k = String(key || '').trim(), hn = String(headerName || 'x-api-key').trim() || 'x-api-key';
    if (!u || !k) return { ok: false, error: 'Paste the server address and the key.' };
    try {
      const value = hn.toLowerCase() === 'authorization' && !/^bearer /i.test(k) ? `Bearer ${k}` : k;
      const tools = await new McpRemote({ url: u, headers: { [hn]: value } }).listTools();
      store.set('settings.connectors.apps', { url: u, headerName: hn, keyEnc: encryptKey(k), count: tools.length });
      ask.appsClient = null;
      broadcast();
      return { ok: true, count: tools.length };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('connectors:apps:clear', () => { store.set('settings.connectors.apps', { url: '', headerName: 'x-api-key', keyEnc: '', count: 0 }); ask.appsClient = null; broadcast(); });
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
  // Relay Remote: the phone page, served by Relay on this Mac.
  ipcMain.handle('remote:set', async (_e, patch) => {
    for (const [k, v] of Object.entries(patch || {})) if (['enabled', 'lan'].includes(k)) store.set(`settings.remote.${k}`, !!v);
    await remote.sync();
    broadcast();
  });
  ipcMain.handle('remote:pair', async () => { await remote.sync(); return remote.server ? remote.pair() : { error: remote.error || 'Turn Relay Remote on first.' }; });
  ipcMain.handle('remote:shortcut', async () => { await remote.sync(); if (!remote.server) return { error: remote.error || 'Turn Relay Remote on first.' }; const k = remote.shortcutKey(); broadcast(); return k; });
  ipcMain.handle('remote:remove', (_e, id) => { remote.devices.remove(id); broadcast(); });
  ipcMain.handle('remote:tailscale', async (_e, on) => { const r = on ? await remote.enableTailscale() : (await remote.disableTailscale(), { ok: true }); broadcast(); return r; });
  ipcMain.handle('remote:shortcut-file', async (_e, d) => {
    const { writeShortcutFile } = require('./remote/shortcutFile');
    const token = String(d?.token || '');
    const url = String(d?.url || '');
    if (!/^[\w-]{16,128}$/.test(token) || !/^https?:\/\//.test(url) || !remote.devices.find(token)) return { ok: false, error: 'Make a new Shortcut key first.' };
    const share = d?.kind === 'share';
    const out = path.join(app.getPath('downloads'), share ? 'Send to Relay.shortcut' : 'Relay.shortcut');
    const r = await writeShortcutFile({ url, token, outPath: out, share });
    if (r.ok) shell.showItemInFolder(out);
    return r;
  });
  ipcMain.handle('remote:tailscale-check', async () => { await remote.refreshTailscale(); broadcast(); return { ok: true }; });
  ipcMain.handle('remote:copy', (_e, text) => clipboard.writeText(String(text || '')));
  ipcMain.handle('activity:undo', (_e, id) => ask.undoAction(id));
  ipcMain.handle('notify:topic', () => { const t = newTopic(); store.set('settings.notify.ntfyTopic', t); broadcast(); return t; });
  ipcMain.handle('notify:test', () => ask.phone.test());
  ipcMain.handle('presence:frame', (_e, f) => { presence?.frame(f); });
  ipcMain.handle('presence:status', (_e, st) => { presence?.setStatus(st); });
  ipcMain.handle('hands:set', (_e, on) => setHands(!!on));
  ipcMain.handle('hands:preview', (_e, on) => { setHandsPreview(!!on); return { ok: true }; });
  ipcMain.handle('hands:frame', (_e, f) => { hands?.frame(f); });
  ipcMain.handle('hands:status', (_e, st) => { hands?.setStatus(st); });
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
  recent = new RecentPanel({ getEnabled: () => store.get('settings.recent') !== false, getDwell: () => store.get('settings.recentDelay'), preload: path.join(__dirname, 'preload.js') });
  recent.start();
  cardPanel = new CardPanel({ preload: path.join(__dirname, 'preload.js'), getHold: () => store.get('settings.answerStays') !== false });
  assistPanel = new AssistPanel({ preload: path.join(__dirname, 'preload.js'), getHidden: () => store.get('settings.meeting.hidden') !== false });
  holos = new HoloManager({
    createWindow: ({ width, height }) => holoWin.createHoloWindow({ preload: path.join(__dirname, 'preload.js'), width, height }),
    cursor: () => hands?.virtualCursor() || holoWin.cursor(), getUi: () => store.get('settings.holoUi'), area: holoWin.area, displayFor: holoWin.displayFor, download: (u) => downloadStl(u),
    generate: (c) => ask.generatePhotoModel(c), readFile: (f) => ask.modelCache?.readInside(f),
    fit: (base, item, hint) => ask.fitModels(base, item, hint), putFile: (b) => ask.modelCache?.put(ask.modelCache.key('part', b.length, b.slice(0, 64).toString('hex'), b.slice(-64).toString('hex')), b) || '',
    library: new HoloLibrary({ storage: { get: (k) => store.get(k), set: (k, v) => { store.data[k] = v; store.save(); } } }),
    saved: () => store.get('holograms') || [], save: (l) => { store.data.holograms = l; store.save(); }
  });
  holoWin.registerHoloIpc(holos);
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
      if (t.focus) ask.focusMode().end({ auto: true }).then((r) => { if (r.reply) ask.alert(r.reply); }).catch(() => {}); // focus time is over: notifications back, apps reopened
    }
  });
  glass = new Glass({ binPath: glassBinPath() });
  ask = new AskController({ store, bridge, overlay, speech, speaker, timers, glass, axBin: axBinPath(), onChange: broadcast });
  ask.onLanguage = () => { ask.wake.disarm(); ask.ducker.recover(); prepareSpeech().finally(() => ask.wake.refresh()); broadcast(); }; // "speak Spanish" said out loud
  // What you copied (text only, in memory, a day by default; never anything a password manager marks or that looks like a key or password).
  ask.clipHistory = new ClipboardHistory({
    read: () => { let formats = []; try { formats = clipboard.availableFormats(); for (const f of ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType', 'org.nspasteboard.AutoGeneratedType']) if (clipboard.has(f)) formats.push(f); } catch { /* formats are a hint */ } return { text: clipboard.readText(), formats }; },
    getConfig: () => store.get('settings.clipboardHistory')
  });
  setInterval(() => ask.clipHistory.tick(), 1000).unref?.();
  ask.inboxDir = path.join(app.getPath('userData'), 'inbox'); // photos and PDFs shared from the phone wait here
  timers.start();
  // Scheduled requests: checked every 15 seconds. What is due runs when Relay is free; what was missed while the Mac slept is only reported.
  ask.scheduler = new Scheduler({ store });
  ask.cardPanel = cardPanel;
  ask.assistPanel = assistPanel;
  // Is the Mac locked: the phone page shows it as a padlock. macOS tells us when it locks and unlocks; a slow check catches the rest.
  const lockWatch = new LockWatch({ exec: (cmd, args) => new Promise((resolve, reject) => require('child_process').execFile(cmd, args, { timeout: 4000 }, (e, out) => (e ? reject(e) : resolve(String(out))))), onChange: () => ask.statusChanged() });
  ask.lockWatch = lockWatch;
  let lockedAt = 0;
  let lastWelcome = 0;
  powerMonitor.on('lock-screen', () => { lockedAt = Date.now(); lockWatch.set(true); });
  powerMonitor.on('unlock-screen', () => {
    lockWatch.set(false);
    welcomeBack(lockedAt, lastWelcome).then((did) => { if (did) lastWelcome = Date.now(); }).catch(() => {});
    lockedAt = 0;
  });
  lockWatch.refresh();
  setInterval(() => { if (store.get('settings.remote.enabled')) lockWatch.refresh(); }, 8000);
  ask.holos = holos;
  ask.stickies = new Stickies({ storage: { get: (k) => store.get(k), set: (k, v) => { store.data[k] = v; store.save(); } } });
  stickyPanel = new StickyPanel({ stickies: ask.stickies, preload: path.join(__dirname, 'preload.js') });
  stickyPanel.sync(); // the stickies you left are still there
  ask.drive = new Drive({
    fs: require('fs'), home: os.homedir(), cards: cardPanel,
    exec: (file, args) => new Promise((res) => execFile(file, args, { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => res(out || ''))),
    thumb: async (p) => { try { const img = await nativeImage.createThumbnailFromPath(p, { width: 220, height: 220 }); return img.isEmpty() ? null : `data:image/jpeg;base64,${img.resize({ width: 160 }).toJPEG(72).toString('base64')}`; } catch { return null; } },
    trashItem: (p) => shell.trashItem(p), reveal: (p) => shell.showItemInFolder(p), open: (p) => shell.openPath(p),
    log: { read: () => store.get('driveLog') || [], write: (l) => { store.data.driveLog = l; store.save(); } }
  });
  cardPanel.onFile = (p) => ask.drive.openFile(p);
  cardPanel.onHolo = (id) => holos.openFromLibrary(id).then(() => cardPanel.hide()).catch(() => {});
  const externalDrag = new ExternalDrag({ bin: axBinPath(), allowed: () => systemPreferences.isTrustedAccessibilityClient?.(false) === true, enabled: () => store.get('settings.hands.appDragging') !== false, notify: m => ask.notice(m, 'failed') });
  hands = new HandControl({
    externalDrag,
    preview: !!store.get('settings.hands.preview'),
    sensitivity: () => store.get('settings.hands.margin') ?? 0.22,
    onThrow: (undo) => { lastThrown = undo; },
    shortcut: () => store.get('settings.hands.peaceShortcut') || 'listen',
    onShortcut: (choice) => {
      if (choice === 'home') openMain('home');
      else if (choice === 'timer5') { timers.add(300, 'Timer'); ask.notice('Five-minute timer started.', 'done'); }
      else if (choice === 'guide') handsCommand('help').catch(() => {});
      else if (choice === 'dashboard') handsCommand('dashboard').catch(() => {});
      else if (typeof choice === 'string' && choice.startsWith('routine:')) {
        const routine = (store.get('routines') || []).find(r => r.id === choice.slice(8));
        if (routine && ['idle', 'done'].includes(ask.state)) ask.handleText(routine.name).catch(() => {});
        else if (routine) ask.notice('Relay is busy. Try the gesture when the current request finishes.', 'failed');
      }
    },
    saveMargin: (margin) => { store.set('settings.hands.margin', margin); hands?.cam?.syncConfig?.(); broadcast(); },
    floatingAt: (pt) => {
      const panel = panelWins?.handTarget(pt);
      if (panel) {
        const spec = panelHub?.panels.get(panel.id)?.spec;
        if (spec) { const original = { ...spec }; const pos = panel.position(); panel.undo = async () => { const r = await panelHub.show(original); if (!r.ok) throw new Error(r.error); const win = panelWins.windows.get(r.id); if (win && !win.isDestroyed()) win.setPosition(pos.x, pos.y); }; }
        return panel;
      }
      const win = cardPanel?.win;
      if (!cardPanel?.visible || cardPanel.card?.hold || !win || win.isDestroyed() || !win.isVisible()) return null;
      const b = win.getBounds();
      if (pt.x < b.x || pt.y < b.y || pt.x > b.x + b.width || pt.y > b.y + b.height) return null;
      const savedCard = cardPanel.card; const pos = win.getBounds();
      return { key: 'answer-card', undo: async () => { await cardPanel.show(savedCard); if (cardPanel.win && !cardPanel.win.isDestroyed()) cardPanel.win.setPosition(pos.x, pos.y); }, position: () => win.getBounds(), move: (x, y) => { if (!win.isDestroyed()) win.setPosition(Math.round(x), Math.round(y)); }, close: () => cardPanel.hide() };
    },
    holos, display: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
    askAccess: async () => { const st = systemPreferences.getMediaAccessStatus?.('camera') ?? 'granted'; if (st === 'granted') return true; if (st === 'not-determined') return !!(await systemPreferences.askForMediaAccess('camera')); return false; },
    createCamera: async () => {
      // The camera window is hidden unless the hand view is on. The header can be dragged, but the view does not take keyboard focus.
      // It is kept out of Relay screenshots; the camera picture stays on this Mac.
      const W = 336, H = 300;
      const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, movable: true, resizable: false, skipTaskbar: true, type: 'panel', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setHiddenInMissionControl?.(true);
      win.setContentProtection(true);
      let shown = false;
      const sync = () => { if (win.isDestroyed()) return; win.webContents.send('hands:preview', shown); win.webContents.send('hands:config', { margin: store.get('settings.hands.margin') ?? 0.22 }); };
      win.on('moved', () => { if (shown && !win.isDestroyed()) { const [x, y] = win.getPosition(); store.set('settings.hands.previewPosition', { x, y }); } });
      win.webContents.on('did-finish-load', sync);
      win.loadFile(path.join(__dirname, '../renderer/hands.html'));
      return {
        close: () => { if (!win.isDestroyed()) win.close(); },
        setPreview: (on) => {
          if (win.isDestroyed()) return;
          shown = !!on;
          if (shown) { const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; const p = store.get('settings.hands.previewPosition'); const visible = p && Number.isFinite(p.x) && Number.isFinite(p.y) && screen.getAllDisplays().some(d => p.x >= d.workArea.x && p.y >= d.workArea.y && p.x + W <= d.workArea.x + d.workArea.width && p.y + H <= d.workArea.y + d.workArea.height); win.setBounds({ x: visible ? p.x : wa.x + wa.width - W - 12, y: visible ? p.y : wa.y + 6, width: W, height: H }); win.showInactive(); } else win.hide();
          sync();
        },
        syncConfig: sync,
        action: (a) => { if (shown && !win.isDestroyed()) win.webContents.send('hands:action', a); }
      };
    },
    createCursor: () => {
      const win = new BrowserWindow({ width: 56, height: 56, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, resizable: false, skipTaskbar: true, enableLargerThanScreen: true, type: 'panel' });
      win.setIgnoreMouseEvents(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setHiddenInMissionControl?.(true);
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body class="open" style="margin:0;background:transparent;overflow:hidden"><style>div{position:absolute;inset:10px;border-radius:50%;border:2px solid rgba(0,212,255,.9);box-shadow:0 0 14px rgba(0,212,255,.6);transition:all .12s}.held div{background:rgba(0,212,255,.35);inset:14px}.pinch div{inset:19px;background:rgba(0,212,255,.55)}.click div{inset:2px;opacity:.5}.mic div{inset:4px;box-shadow:0 0 26px rgba(0,212,255,.95)}</style><div></div></body>')}`);
      return { moveTo: (pt) => { if (!win.isDestroyed()) { if (!win.isVisible()) win.showInactive(); win.setPosition(Math.round(pt.x - 28), Math.round(pt.y - 28)); } }, hide: () => { if (!win.isDestroyed()) win.hide(); }, close: () => { if (!win.isDestroyed()) win.close(); }, setState: (c) => { if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.body.className=${JSON.stringify(String(c).replace(/[^a-z]/g, ''))}`).catch(() => {}); } };
    },
    air: (type, x, y) => overlay.air(type, x, y),
    shape: (r) => { const m = shapeToModel(r); if (m) holos.show({ title: m.title, items: [{ kind: 'shapes', title: m.title, credit: 'Drawn in the air', parts: m.parts }], x: Math.round(r.cx), y: Math.round(r.cy), scale: m.scale }).catch(() => {}); },
    onMic: (id) => ask.listenFromHand(id).catch(() => {}),
    notify: (m) => ask.notice(m, 'failed')
  });
  hands.onChange = () => { rebuildTray(); broadcast(); };
  presence = new PresenceControl({
    getConfig: () => store.get('settings.presence'),
    askAccess: async () => { const st = systemPreferences.getMediaAccessStatus?.('camera') ?? 'granted'; if (st === 'granted') return true; if (st === 'not-determined') return !!(await systemPreferences.askForMediaAccess('camera')); return false; },
    createCamera: async () => {
      const win = new BrowserWindow({ width: 320, height: 240, show: false, focusable: false, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
      win.loadFile(path.join(__dirname, '../renderer/presence.html'));
      return { close: () => { if (!win.isDestroyed()) win.close(); } };
    },
    onAway: () => ask.presenceAway(),
    onBack: () => ask.presenceBack(),
    notify: (m) => ask.notice(m, 'failed')
  });
  presence.onChange = broadcast;
  if (store.get('settings.presence.enabled')) presence.enable().then((r) => { if (!r.ok) store.set('settings.presence.enabled', false); broadcast(); });
  ask.onHands = handsCommand;
  if (store.get('settings.hands.enabled')) hands.enable().then((r) => { if (!r.ok) store.set('settings.hands.enabled', false); });
  holos.onChange = () => { rebuildTray(); ask.holosChanged(); };
  holos.onAsk = (h, d) => ask.askAboutHologram(h, d);
  holos.onAnnotate = (h, d) => ask.annotateByVoice(h, d);
  holos.onFiles = (h, paths) => ask.filesOnHologram(h, paths);
  ask.modelCache = new ModelCache(path.join(app.getPath('userData'), 'holo-cache'));
  holos.restore().catch(() => {}); // pinned holograms come back where they were (after the controller and the model cache exist)
  remote = new RemoteService({ store, ask, broadcast });
  remote.sync().then(broadcast);
  inbound = new InboundService({ store, ask, hub: ask.hub, exec: (file, args) => new Promise((res, rej) => execFile(file, args, { timeout: 8000, maxBuffer: 8e6 }, (e, out, err) => (e ? rej(new Error(String(err || e.message))) : res(out)))), send: (to, text) => ask.mac.messagesSend(to, text), flagOn: (n = 'imessage') => flagsMod.isOn(store.get('settings'), n), powerMonitor });
  ask.inbound = inbound;
  pluginMgr = new PluginManager({ store, root: path.join(app.getPath('home'), 'Relay', 'plugins'), onUse: () => { ask.tainted = true; }, sandbox: false });
  ask.plugins = pluginMgr;
  // Live panels
  panelWins = new PanelWindows({ preload: path.join(__dirname, 'preload.js') });
  let batteryNow = { present: false };
  let dashboardCalendar = { events: [], checked: false, updated: 0 }, dashboardBusy = false;
  const dashboard = () => {
    if (!dashboardBusy && Date.now() - dashboardCalendar.updated > 60000) {
      dashboardBusy = true;
      Promise.race([ask.mac.calendarEvents(1), new Promise((_, reject) => setTimeout(() => reject(new Error('calendar timeout')), 3000))])
        .then(text => { dashboardCalendar = { events: parseCalendar(text).filter(e => e.start >= Date.now()).sort((a, b) => a.start - b.start).slice(0, 3), checked: true, updated: Date.now() }; })
        .catch(() => { dashboardCalendar = { events: [], checked: false, updated: Date.now() }; }).finally(() => { dashboardBusy = false; });
    }
    return { tasks: (ask.tasks || []).filter(t => ['running', 'queued'].includes(t.status)).slice(0, 3).map(t => ({ text: String(t.text).slice(0, 80), status: t.status })), timers: timers.list().slice(0, 3).map(t => ({ label: t.label || 'Timer', seconds: timers.remainingSeconds(t) })), events: dashboardCalendar.events, calendarChecked: dashboardCalendar.checked, recent: (store.get('history') || []).slice(0, 3).map(h => ({ text: String(h.text || '').slice(0, 80), status: h.status })) };
  };
  const panelSampler = new Sampler({ os: require('os'), exec: (file, args) => new Promise((res, rej) => execFile(file, args, { timeout: 3000, maxBuffer: 4e6 }, (e, out) => (e ? rej(e) : res(String(out))))), jobs: () => (ask.tasks || []).map((t) => ({ text: t.text, status: t.status })), dashboard });
  panelHub = new PanelHub({
    sampler: panelSampler, callPlugin: (name, tool) => pluginMgr.call(name, tool, {}), getPlugins: () => pluginMgr.list(),
    openWindow: (p) => panelWins.open(p), approved: (h) => (store.get('panelsApproved') || []).includes(h), remember: (h) => store.set('panelsApproved', [...(store.get('panelsApproved') || []), h].slice(-100)),
    ask: async (text, spec) => (await dialog.showMessageBox({ type: 'question', buttons: ['Show the panel', 'Cancel'], defaultId: 1, cancelId: 1, message: `Show the panel "${spec.title}"?`, detail: text })).response === 0,
    lowPower: () => batteryNow.present && batteryNow.onBattery && batteryNow.percent < 20
  });
  setInterval(async () => { if (panelHub.panels.size) batteryNow = await panelSampler.sample('battery').catch(() => batteryNow); }, 60000);
  ask.panelHub = panelHub;
  ask.onLayout = async ({ type, name }) => {
    const layouts = store.get('panelLayouts') || [];
    if (type === 'save') {
      const panels = [...panelHub.panels.values()].map(p => ({ spec: p.spec, bounds: panelWins.windows.get(p.id)?.getBounds() })).filter(p => p.bounds);
      const { cleanSaved } = require('./holo/logic');
      const snapshot = holos.snapshot();
      const saved = cleanSaved(snapshot.map(x => ({ ...x.saved, pinned: x.pinned })), { anyPinned: true });
      if (!panels.length && !saved.length) return 'There are no restorable panels or holograms on screen.';
      store.set('panelLayouts', [{ name, panels, holos: saved, savedAt: Date.now() }, ...layouts].slice(0, 10));
      return `Saved layout ${name} with ${panels.length} panels and ${saved.length} holograms${snapshot.length > saved.length ? `; ${snapshot.length - saved.length} could not be saved` : ''}.`;
    }
    const layout = require('./panels/layout').findLayout(layouts, name);
    if (!layout) return `I do not have a saved layout named ${name}.`;
    let restored = 0, skipped = 0;
    const usedPanels = new Set();
    for (const item of layout.panels || []) {
      try {
        const hash = require('./panels/hub').hashOf(item.spec);
        let existing = [...panelHub.panels.values()].find(p => !usedPanels.has(p.id) && require('./panels/hub').hashOf(p.spec) === hash);
        if (!existing) { const r = await panelHub.show(item.spec); if (!r.ok) { skipped++; continue; } existing = panelHub.panels.get(r.id); }
        usedPanels.add(existing.id);
        const w = panelWins.windows.get(existing.id); const b = item.bounds;
        const valid = b && screen.getAllDisplays().some(d => b.x >= d.workArea.x && b.y >= d.workArea.y && b.x + 60 <= d.workArea.x + d.workArea.width && b.y + 60 <= d.workArea.y + d.workArea.height);
        if (w && !w.isDestroyed() && valid) w.setBounds(b);
        restored++;
      } catch { skipped++; }
    }
    const { cleanSaved } = require('./holo/logic');
    for (const saved of cleanSaved(layout.holos, { anyPinned: true })) {
      try { const existing = holos.get(saved.id); if (existing) { existing.x = saved.x; existing.y = saved.y; holos.place(existing); existing.win.webContents.send('holo:state', 'pos', holos.local(existing)); } else { if (holos.holos.size >= 6) { skipped++; continue; } await holos.restoreSaved(saved, { pinned: !!saved.pinned, id: saved.id }); } restored++; } catch { skipped++; }
    }
    holos.persist();
    return `Restored ${restored} items from ${name}${skipped ? `; ${skipped} could not be restored` : ''}.`;
  };

  // Speaking up on its own, and offline mode
  const alerts = new Alerts();
  const surface = (event) => {
    if (!flagsMod.isOn(store.get('settings'), 'proactive')) return;
    const o = store.get('settings.proactive') || {};
    const d = alerts.decide(event, { mode: o.mode, quiet: o.quiet, busy: !!ask.meeting?.active || ask.state === 'listening' || !!ask.speaker?.speaking, away: !!ask.lockWatch?.locked });
    if (d.how === 'drop') return;
    if (Notification.isSupported()) new Notification({ title: 'Relay', body: d.text, silent: d.how !== 'speak' || d.quiet }).show();
    if (d.how === 'speak') ask.speakText(d.text);
    if (d.phone) ask.phone?.send({ title: 'Relay', body: d.text }).catch(() => {});
  };
  ask.onProactive = surface;
  let tickN = 0;
  setInterval(async () => {
    if (!flagsMod.isOn(store.get('settings'), 'proactive')) return;
    const b = batteryEvent(await panelSampler.sample('battery').catch(() => null));
    if (b) surface(b);
    if (tickN++ % 5 === 0) { try { for (const e of calendarEvents(parseCalendar(await ask.mac.calendarEvents(1)))) surface(e); } catch { /* no calendar access: Doctor and Permissions say so */ } }
  }, 60000);
  connectivity = new Connectivity({
    probe: () => Promise.any(['https://api.anthropic.com', 'https://www.apple.com/library/test/success.html'].map((u) => fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(4000) }).then(() => true))).catch(() => false),
    onChange: (online) => { ask.offline = !online; broadcast(); }
  });
  setInterval(() => { if (flagsMod.isOn(store.get('settings'), 'offline')) connectivity.check(); else if (ask.offline) { ask.offline = false; connectivity.online = true; } }, 30000);

  // Ask my notes
  const embedBin = app.isPackaged ? path.join(process.resourcesPath, 'native', 'relay-embed') : path.join(__dirname, '../../native/build/relay-embed');
  notesSvc = new NotesService({
    store, root: path.join(app.getPath('home'), 'Relay', 'index'), embedBin: require('fs').existsSync(embedBin) ? embedBin : '',
    run: (file, args, input) => new Promise((res, rej) => { const c = execFile(file, args, { timeout: 60000, maxBuffer: 64e6 }, (e, out) => (e ? rej(Object.assign(e, { code: e.code })) : res(String(out)))); if (input !== undefined) { c.stdin.on('error', () => {}); c.stdin.end(input); } })
  });
  ask.notesService = notesSvc;
  // The macOS sandbox is used only if a trivial profile really starts on this Mac.
  execFile('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', '/usr/bin/true'], { timeout: 3000 }, (err) => { pluginMgr.sandbox = !err; });
  syncInbound();
  ask.onOpenRecap = () => openMain('recap');
  ask.onAgentDone = (a) => { if (Notification.isSupported() && a.status !== 'stopped') new Notification({ title: a.status === 'done' ? 'Agent finished' : 'Agent stopped with a problem', body: `${a.task.slice(0, 80)}: ${a.result.slice(0, 160)}`, silent: true }).show(); };
  setInterval(() => {
    const { due, missed } = ask.scheduler.tick(ask.canRunScheduled());
    for (const s of missed) if (Notification.isSupported()) new Notification({ title: 'Missed a scheduled request', body: `"${s.text}" was due while the Mac was asleep or Relay was closed. It will run next time.` }).show();
    for (const s of due) ask.runScheduled(s);
    if (due.length || missed.length) broadcast();
    // Each evening: say what Relay did today and what can be undone. Only when something changed or failed; a click opens the list.
    const rc = store.get('settings.recap');
    if (nightlyDue(rc)) {
      store.set('settings.recap.lastRun', dayKey(new Date()));
      const r = ask.recapData();
      if (!r.empty && (r.changed || r.failed) && Notification.isSupported()) {
        const n = new Notification({ title: 'Relay today', body: r.spoken.replace(/ The list is in History, under Actions\.$/, '') });
        n.on('click', () => openMain('recap'));
        n.show();
      }
    }
    // Each evening: look at Downloads and show where the new files would go. Only when Relay is free; it moves nothing without a yes.
    const dt = store.get('settings.downloadsTidy');
    if (nightlyDue(dt) && ask.canRunScheduled()) {
      store.set('settings.downloadsTidy.lastRun', dayKey(new Date()));
      ask.drive.proposeDownloads().then((r) => {
        if (r.moves && Notification.isSupported()) new Notification({ title: 'Downloads tidy-up', body: `${r.moves} ${r.moves === 1 ? 'file' : 'files'} in Downloads could be sorted. The plan is on screen: say “apply the plan” or “skip the plan”.`, silent: true }).show();
      }).catch(() => {});
    }
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
  hotkeys.onMouse = (down) => { holos?.mouseButton(down); overlay?.dropWatch(down); }; // a file dragged onto a hologram is accepted while the button is held over it

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
  ask.watchFront();
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
  try { ask.assistStop(); assistPanel?.destroy(); } catch {}
  recent?.stop();
  remote?.stop();
  holos?.persist?.();
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
