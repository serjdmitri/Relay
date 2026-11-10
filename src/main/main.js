// Keep a launch-provided phone key out of every child model/tool process.
const blandLaunchKey = process.env.BLAND_API_KEY || '';
delete process.env.BLAND_API_KEY;
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, clipboard, systemPreferences, Notification, nativeTheme, screen, powerMonitor, safeStorage, powerSaveBlocker } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./store');
const { DriveAccess } = require('./drive/access');
const { FileWorkspace } = require('./drive/workspace');
const { StorageWindow } = require('./storageWindow');
const { FitnessWindow } = require('./fitnessWindow');
const { NetworkWindow } = require('./networkWindow');
const { SecurityWindow } = require('./securityWindow');
const { PrioritiesWindow } = require('./prioritiesWindow');
const { AssignmentsWindow } = require('./assignmentsWindow');
const { AgentsWindow } = require('./agentsWindow');
const overnightMod = require('./overnight');
const { gatherFacts } = require('./auditFacts');
const securityAudit = require('./securityAudit');
const { Bland } = require('./calls/bland');
const { Twilio } = require('./calls/twilio');
const { Calls, quiet: callsQuiet } = require('./calls/service');
const { Hotkeys, withAuxiliaryShortcuts } = require('./hotkeys');
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
const { NotificationReader, importanceOf: notifyImportance, describe: describeNote } = require('./notifications');
const { MailWatch, toEvents: mailEvents, gmailQuery } = require('./mailWatch');
const { Connectivity } = require('./connectivity');
const welcome = require('./welcome');
const { newTopic } = require('./notify');
const { shapeToModel } = require('./hands/shape');
const { PresenceControl } = require('./presence');
const { CaptureLatch } = require('./captureLatch');
const { ViewerGuard, config } = require('./viewerGuard');
const { ProposalWorkspace } = require('./selfImprove');
const { OwnerGuard, authenticateOwner, acceptEnrollment, trustedFlags, learnFromAlarm, config: ownerConfig, addSample: addOwnerSample, sealTemplates, openTemplates } = require('./ownerGuard');
const { IntruderWindow } = require('./intruderWindow');
const { Stickies } = require('./stickies');
const { StickyPanel } = require('./stickyPanel');
const { HoloLibrary } = require('./holo/library');
const { nightlyDue, nightlyDay, dayKey, runNightlyProposal } = require('./drive/nightly');
const uiText = require('../renderer/ui-es');
const { AssistPanel } = require('./assistPanel');
const { LockWatch } = require('./lockState');
const { profileFor } = require('./voiceProfile');
const { KokoroVoice } = require('./tts/kokoro');
const { OmniVoice } = require('./tts/omnivoice');
const { Timers, humanDuration } = require('./timers');
const { Glass } = require('./glass');
const { RecentPanel } = require('./recent');
const { CardPanel } = require('./cards/manager');
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
const { registerNotionConnection } = require('./connectors/notionOAuth');
const { registerSchoolConnection } = require('./connectors/schoolConnection');
const { McpRemote } = require('./connectors/mcp');
const { registerGoogleConnections, publicGoogle } = require('./connectors/googleConnection');
const { Scheduler, describe: describeSchedule, parseScheduleCommand, missedMessage, acknowledgeUnknown, recordScheduledOutcome } = require('./schedule');
const perms = require('./permissions');
const { AnthropicProvider } = require('./agent/providers/anthropic');
const { OllamaProvider } = require('./agent/providers/ollama');
const { PRESETS, isPreset } = require('./agent/providers/presets');
const claudeCli = require('./agent/claudeCli');

app.setName('Relay');
if (!app.requestSingleInstanceLock()) app.quit();

let lastThrown = null;
function rememberThrow(undo) {
  lastThrown = undo;
  restoreToast?.offer(async () => { await undo(); if (lastThrown === undo) lastThrown = null; });
}
const ipcSecurity=require('./ipcSecurity');
ipcSecurity.protectIpc(ipcMain,path.join(__dirname,'../renderer'));
ipcSecurity.protectNavigation(app);
const diag = new (require('./diag').Diag)({ file: path.join(app.getPath('userData'), 'relay-diagnostics.log') }); // what Relay did about itself, on this Mac only (diag.js)
const captureLatch = new CaptureLatch({ onChange: (on) => { if (typeof ask !== 'undefined' && ask) ask.suspended = on; } }); // recording a shortcut pauses shortcuts and "Hey Jarvis", never for long
let standbyBlocker = null, applyModelProvider = null, enrollWin, intrudersWin, cameraWin, screenLocked = false, tellAboutVisits = () => {}, mapPanel, nightlyMaintenance, trustedPeople, presenceSender, modeActions, assistantBackdrop, fitnessPanel, callService, assignmentsPanel, agentsPanel, viewerGuard, ownerGuard, intruder, ownerState, prioritiesPanel, securityPanel, networkPanel, storagePanel, restoreToast, floatingMotion, trashTarget, presence, stickyPanel, store, bridge, overlay, ask, hotkeys, tray, speech, speaker, timers, glass, kokoro, recent, cardPanel, assistPanel, holos, remote, hands, inbound, pluginMgr, panelHub, panelWins, notesSvc, connectivity;
let prepareTimer = null;
let voiceProblem = ''; // why the chosen voice could not speak the last reply, if it could not
let claudeState = { installed: false, loggedIn: false, checked: false };
let speechInfo = { device: null, preparing: null, prepared: false, error: null };
// What the Doctor shows about startup: when it began, when it finished (the end of the main setup function), and any errors since.
const bootStartedAt = Date.now();
let bootDoneAt = 0;
const bootErrors = [];
const noteBootError = (kind, err) => { bootErrors.push({ at: Date.now(), kind, message: String((err && err.message) || err).slice(0, 200) }); if (bootErrors.length > 20) bootErrors.shift(); };
process.on('unhandledRejection', (r) => { noteBootError('rejection', r); console.error('Unhandled promise rejection:', (r && r.stack) || r); });
process.on('uncaughtExceptionMonitor', (e) => noteBootError('exception', e));
let mainWin = null;
let lastVoiceNotice = { key: '', at: 0 };
const { activateMainWindow, restoreDockPreference } = require('./mainWindowFocus');
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

// A window that shows nothing is worse than an error. If the main window's page crashed, failed to load, hung, or came up empty (after a Chromium helper process died, or
// the Mac woke up), load it again. Checked when the window is created, when it is shown again, and when the network helper restarts.
let healTimer = null;
function healMain(why) {
  if (!mainWin || mainWin.isDestroyed()) return;
  console.error('main window reloaded:', why);
  try { mainWin.webContents.reloadIgnoringCache(); } catch { /* going away */ }
}
async function checkMainPainted(why) {
  if (!mainWin || mainWin.isDestroyed()) return;
  try {
    const n = await Promise.race([mainWin.webContents.executeJavaScript('document.body ? document.body.innerText.trim().length : 0'), new Promise((r) => setTimeout(() => r(-1), 4000))]);
    if (!(n > 0)) healMain(`${why}: ${n < 0 ? 'the page did not answer' : 'the page was empty'}`);
  } catch (e) { healMain(`${why}: ${e && e.message}`); }
}

function openMain(page) {
  if (!mainWin || mainWin.isDestroyed()) {
    // vibrancy gives the sidebar the native macOS sidebar material, and follows the system's light or dark
    mainWin = new BrowserWindow({ ...windowOpts(820, 620), vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' });
    mainWin.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { page: page || 'home' } });
    mainWin.once('ready-to-show', () => { mainWin.show(); activateMainWindow({ app, win: mainWin }).catch(() => {}); });
    const wc = mainWin.webContents;
    wc.on('render-process-gone', (_e, d) => healMain(`the page's process ended (${d && d.reason})`));
    wc.on('did-fail-load', (_e, code, desc, _url, isMain) => { if (isMain && code !== -3) setTimeout(() => healMain(`the page failed to load (${desc})`), 800); });
    wc.on('unresponsive', () => { clearTimeout(healTimer); healTimer = setTimeout(() => healMain('the page stopped responding'), 6000); });
    wc.on('responsive', () => clearTimeout(healTimer));
    wc.once('did-finish-load', () => setTimeout(() => checkMainPainted('after loading'), 2500));
    mainWin.on('hide', () => { captureLatch.clear(); restoreDockPreference({ app, showInDock: store.get('settings.showInDock') }); });
    mainWin.on('blur', () => captureLatch.clear());
    wc.on('did-start-loading', () => captureLatch.clear());
    mainWin.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        mainWin.hide();
      }
    });
  } else {
    mainWin.show();
    activateMainWindow({ app, win: mainWin }).catch(() => {});
    if (page) mainWin.webContents.send('navigate', page);
    setTimeout(() => checkMainPainted('when shown again'), 1200);
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

const refreshStateUi = require('./coalesce').coalesce(() => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('state-changed');
  }
  holos?.refreshUi();
  rebuildTray();
});
function broadcast() {
  fitnessPanel?.syncPrivacy();
  refreshStateUi();
}

// What Settings shows about the quick lane: whether it has a key, and what it did today. Never the key.
function quickState() {
  const st = store.get('quickStats'), today = st && st.day === new Date().toDateString() ? st : { answered: 0, escalated: 0, failed: 0, ms: 0 };
  const own = !!decryptKey(store.get('settings.quick.keyEnc'));
  return { hasKey: !!ask?.quickLaneKey?.(), usingGroqService: !own && !!decryptKey(store.get('settings.model.presets.groq.keyEnc')), keyProblem: !!ask?.quickLane?.keyProblem, today: { answered: today.answered, escalated: today.escalated, failed: today.failed, avgMs: today.answered ? Math.round(today.ms / today.answered) : 0 } };
}

function publicState() {
  const { sessionNotes: _sessionNotes, ownerFace: _ownerFace, trustedFaces: _trustedFaces, intruderLog: _intruderLog, ...publicData } = store.data;
  const d = JSON.parse(JSON.stringify(publicData)); // session notes use protected Memory IPC, not broadcasts
  if (d.settings.calls) { delete d.settings.calls.keyEnc; delete d.settings.calls.twilioTokenEnc; }
  if (d.settings.quick) delete d.settings.quick.keyEnc;
  const hasKey = !!decryptKey(d.settings.model.anthropicKeyEnc);
  delete d.settings.model.anthropicKeyEnc;
  const hasTtsKeys = {};
  for (const id of ['openai', 'elevenlabs', 'gemini']) {
    hasTtsKeys[id] = !!decryptKey(d.settings.tts[id].keyEnc);
    delete d.settings.tts[id].keyEnc;
  }
  const hasHfToken = !!decryptKey(d.settings.hfTokenEnc);
  delete d.settings.hfTokenEnc;
  const cn = d.settings.connectors || {};
  const connectors = { notion: { connected: !!decryptKey(cn.notion?.tokenEnc), name: cn.notion?.name || '', clientId: cn.notion?.clientId || '', hasSecret: !!decryptKey(cn.notion?.clientSecretEnc) }, google: { ...publicGoogle(cn.google), hasSecret: !!decryptKey(cn.google?.clientSecretEnc) }, apps: { connected: !!(cn.apps?.url && decryptKey(cn.apps?.keyEnc)), url: cn.apps?.url ? (() => { try { return new URL(cn.apps.url).host; } catch { return ''; } })() : '', count: cn.apps?.count || 0, headerName: cn.apps?.headerName || 'x-api-key' } };
  delete d.settings.connectors;
  const hasKeys = {};
  for (const [id, s] of Object.entries(d.settings.model.presets)) {
    hasKeys[id] = !!decryptKey(s.keyEnc);
    delete s.keyEnc;
  }
  return {
    ...d,
    connectors,
    trustedPeople: trustedPeople?.list() || [],
    nightlyMaintenance: store.get('nightlyMaintenance') || null,
    remote: remote ? remote.info() : null,
    schedules: (d.schedules || []).map((s) => ({ ...s, when: describeSchedule(s) })),
    hasKey,
    hasKeys,
    calls: callService?.state(),
    quick: quickState(),
    hasTtsKeys,
    hasHfToken,
    activity: { state: ask?.state || 'idle', question: ask?.pendingConfirm ? ask.confirmQuestion || '' : '', tasks: ask?.taskList?.() || [], agents: ask?.agents?.view?.() || [] },
    providerUsage: require('./usage').providerSummaries(d.history, ask?.rate),
    handsInfo: { paused: !!hands?.paused, status: hands?.status || 'off', message: hands?.message || '' },
    presenceInfo: { status: presence?.status || 'off', message: presence?.message || '', state: presence?.state || 'unknown', faces: presence?.faces || 0 },
    voiceProblem,
    kokoro: kokoro.status(),
    presetInfo: PRESETS,
    history: d.history.filter((h) => h.status !== 'resolved').slice(0, 200),
    actions: (() => { const can = ask?.undos?.ids(); return d.actions.slice(0, 300).map((a) => (can && can.has(a.id) ? { ...a, undoable: true } : a)); })(),
    recap: ask?.recapData?.() || null,
    stats: store.stats(),
    labels: { ask: label(d.settings.shortcuts.ask), dictate: label(d.settings.shortcuts.dictate), type: label(d.settings.shortcuts.type), mark: label(d.settings.shortcuts.mark), handsPause: withAuxiliaryShortcuts(d.settings.shortcuts).handsPause ? label(withAuxiliaryShortcuts(d.settings.shortcuts).handsPause) : 'Not assigned' },
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
  } else { presence.disable(); viewerGuard?.reset(); ownerGuard?.reset(); intruder?.hide(); }
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
  if (cmd === 'undo') { if (!lastThrown) return 'There is no thrown item to restore.'; const undo = lastThrown; try { await undo(); if (lastThrown === undo) { lastThrown = null; restoreToast?.hide(); } return 'Restored the last thrown item.'; } catch { return 'I could not restore the thrown item.'; } }
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
    { label: 'Set Up Owner Recognition…', click: () => { Promise.resolve(ask.ownerCommand?.({ type: 'enroll' })).then((r) => { if (r?.status === 'failed') ask.notice(r.reply, 'failed'); }).catch((e) => ask.notice(e.message, 'failed')); } },
    { label: ask.agents.running().length ? `Stop ${ask.agents.running().length} Background Agent${ask.agents.running().length === 1 ? '' : 's'}` : 'No Background Agents', enabled: ask.agents.running().length > 0, click: () => ask.agents.stop() },
    { label: holos?.holos.size ? `Clear ${holos.holos.size} Hologram${holos.holos.size === 1 ? '' : 's'}` : 'No Holograms', enabled: !!holos?.holos.size, click: () => holos.closeAll() },
    { label: hands?.status === 'error' ? 'Hand control (camera): problem, click to retry' : 'Hand control (camera)', type: 'checkbox', checked: !!store.get('settings.hands.enabled') && hands?.status !== 'error', click: (item) => setHands(item.checked) },
    { label: 'Pause hand gestures', type: 'checkbox', checked: !!hands?.paused, enabled: !!hands?.enabled, click: item => hands.setPaused(item.checked) },
    { label: 'Show Hand View (top right)', type: 'checkbox', checked: !!store.get('settings.hands.preview'), enabled: !!store.get('settings.hands.enabled'), click: (item) => setHandsPreview(item.checked) },
    { label: 'Stop Speaking', enabled: !!speaker?.speaking, click: () => ask.interruptSpeech() },
    { label: 'Speak Last Reply', enabled: !!last, click: () => ask.speakLastReply() },
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
    else if (!mainWin || mainWin.isDestroyed() || !mainWin.isVisible()) app.dock.hide();
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

function calBinPath() {
  const p = app.isPackaged ? path.join(process.resourcesPath, 'native', 'relay-cal') : path.join(__dirname, '../../native/build/relay-cal');
  return require('fs').existsSync(p) ? p : null;
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
  const name=cfg.name||'Sir',greeting=welcome.greetingFor(Date.now(),name);
  const requestStamp=(store.get('history')||[])[0]?.id;
  let welcomeToken,heldByCard=false;
  const canDeliver=()=>welcome.canDeliverWelcome({locked:!!ask.lockWatch?.locked,meeting:!!ask.meeting?.active,state:ask.state})&&(store.get('history')||[])[0]?.id===requestStamp&&(!welcomeToken||overlay.hudState?.welcomeToken===welcomeToken);
  return welcome.deliverInStages({canDeliver,
    begin:()=>{
      if(cfg.show!==false){const shown=welcome.showWelcomeReactor(overlay,greeting,{duration:null});if(shown)welcomeToken=overlay.hudState.welcomeToken;}
      return cfg.speak!==false&&!ask.speaker?.speaking?ask.speakText(greeting,{quick:true}):undefined;
    },
    collect:async()=>{
      let facts;
      const [battery,briefing]=await Promise.all([
        new Promise(res=>execFile('/usr/bin/pmset',['-g','batt'],{timeout:1500},(e,out)=>res(e?null:require('./panels/sources').parseBattery(String(out))))),
        ask.briefingText({includeGreeting:false,onFacts:f=>{facts=f;}}).catch(()=>'')
      ]);
      return{day:(facts?.events||[]).filter(e=>e.start).map(e=>({...e,start:+e.start})),battery,briefing,facts};
    },
    finish:async({day,battery,briefing,facts})=>{
      const w=welcome.buildWelcome({name,lockedAt,now:Date.now(),history:store.get('history')||[],events:day,battery});
      const card=welcome.briefingCard(w,briefing,name,facts||{now:new Date(),missing:['briefing sources']});
      const showCard=cfg.show!==false&&card&&!cardPanel?.visible;
      if(showCard){if(welcomeToken)card.welcomeToken=welcomeToken;try{await cardPanel?.show(card);heldByCard=!!cardPanel;}catch{}}
      const details=[...w.priorities.slice(0,3).map(p=>p.text),briefing].filter(Boolean).join(' ');
      if(cfg.show!==false&&Notification.isSupported())new Notification({title:greeting,body:(card?.sections||[]).flatMap(s=>s.bullets).slice(0,3).join('\n')||'Your briefing is ready.',silent:true}).show();
      if(cfg.speak!==false&&details&&!ask.speaker?.speaking&&canDeliver())await ask.speakText(details);
    }
  }).finally(()=>{
    if(!welcomeToken)return;
    const hideReactor=()=>{if(overlay.hudState?.welcomeToken===welcomeToken)overlay.hud({hide:true});};
    if(!heldByCard)hideReactor();
    else{const t=setTimeout(hideReactor,60000);t.unref?.();} // the reactor goes when the card is dismissed; this is the backstop so it can never stay on screen
  });
}

function registerIpc() {
  const callKey = () => decryptKey(store.get('settings.calls.keyEnc')) || blandLaunchKey;
  const bland = new Bland({ getKey: callKey });
  const twilioCreds = () => { const c = store.get('settings.calls') || {}; return { sid: c.twilioSid, from: c.twilioFrom, voice: c.twilioVoice, token: decryptKey(c.twilioTokenEnc) }; };
  const twilio = new Twilio({ getCreds: twilioCreds });
  callService = new Calls({ store, api: bland, twilio, hasTwilio: () => { const c = twilioCreds(); return /^AC[0-9a-f]{32}$/i.test(c.sid || '') && !!c.from && !!c.token; }, hasKey: () => !!callKey(), privateMode: () => store.get('settings.model.provider') === 'ollama', onChange: broadcast, onReview: r => {
    if (callsQuiet(callService?.config() || {}, Date.now())) return;
    if (Notification.isSupported()) { const n = new Notification({ title: 'Jarvis call ready for review', body: 'Open Calls to review the number and purpose. No call has been placed.', silent: true }); n.on('click', () => openMain('calls')); n.show(); }
  } });
  const callIpc = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    if (!mainWin || e.sender !== mainWin.webContents) return { error: 'Open Relay Calls settings to use this control.' };
    try { return await fn(...args); } catch (err) { return { error: err.message }; }
  });
  callIpc('calls:state', () => callService.state());
  callIpc('calls:configure', raw => callService.configure(raw || {}));
  callIpc('calls:key', key => { if (typeof key !== 'string' || key.length > 4000) throw Error('Invalid key.'); store.set('settings.calls.keyEnc', key.trim() ? encryptKey(key.trim()) : ''); store.flush(); broadcast(); return { ok: true }; });
  callIpc('calls:twilio-token', token => { if (typeof token !== 'string' || token.length > 400) throw Error('Invalid token.'); store.set('settings.calls.twilioTokenEnc', token.trim() ? encryptKey(token.trim()) : ''); store.flush(); broadcast(); return { ok: true }; });
  callIpc('calls:test-twilio', () => { if (callService.privateMode()) throw Error('Phone call access is disabled in local/private mode.'); return twilio.check(); });
  const quickIpc = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    if (!mainWin || e.sender !== mainWin.webContents) return { error: 'Open Relay Settings to use this control.' };
    try { return await fn(...args); } catch (err) { return { error: err.message }; }
  });
  quickIpc('quick:key', key => { if (typeof key !== 'string' || key.length > 400) throw Error('Invalid key.'); store.set('settings.quick.keyEnc', key.trim() ? encryptKey(key.trim()) : ''); store.flush(); ask.lane().keyProblem = false; ask.lane().pausedUntil = 0; broadcast(); return { ok: true }; });
  quickIpc('quick:test', async () => { if (!ask.quickLaneKey()) throw Error('Add a Groq key first.'); const r = await ask.lane().test(); ask.lane().keyProblem = false; broadcast(); return r; });
  callIpc('calls:test', () => { if (callService.privateMode()) throw Error('Bland access is disabled in local/private mode.'); return bland.check(); });
  callIpc('calls:prepare', text => callService.prepare(text));
  callIpc('calls:approve', id => callService.approve(id, async preview => {
    const owner = mainWin;
    const r = await dialog.showMessageBox(owner, { type: 'warning', buttons: ['Yes, place this call', 'Cancel'], defaultId: 1, cancelId: 1, message: `Call ${preview.number} (your configured owner number)?`, detail: `Purpose: ${preview.purpose}\nVoice: ${preview.voice}. Maximum ${preview.minutes} minutes. Bland bills separately. The number and purpose will be shared with Bland. Recording is off, but the provider can retain call records/transcripts. No Mac actions will be executed from the conversation.` });
    return r.response === 0 && mainWin === owner && !owner.isDestroyed() && owner.isVisible();
  }));
  callIpc('calls:cancel', id => { callService.cancel(id); return { ok: true }; });
  callIpc('calls:refresh', id => callService.refresh(id));
  callIpc('calls:stop', id => callService.stop(id));
  callIpc('calls:report', id => callService.report(id));
  callIpc('calls:acknowledge', async id => {
    const r = await dialog.showMessageBox(mainWin, { type: 'warning', buttons: ['I checked Bland', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Have you reviewed this uncertain call in Bland?', detail: 'Relay cannot verify its outcome. This does not stop a provider-side call. Review and stop it in Bland first if needed; this call still counts against today’s limits.' });
    if (r.response !== 0) return { cancelled: true }; callService.acknowledge(id); return { ok: true };
  });
  callIpc('calls:schedule', raw => callService.addSchedule(raw || {}));
  callIpc('calls:remove-schedule', id => { callService.removeSchedule(id); return { ok: true }; });
  ask.onCallCommand = async command => {
    try {
      if (!command.background) openMain('calls');
      if (command.type === 'open') return { status: 'done', reply: 'Phone Calls is open, Sir.' };
      if (command.type === 'schedule') { callService.addSchedule(command.spec); return { status: 'done', reply: 'The check-in review is scheduled, Sir. At that time it will await approval of the exact number and purpose; it will not dial automatically.' }; }
      if (command.type === 'provider') {
        const st = callService.configure({ provider: command.provider });
        const missing = [];
        if (command.provider === 'twilio' && !st.hasTwilio) missing.push('your Twilio account SID, auth token and Twilio phone number');
        if (command.provider === 'bland' && !st.hasKey) missing.push('your Bland key');
        const what = command.provider === 'twilio' ? 'Twilio, the free-trial option: a one-way call that reads your message aloud in a British male voice (Brian)' : command.provider === 'bland' ? 'Bland, which holds a conversation' : 'Bland first, with Twilio as the backup';
        return { status: 'done', reply: `Calls now use ${what}, Sir.${missing.length ? ` It still needs ${missing.join(' and ')}, which only you can add in Calls settings, so no call will go out until then.` : ''}${command.provider === 'twilio' && st.hasTwilio ? ' A Twilio trial account can only call numbers you verified in Twilio, and the first thing you hear is its trial notice.' : ''}${(callService.schedules() || []).some((x) => x.automatic) ? ' Automatic check-ins stay paused until you recreate them, because they were authorized for the old provider.' : ''}` };
      }
      const result = await callService.requestOwnerCall(command.purpose, { background: command.background });
      if (result.error) return { status: 'failed', reply: result.error };
      const via = ({ twilio: 'Twilio', bland: 'Bland' })[callService.config().provider] || 'your calling provider';
      if (!result.review) return { status: 'done', reply: `Your call has been submitted to ${via}, Sir. Watch Calls for its status.` };
      return { status: 'done', reply: 'Your call is prepared, Sir. Review the number and purpose in Calls and approve the dialing prompt. No call has been placed.' };
    } catch (err) { return { status: 'failed', reply: err.message }; }
  };
  setInterval(() => callService.tick().catch(() => {}), 10000);
  const access = new DriveAccess({ store, home: os.homedir() });
  const workspace = new FileWorkspace({ access, store, move: (from, to) => ask.drive.move(from, to) });
  // Folder clutter: every few hours, look (names, sizes and dates only) at the folders you chose. A messy one where organization is on gets a quiet notification that
  // opens Files settings, where "Preview organization" shows where everything would go. Nothing is moved, and nothing is offered where organization is off.
  const fsx = require('fs'), clutterMod = require('./clutter'), { isProject: isCodeProject } = require('./drive/plan'), { planDownloads: planFolderMoves } = require('./drive/nightly');
  const clutterRun = () => clutterMod.evaluate(access.roots(), store.get('clutterState') || {}, { probe: (r) => access.probe(r), fs: fsx, planMovable: (d) => { try { return planFolderMoves({ fs: fsx, home: d, folder: d, limit: 150 }).raw.moves.length; } catch { return null; } }, isProject: (d) => isCodeProject(d, fsx) });
  const clutterCheck = () => {
    try {
      if ((store.get('settings.clutter') || {}).enabled === false) return;
      const { results, state } = clutterRun();
      if (require('./proactive').inQuiet((store.get('settings.proactive') || {}).quiet, new Date())) return; // not now; nothing is recorded, so it is told after quiet hours
      store.set('clutterState', state);
      for (const r of results.filter((x) => x.notify)) if (Notification.isSupported()) { const n = new Notification({ title: 'A folder is getting cluttered', body: `${clutterMod.describe(r.name, r.assessment)}. Open Files settings to preview where everything would go. Nothing moves without your yes.`, silent: true }); n.on('click', () => openMain('permissions')); n.show(); }
    } catch (e) { console.error('Clutter check failed:', e); }
  };
  setTimeout(clutterCheck, 120000); setInterval(clutterCheck, 6 * 3600e3);
  ask.clutterNames = () => access.roots().map((r) => path.basename(r.path));
  ask.clutterCommand = (c) => {
    const { results } = clutterRun();
    if (c.type === 'check') {
      if (!results.length) return 'You have not chosen any folders for Relay yet. Add some in Files settings and I will watch them for clutter.';
      return results.map((r) => r.skipped ? `${r.name}: ${r.skipped}` : r.assessment.level === 'tidy' ? `${r.name}: tidy (${r.assessment.loose} loose file${r.assessment.loose === 1 ? '' : 's'}).` : `${clutterMod.describe(r.name, r.assessment)}.${r.offer ? ' A preview is available in Files settings.' : r.root.mode !== 'organize' ? ' Turn on organization for it in Files settings to get a preview.' : ''}`).join('\n');
    }
    const r = results.find((x) => x.name === c.name);
    if (!r || r.skipped) return `${c.name}: ${r?.skipped || 'I could not find that folder.'}`;
    openMain('permissions');
    if (r.root.mode !== 'organize') return `Organization is not turned on for ${c.name}. I opened Files settings; turn it on there and press Preview organization.`;
    if (r.assessment.movable === 0) return `There is nothing in ${c.name} that I could sort right now.`;
    return `I opened Files settings. Under ${c.name}, press Preview organization to see where everything would go. Nothing moves until you apply it, and you can undo it afterwards.`;
  };
  storagePanel = new StorageWindow({ access, motion: floatingMotion, reveal: p => shell.showItemInFolder(p), settings: () => openMain('permissions') });
  ask.trashStorageSelection = async () => {
    const r=await storagePanel.trashSelected();
    return {status:r.cancelled?'stopped':r.error||r.failed?.length&&!r.count?'failed':'done',reply:r.cancelled?'Cancelled. No files were moved.':r.error||`I moved ${r.count} selected files to Trash, Sir.${r.failed?.length?` ${r.failed.length} could not be moved; check the storage menu.`:''}`,actions:r.count||0};
  };
  const godsEyeServer=new(require('./godsEyeServer').GodsEyeServer)({configFile:path.join(app.getPath('userData'),'gods-eye-runtime.json')});
  app.once('before-quit',()=>godsEyeServer.stop());
  mapPanel=new(require('./mapWindow').MapWindow)({store,motion:floatingMotion,server:godsEyeServer,onWorldView:on=>overlay.setWorldView(on)});
  ask.runWorldCommand=async(command,signal)=>{try{return require('./worldCommands').worldReply(command,await mapPanel.command(command,{signal}));}catch(e){return {status:signal?.aborted?'stopped':'failed',reply:signal?.aborted?'Stopped, Sir.':e.message,actions:0};}};
  ask.openWorldMap=kind=>{try{mapPanel.open(kind);return {status:'done',reply:kind==='godseye'?'Your God’s Eye workspace is opening, Sir. The local engine will start automatically.':'Your Argos Atlas map is open, Sir.',actions:1};}catch(e){return {status:'failed',reply:e.message,actions:0};}};
  fitnessPanel = new FitnessWindow({store, motion:floatingMotion, getApi:()=>ask.googleApiIfConnected(), openSettings:()=>openMain('connectors')});
  ask.openFitness = () => {fitnessPanel.open();return {status:'done',reply:'Your Fitbit stats menu is open, Sir. Connect Fitbit / Google Health in Connections if needed.',actions:1};};
  networkPanel = new NetworkWindow({ store, motion: floatingMotion });
  ask.openNetworkRadar = () => { networkPanel.open(); return { status: 'done', reply: 'Your network radar is open, Sir. It shows cached neighbors and local security checks.', actions: 1 }; };
  securityPanel = new SecurityWindow({
    version: app.getVersion(), motion: floatingMotion,
    gather: () => gatherFacts({
      store, perms, safeStorage, home: app.getPath('home'), fullDisk: () => fullDisk() === true, flagOn: (n) => flagsMod.isOn(store.get('settings'), n), plugins: pluginMgr,
      phoneInfo: () => remote ? { ...remote.info(), pairingActive: !!remote.pairing?.active?.() } : null,
      textsInfo: () => ({ on: flagsMod.isOn(store.get('settings'), 'imessage'), paired: !!inbound?.status?.().paired })
    })
  });
  ask.auditRun = async () => { const r = await securityPanel.run(true); securityPanel.open(); return `${securityAudit.summarize(r)} The full list is open on screen.`; };
  prioritiesPanel = new PrioritiesWindow({
    motion: floatingMotion,
    facts: () => ask.briefingFacts({ includeGreeting: false }),
    schoolUrl: () => store.get('settings.briefing.schoolUrl') || '',
    openTarget: ({ app: name, url }) => name ? new Promise((resolve, reject) => execFile('/usr/bin/open', ['-a', name], { timeout: 5000 }, (err) => (err ? reject(new Error(`Could not open ${name}.`)) : resolve()))) : shell.openExternal(url)
  });
  ask.openPriorities = () => { prioritiesPanel.open(); return { status: 'done', reply: "Your priorities are open, Sir. I'm checking your calendar, reminders, school and email now.", actions: 1 }; };
  assignmentsPanel = new AssignmentsWindow({
    motion: floatingMotion,
    check: () => ask.schoolAssignments(),
    cache: { get: () => store.get('schoolCache') || null, set: (v) => { store.set('schoolCache', v); } },
    openSource: () => require('./school').openSchoolPage(bridge, store.get('settings.briefing.schoolUrl'))
  });
  agentsPanel = new AgentsWindow({ motion: floatingMotion, agents: ask.agents, start: (task) => { const r = ask.agents.submit(task); if (r.started) ask.sound?.('Tink'); return r; } });
  ask.openAgentsDashboard = () => { agentsPanel.open(); return { status: 'done', reply: 'Your agents dashboard is open, Sir. Type several jobs, one per line, to run them together; you can cancel any of them from there.', actions: 1 }; };
  ask.openAssignments = () => { assignmentsPanel.open(); return { status: 'done', reply: 'Your assignment dashboard is open, Sir. It shows the last school check; press Refresh to read the page again.', actions: 1 }; };
  ask.securityWatchSet = (on) => { store.set('settings.securityWatch.enabled', !!on); return on ? 'Security warnings are on. I will tell you when something new needs attention.' : 'Security warnings are off. You can still ask me for a security audit.'; };
  ask.openStorageMap = () => { storagePanel.open({ scan: true }); return { status: 'done', reply: 'Your interactive storage map is open, Sir.', actions: 1 }; };
  const filesIpc = (channel, run) => ipcMain.handle(channel, async (e, ...args) => {
    if (!mainWin || e.sender !== mainWin.webContents) return { error: 'Open Relay Settings to use file access controls.' };
    try { return await run(...args); } catch (err) { return { error: err.message }; }
  });
  filesIpc('files:storage', () => { storagePanel.open(); return { ok: true }; });
  filesIpc('files:preview', id => workspace.preview(id));
  filesIpc('files:apply', id => workspace.apply(id));
  filesIpc('files:undo', id => workspace.undo(id));
  filesIpc('files:history', id => workspace.history(id));
  filesIpc('files:access', () => access.status());
  filesIpc('files:choose', async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Choose a folder for the file workspace', properties: ['openDirectory'] });
    return r.canceled ? access.status() : access.add(r.filePaths[0]);
  });
  filesIpc('files:mode', (id, mode) => access.mode(id, mode));
  filesIpc('files:remove', id => access.remove(id));
  assistantBackdrop=require('./assistantBackdrop').registerBackdrop({ipcMain,dialog,nativeImage,dir:app.getPath('userData'),getWindow:()=>mainWin,onChange:()=>{overlay.refreshHudBlur();broadcast();}});
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
  modeActions=new(require('./workModes').WorkModeActions)({store,openApp:name=>ask.mac.openApp(name),queueRoutine:r=>setImmediate(()=>ask.handleText('run '+r.name).catch(e=>ask.notice(e.message,'failed'))),onChange:()=>{ask.dropWarm(true);broadcast();}});
  ask.applyWorkMode=mode=>modeActions.apply(mode);
  // "Go offline" / "go online" by voice (localMode.js): the same switch as the Settings picker, with the same side effects.
  applyModelProvider = (value) => { if (value === 'ollama') { googleConnections.cancel(); notionConnection.cancel(); } store.set('settings.model.provider', value); ask.dropWarm(true); if (value === 'ollama') { speaker?.stop(); mapPanel?.close(); } broadcast(); };
  ipcMain.handle('state:set', async (_e, key, value) => {
    if(!ipcSecurity.safeKey(key)) throw Error('Invalid setting path.');
    if(_e.sender!==mainWin?.webContents && _e.sender!==onboardWin?.webContents) throw Error('Open Relay Settings first.');
    if(ownerConfig(store.get('settings.owner')).enabled && (key==='settings.presence'||key==='settings.presence.enabled') && (key==='settings.presence'?value?.enabled!==true:value!==true)) await trustedPeople.authorize();
    if(key==='settings.owner'||key.startsWith('settings.owner.')) throw Error('Use authenticated owner-recognition controls.');

    if(key==='settings.workMode'){if(_e.sender!==mainWin?.webContents)throw Error('Open General settings first.');return modeActions.apply(value);}
    if (key === 'settings.memory' && value === false) ask.sessionNotes?.stop();
    if (key === 'settings.model.provider' && value === 'ollama') { googleConnections.cancel(); notionConnection.cancel(); }
    if (key === 'settings.calls' || key.startsWith('settings.calls.')) throw Error('Use Calls settings to change calling permissions.');
    if (key === 'settings.driveRoots' || key.startsWith('settings.driveRoots.')) throw new Error('Use the folder chooser for file access.');
    if (!key.startsWith('settings.')) throw new Error('Only settings can be set this way.');
    store.set(key, value);
    applyDockAndLogin();
    if (key === 'settings.buddy' || key === 'settings.cursor') { overlay.applyMode(); rebuildTray(); }
    if (key === 'settings.assistantBlur' || key === 'settings.assistantBlurStrength') overlay.refreshHudBlur();
    if (key === 'settings.language.ui') rebuildTray();
    if (key === 'settings.workMode') ask.dropWarm(true);
    if (key === 'settings.sentient.enabled' || key === 'settings.memory' || key === 'settings.model.provider') ask.dropWarm(true);
    if (key === 'settings.memory' && value === false) ask.sessionNotes?.stop();
    if (key === 'settings.model.provider' && value === 'ollama') {speaker?.stop();mapPanel?.close();}
    if(key==='settings.hands.maxHands'&&hands?.enabled){hands.disable();hands.enable().catch(e=>ask.notice(e.message,'failed'));}
    if (key === 'settings.hands.margin') hands?.cam?.syncConfig?.();
    if ((key === 'settings.hands.pinchClick' || key === 'settings.hands.tabNumbers') && hands?.enabled && value !== false) hands.externalDrag?.start();
    if (key === 'settings.hands.appDragging' && hands?.enabled) { if (value === false) { hands.release(); hands.peer?.release(); hands.externalDrag?.close(); } else hands.externalDrag?.start(); }
    if (key === 'settings.meeting.hidden') assistPanel?.protect();
    if (key === 'settings.presence.enabled') setPresence(!!value);
    if (key === 'settings.wake.apps') { ask.watchFront(); ask.wake.refresh(); }
    if (key === 'settings.wake.enabled' || key === 'settings.wake.phrase' || key === 'settings.wake.mode') { ask.wake.refresh(); ask.wake.disarm(); ask.wake.refresh(); rebuildTray(); }
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
        ? new OllamaProvider({ url: m.ollamaUrl, model: m.ollamaModel, ensure: ask.ensureOllama })
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
    if (!['openai', 'elevenlabs', 'gemini'].includes(engine)) return;
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
    if (/^https:\/\/(platform\.openai\.com|elevenlabs\.io|aistudio\.google\.com)\//.test(String(url))) shell.openExternal(String(url));
  });
  ipcMain.handle('window:focus-main', async (event) => {
    if (!mainWin || mainWin.isDestroyed() || event.sender !== mainWin.webContents) return;
    await activateMainWindow({ app, win: mainWin });
  });
  // Glance remains a separate application and manages its own enrollment and credentials.
  ipcMain.handle('glance:open', async () => {
    const target = '/Applications/Glance.app';
    if (!require('fs').existsSync(target)) return { ok: false, message: 'Glance is not installed in Applications.' };
    const error = await shell.openPath(target);
    return error ? { ok: false, message: 'Could not open Glance. Open it from Applications.' } : { ok: true };
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
    const ollamaStatus = offlineOn ? await (async () => {
      try {
        const provider = new OllamaProvider({ url: store.get('settings.model.ollamaUrl'), model: store.get('settings.model.ollamaModel') });
        const response = await fetch(`${provider.url}/api/tags`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
        if (!response.ok) return { ollama: false, modelInstalled: null };
        const data = await response.json();
        const normalize = (name) => { const n = String(name || '').trim(); return n.includes(':') ? n : `${n}:latest`; };
        const modelInstalled = Array.isArray(data.models) ? data.models.some((m) => normalize(m.name || m.model) === normalize(provider.model)) : null;
        return { ollama: true, modelInstalled };
      } catch { return { ollama: false, modelInstalled: null }; }
    })() : { ollama: null, modelInstalled: null };
    const free = await new Promise((res) => execFile('/bin/df', ['-m', app.getPath('userData')], { timeout: 2000 }, (e, out) => res(e ? null : doctor.parseFreeMb(out))));
    const firewall = await new Promise((res) => execFile('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate'], { timeout: 2000 }, (e, out) => res(e ? null : doctor.parseFirewall(out))));
    const filevault = await new Promise((res) => execFile('/usr/bin/fdesetup', ['status'], { timeout: 2000 }, (e, out) => res(e ? 'unknown' : doctor.parseFileVault(out))));
    return {
      claude: () => claudeState, codex: () => ask.codexInfo ? { ...ask.codexInfo, checked: true } : { checked: false },
      failoverOn: () => store.get('settings.failover.codex') !== false,
      perms: () => perms.status(), signing: () => st, remote: () => remote?.info(),
      handsEnabled: () => !!store.get('settings.hands.enabled'), presenceEnabled: () => !!store.get('settings.presence.enabled'), browser: () => ({ connected: bridge.isConnected() }),
      hotkeys: () => ({ running: hotkeys.running, error: hotkeys.error }), speech: () => ({ available: speech.available, voiceProblem }),
      storeInfo: () => ({ freeMb: free }), firewall: () => firewall, filevault: () => filevault,
      recentErrors: () => store.get('actions').filter((a) => a.ok === false && Date.now() - a.ts < 86400e3).map((a) => ({ tool: a.tool, error: typeof a.result === 'string' ? a.result : '' })),
      toolMisses: () => ({ on: flagsMod.isOn(store.get('settings'), 'toolCategories'), recent: (store.get('toolMisses') || []).filter((x) => Date.now() - x.ts < 86400e3) }),
      offline: () => ({ on: offlineOn, online: connectivity ? connectivity.online : null, ...ollamaStatus }),
      notes: () => ({ on: flagsMod.isOn(store.get('settings'), 'folderQa'), folders: notesSvc?.status() || [], noEmbed: !!notesSvc?.noEmbed }),
      plugins: () => ({ on: flagsMod.isOn(store.get('settings'), 'plugins'), list: pluginMgr?.list() || [], sandbox: !!pluginMgr?.sandbox }),
      imessage: () => ({ on: flagsMod.isOn(store.get('settings'), 'imessage'), fullDisk: fullDisk(), ...(inbound?.status() || {}) }),
      startup: () => ({ startedAt: bootStartedAt, completedAt: bootDoneAt, errors: bootErrors.slice(-5) }),
      keychain: () => { try { return { available: !!safeStorage.isEncryptionAvailable() }; } catch { return { available: null }; } },
      lastFailure: () => ask?.lastFailure || null,
      voice: () => ({ engine: store.get('settings.tts.engine'), problem: voiceProblem }),
      owner: () => { const c = ownerConfig(store.get('settings.owner')); return { enabled: c.enabled, enrolled: (ownerState?.templates?.length || 0) > 0, cameraRunning: presence?.status === 'running', armed: !!ownerGuard?.armed, lastScore: ownerGuard?.lastScore ?? null, threshold: c.threshold, liveness: c.liveness }; },
      ollamaLive: () => require('./hybridSearch').ollamaStatus({ get: (u) => ask.httpGet(u, true) }),
      gh: () => new Promise((res) => execFile('gh', ['auth', 'status'], { timeout: 3000, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` } }, (e, _o, errOut) => res(e && e.code === 'ENOENT' ? { installed: false } : { installed: true, signedIn: !e }))),
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
    return { results: out, summary: doctor.summarize(results), worst: doctor.worst(results), meta, report: doctor.buildReport(results, meta, { home: app.getPath('home') }), fixMode: mode, fullDisk: fullDisk() };
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
  const notionConnection = registerNotionConnection({ ipcMain, store, encryptKey, decryptKey, dialog, shell, getWindow: () => mainWin, onChange: broadcast, privateMode: () => store.get('settings.model.provider') === 'ollama' });
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
  const googleConnections = registerGoogleConnections({ macCalendars: () => ask.mac.calendarSources(), ipcMain, store, encryptKey, decryptKey, dialog, shell, getWindow: () => mainWin, onChange: broadcast, getApi: () => ask.googleApiIfConnected(), resetApi: () => { ask.googleApi = null; } });
  registerSchoolConnection({ ipcMain, store, getWindow: () => mainWin, getBridge: () => bridge, openFirefox: url => new Promise((resolve, reject) => execFile('/usr/bin/open', ['-a', 'Firefox', url], { timeout: 5000 }, e => e ? reject(e) : resolve())), checkAssignments: () => ask.handleText('check my assignments'), onChange: broadcast });
  ask.sessionNotes = require('./sessionNotes').registerSessionNotes({ ipcMain, store, getWindow: () => mainWin, onChange: broadcast, exportDir: () => path.join(app.getPath('desktop'), 'memory'), confirmDelete: async () => (await dialog.showMessageBox(mainWin, { type: 'warning', message: 'Delete these local session notes?', detail: 'Existing History entries, export files and Sentient OS notes are separate and will remain.', buttons: ['Delete session', 'Cancel'], defaultId: 1, cancelId: 1 })).response === 0, openMemory: () => openMain('memory'), showMatches: (sessions, query) => cardPanel.show({ kind: 'list', hold: true, title: 'Session notes: ' + query, summary: 'Local conversation notes; requests and replies are not independently verified facts.', items: sessions.map(s => ({ title: s.title, subtitle: new Date(s.created).toLocaleString(), note: s.entries.filter(e => (e.request + ' ' + e.reply).toLowerCase().includes(query.toLowerCase())).slice(0, 2).map(e => e.request + ': ' + e.reply).join('\n').slice(0, 1500) })), facts: [], links: [] }) });

  // Relay Remote: the phone page, served by Relay on this Mac.
  ipcMain.handle('remote:set', async (_e, patch) => {
    for (const [k, v] of Object.entries(patch || {})) if (['enabled', 'lan'].includes(k)) store.set(`settings.remote.${k}`, !!v);
    await remote.sync();
    broadcast();
  });
  ipcMain.handle('remote:pair', async () => { await remote.sync(); return remote.server ? remote.pair() : { error: remote.error || 'Turn Relay Remote on first.' }; });
  ipcMain.handle('remote:shortcut', async () => { await remote.sync(); if (!remote.server) return { error: remote.error || 'Turn Relay Remote on first.' }; const k = remote.shortcutKey(); broadcast(); return k; });
  ipcMain.handle('remote:remove', (_e, id) => { remote.devices.remove(id); remote.server?.revokeDevice(id); broadcast(); });
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
  ipcMain.handle('presence:frame', (e, f) => {
    if (e.sender !== presenceSender) return;
    presence?.frame(f);
    if (!presence?.enabled) return;
    const faces = Number(f?.faces) || 0, arr = (v) => (Array.isArray(v) ? v.slice(0, 5) : []);
    const scores = arr(f?.scores), live = arr(f?.live);
    // a recognised trusted person is neither you nor a stranger: they are not counted as an extra viewer, and they do not start the alarm
    const trusted = trustedFlags({ scores, trustedScores: arr(f?.trustedScores), live, threshold: ownerConfig(store.get('settings.owner')).threshold });
    viewerGuard?.frame({ ...(f || {}), faces: Math.max(0, faces - trusted.filter(Boolean).length) });
    ownerGuard?.frame({ faces, scores, live, trusted, down: f?.down === true });
  });
  ipcMain.handle('presence:status', (e, st) => {
    if(e.sender!==presenceSender) return;
    if (st?.state === 'faceid-error') { ask.notice(String(st.message || 'Owner recognition could not start.').slice(0, 200), 'failed'); return; }
    presence?.setStatus(st);
  });
  // Owner recognition: the camera page asks what to do (match faces, or enroll yours) and gets your saved numbers only when they changed. Only the camera page may ask.
  const fromCameraPage = (e) => e.sender === presenceSender && /\/presence\.html$/.test(String(e.senderFrame?.url || '').split(/[?#]/)[0]);
  ipcMain.handle('presence:config', (e, have) => {
    if (!fromCameraPage(e) || !ownerState) return { faceId: false };
    const enrolling = !!ownerState.enroll && Date.now() < ownerState.enroll.until;
    const faceId = enrolling || (ownerConfig(store.get('settings.owner')).enabled && ownerState.templates.length > 0);
    const out = { faceId, mode: enrolling ? 'enroll' : 'watch', version: ownerState.version, liveness: ownerConfig(store.get('settings.owner')).liveness, pace: faceId && !enrolling ? ownerGuard?.pace?.() || 1000 : 1000 };
    if (faceId && have !== ownerState.version) { out.templates = [...ownerState.templates]; out.trusted = trustedPeople?.templates() || []; } // kept apart: a trusted person is not you
    return out;
  });
  ipcMain.handle('presence:enroll', (e, s) => {
    const en = ownerState?.enroll;
    if (!fromCameraPage(e) || !en || Date.now() > en.until) return { ok: false };
    const r = addOwnerSample(en.samples, s?.embedding);
    if (r.added) { en.samples = r.samples; if (en.samples.length === 4 || en.samples.length === 7) ask.notice(`Good, ${en.samples.length} angles so far. Keep turning your head slowly, and tilt it a little.`, 'done'); }
    const n = en.samples.length, secs = (Date.now() - en.start) / 1000;
    if (n >= 8 || (n >= 4 && secs >= 45)) {
      ownerState.enroll = null;
      if (!(en.name ? (()=>{ try { trustedPeople.save(en.name,en.samples); return true; } catch { return false; } })() : ownerState.save(en.samples))) { ask.notice('Your face could not be saved: this Mac cannot encrypt it right now.', 'failed'); return { ok: false }; }
      store.set('settings.owner', { ...ownerConfig(store.get('settings.owner')), enabled: true });
      ownerGuard.reset(); broadcast();
      ask.notice(`${en.name || "Your face"} is enrolled (${n} angles) and owner recognition is on. If someone else sits down, I will sound the alarm and lock after ${ownerConfig(store.get('settings.owner')).seconds} seconds. Say "test the access denied screen" to see it.`, 'done');
      return { ok: true, done: true };
    }
    return { ok: true, count: n };
  });
  ipcMain.handle('owner:trusted', async (e, action, value) => {
    if(e.sender!==mainWin?.webContents || !trustedPeople) return {error:'Open Relay Settings to manage trusted people.'};
    try {
      if(action==='cancel') { ownerState.enroll=null; broadcast(); return {ok:true}; }
      if(action==='remove') await trustedPeople.remove(String(value));
      else if(action==='enroll') {
        const name=trustedPeople.name(value);
        if(!ownerState.templates.length) throw Error('Enroll your own face first with “enroll my face”.');
        await trustedPeople.authorize();
        if(!safeStorage.isEncryptionAvailable()) throw Error('Encrypted storage is unavailable.');
        store.set('settings.presence.enabled',true); await setPresence(true);
        enrollWin.open({name});
        ask.notice(`Adding ${name}: only that person should face the camera in the setup window, then turn their head toward each part of the ring.`, 'done');
      } else throw Error('Unknown profile action.');
      broadcast(); return {ok:true};
    } catch(err) { return {error:err.message}; }
  });
  ipcMain.handle('hands:set', (_e, on) => setHands(!!on));
  ipcMain.handle('hands:preview', (_e, on) => { setHandsPreview(!!on); return { ok: true }; });
  ipcMain.handle('hands:frame', (_e, f) => { hands?.frame(f); });
  ipcMain.handle('hands:status', (_e, st) => { hands?.setStatus(st); });
  ipcMain.handle('card:close', (e) => cardPanel?.forSender(e.sender)?.hide());
  ipcMain.handle('card:action', (e, action) => cardPanel?.action(e.sender, action));
  ipcMain.handle('card:open', (e, url) => cardPanel?.forSender(e.sender)?.open(url));
  ipcMain.handle('card:size', (e, h) => cardPanel?.forSender(e.sender)?.setSize(h));
  ipcMain.handle('card:hover', (e, on) => cardPanel?.forSender(e.sender)?.setHover(on));
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
  ipcMain.handle('history:acknowledge-unknown', (_e, id) => {
    const ok = acknowledgeUnknown(store, id, ask?.activeScheduledId);
    if (ok) broadcast();
    return { ok };
  });

  ipcMain.handle('shortcut:set', (_e, name, def) => {
    if (!['ask', 'dictate', 'type', 'mark'].includes(name)) return;
    store.set(`settings.shortcuts.${name}`, def);
    broadcast();
  });
  // While the user is recording a new shortcut, existing ones must not fire.
  ipcMain.handle('shortcut:capturing', (_e, on) => { captureLatch.set(!!on); });
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

  ipcMain.handle('assistant:activate', async (_e, action) => {
    if (!['show','talk','type'].includes(action)) throw Error('Unknown assistant action.');
    if (!['idle','done','input'].includes(ask.state)) return {error:'Finish or stop the current request first.'};
    mainWin?.hide();
    if (action === 'show') {
      if (ask.state !== 'idle') ask.close();
      ask.reactorIdle = true;
      overlay.hud({state:'reactor-idle',idlePosition:store.get('settings.reactorIdlePosition') === 'corner' ? 'corner' : 'center'});
    } else if (action === 'type') await ask.open({typed:true});
    else await ask.listen('ask',false,{auto:store.get('settings.autoSend.enabled') !== false});
    return {ok:true};
  });
  ipcMain.handle('ask:open', async (_e, text) => {
    await ask.open();
    if (text) await ask.submit(text);
  });
  ipcMain.handle('recent:ask', async (_e, text) => {
    recent?.close();
    await require('./recent').repeatRecent(ask, text);
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
  ipcMain.handle('camera:hover', (_e, on) => cameraWin?.hover(!!on)); // the full-screen camera listens to the mouse only while the pointer is over its control bar
}

function startBridge() {
  bridge.stop();
  const fx = store.get('settings.firefox');
  bridge.port = fx.port;
  if (fx.enabled) bridge.start();
}

// If Chromium's network helper dies and restarts, a window that was already open can end up empty: check the main window shortly after.
app.on('child-process-gone', (_e, d) => { if (d && /network/i.test(`${d.name || ''} ${d.serviceName || ''}`)) setTimeout(() => checkMainPainted('after the network helper restarted'), 2500); });
app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), { onError: code => diag.log('settings-save-failed', code) });
  bridge = new FirefoxBridge({ port: store.get('settings.firefox.port') });
  bridge.on('status', () => broadcast());
  bridge.on('error', (e) => console.error('Firefox bridge:', e.message));
  overlay = new Overlay({ isEnabled: () => store.get('settings.cursor'), isBuddy: () => store.get('settings.buddy') !== false, getName: () => store.get('settings.assistantName') || 'J.A.R.V.I.S', getVisual: () => store.get('settings.assistantVisual'), getBorder: () => store.get('settings.assistantBorder'), getBlur: () => store.get('settings.assistantBlur'), getBackdrop:()=>({opacity:store.get('settings.assistantBlurStrength')??.7,image:assistantBackdrop?.image||''}), getLook: () => store.get('settings.look') || 'jarvis', getRecentRect: () => recent?.rect, borderBin: axBinPath() });
  overlay.watchDisplays();
  restoreToast = new (require('./restoreToast').RestoreToast)(path.join(__dirname, 'preload.js'));
  trashTarget = new (require('./trashTarget').TrashTarget)(path.join(__dirname, 'preload.js'));
  floatingMotion = new (require('./floatingMotion').FloatingMotion)({ area: point => screen.getDisplayNearestPoint(point).bounds, workArea: point => screen.getDisplayNearestPoint(point).workArea, getSnap: () => store.get('settings.menuSnap') !== false, cursor: () => screen.getCursorScreenPoint(), onZone: states => trashTarget.render(states), onThrow: rememberThrow });
  app.once('before-quit', () => { floatingMotion.stop(); trashTarget.close(); restoreToast.close(); });
  recent = new RecentPanel({ getEnabled: () => store.get('settings.recent') !== false, getDwell: () => store.get('settings.recentDelay'), preload: path.join(__dirname, 'preload.js') });
  recent.start();
  cardPanel = new CardPanel({ motion: floatingMotion, preload: path.join(__dirname, 'preload.js'), getHold: () => store.get('settings.answerStays') !== false, getLayouts: () => store.get('menuLayouts') || {}, saveLayouts: layouts => store.set('menuLayouts', layouts) });
  cardPanel.onRefresh = (card, units) => require('./forecast').forecast(card.location, { units, signal: AbortSignal.timeout(10000) });
  cardPanel.onUnitsChange = units => { store.set('settings.briefing.units', units); broadcast(); };
  cardPanel.onDismiss = (card) => { if (card.welcomeToken && overlay.hudState?.welcomeToken === card.welcomeToken) overlay.hud({ hide: true }); };
  assistPanel = new AssistPanel({ preload: path.join(__dirname, 'preload.js'), getHidden: () => store.get('settings.meeting.hidden') !== false });
  holos = new HoloManager({ motion: floatingMotion,
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
  const omni = new OmniVoice({ python: path.join(app.getPath('userData'), 'omnivoice', 'venv', 'bin', 'python'), worker: app.isPackaged ? path.join(process.resourcesPath, 'native', 'omni-worker.py') : path.join(__dirname, 'tts', 'omni-worker.py') });
  app.once('before-quit', () => omni.stop());
  setTimeout(() => { if (store.get('settings.tts.engine') === 'omnivoice') omni.warm().catch(() => {}); }, 3000).unref?.(); // load the voice now, not when the first reply needs it
  speaker = new Speaker({
    kokoro, omni, phraseCacheDir:path.join(app.getPath('userData'),'voices','fixed-phrases'),
    getLocalOnly: () => store.get('settings.model.provider') === 'ollama' || (!!ask?.offline && flagsMod.isOn(store.get('settings'), 'offline')),
    getTts: () => {
      const t = store.get('settings.tts');
      return { engine: t.engine, kokoro: t.kokoro, openai: { ...t.openai, key: t.engine==='openai'?decryptKey(t.openai.keyEnc):'' }, elevenlabs: { ...t.elevenlabs, key: t.engine==='elevenlabs'?decryptKey(t.elevenlabs.keyEnc):'' }, gemini: { ...t.gemini, key: t.engine==='gemini'?decryptKey(t.gemini?.keyEnc):'' } };
    },
    // a better voice failed: say so in plain words (once per problem per ten minutes), so a silent reply is never a mystery
    onProblem: (m) => {
      voiceProblem = m; broadcast();
      const now = Date.now(), key = String(m).slice(0, 80);
      if (key === lastVoiceNotice.key && now - lastVoiceNotice.at < 600000) return;
      lastVoiceNotice = { key, at: now };
      try { ask?.notice(require('./failureMessage').explainVoiceFailure(m, { engine: store.get('settings.tts.engine') }), 'failed'); } catch { /* the notice is a convenience */ }
    }
  });
  speaker.prepare(profileFor('quiet', store.get('settings') || {}));
  const prepareGreeting=async()=>{const profile=profileFor('reply',store.get('settings')||{}),name=store.get('settings.welcome.name')||'Sir';for(const text of new Set([welcome.greetingFor(Date.now(),name),...['morning','afternoon','evening','night'].map(part=>`Good ${part}, ${name}.`)]))await speaker.prepare({...profile,text});};
  prepareGreeting();
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
  ask = new AskController({ store, bridge, overlay, speech, speaker, timers, glass, axBin: axBinPath(), calBin: calBinPath(), onChange: broadcast });
  ask.memoryExport = (fact) => require('./memoryExport').exportMemory(path.join(app.getPath('desktop'), 'memory'), fact);
  ask.outputExport = (title, text) => require('./memoryExport').exportOutput(path.join(app.getPath('desktop'), 'memory'), title, text);
  // Review a session's notes and keep only the facts you tick: saved as Relay memories, or exported to a file. Nothing happens until you press a button.
  ipcMain.handle('notes:review', async (e, action, value) => {
    if (!mainWin || e.sender !== mainWin.webContents) return { error: 'Open Memory on this Mac.' };
    try {
      const R = require('./sessionReview'), session = (ask.sessionNotes?.items() || []).find((s) => s.id === String(value?.id || ''));
      if (!session) throw Error('Session not found.');
      if (action === 'suggest') return { suggestions: R.suggest(session) };
      if (action !== 'save' && action !== 'export') throw Error('Unknown review action.');
      if (action === 'save' && store.get('settings.memory') === false) throw Error('Memory is switched off. Turn it on to save memories.');
      const { ok, rejected } = R.validatePicks(session, value?.picks);
      if (!ok.length) return { error: rejected[0]?.why || 'Tick at least one line.', rejected };
      if (action === 'export') return { file: ask.outputExport(`Session facts: ${session.title}`, R.exportText(session, ok)), count: ok.length, rejected };
      const r = R.saveFacts(store.get('memories') || [], ok, { id: () => require('crypto').randomUUID() });
      for (const f of r.added) if (ask.memoryExport) f.exportPending = true;
      if (r.added.length) store.set('memories', r.list);
      let exportFailed = 0;
      for (const f of r.added) if (ask.memoryExport) { try { ask.memoryExport(f.text); delete f.exportPending; } catch { exportFailed++; } }
      if (r.added.length) { store.set('memories', r.list); broadcast(); }
      return { added: r.added.map((f) => f.text), skipped: r.skipped, rejected, exportFailed };
    } catch (err) { return { error: err.message }; }
  });
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
  // Overnight tasks: work you handed Relay for the night runs unattended inside the overnight window, one at a time; in the morning a report says what was checked, what was only reported, what failed and what needed you.
  ask.overnight = new overnightMod.OvernightQueue({ store, settings: () => store.get('settings.overnight') });
  const clip = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const runOvernightTask = async (task, { signal } = {}) => {
    signal?.throwIfAborted();
    const runId = ask.overnight.begin(task);
    store.addHistory({ id: runId, text: `Overnight: ${task.text}`, status: 'unknown', reply: 'Started or interrupted; the outcome has not been confirmed.', ts: Date.now(), finishedAt: Date.now() });
    ask.activeScheduledId = runId;
    const blocker = powerSaveBlocker.start('prevent-app-suspension'); // the Mac may dim its screen, but does not stop Relay midway
    let result; const cancelled=()=>{if(ask.activeScheduledId===runId)ask.stop();};
    signal?.addEventListener('abort',cancelled,{once:true});
    try { signal?.throwIfAborted(); result = await ask.runScheduled({ text: task.text }); } catch (e) { result = { status: 'failed', reply: e.message }; }
    finally { signal?.removeEventListener('abort',cancelled); powerSaveBlocker.stop(blocker); if (ask.activeScheduledId === runId) ask.activeScheduledId = null; }
    recordScheduledOutcome(store, runId, result);
    const actions = (store.get('actions') || []).filter((a) => a.requestId === runId);
    const v = overnightMod.verifyRun(result || {}, actions, { exists: (p) => require('fs').existsSync(p), home: app.getPath('home') });
    const fresh = ask.overnight.list().find((t) => t.id === task.id) || task;
    ask.overnight.update(task.id, { status: result?.status === 'done' ? 'done' : result?.status === 'stopped' ? 'stopped' : 'failed', verdict: v.verdict, checks: v.checks, notes: v.notes, reply: clip(result?.reply), finishedAt: Date.now(), attempts: ask.overnight.endAttempt(fresh, result?.status || 'unknown') });
    broadcast();
  };
  const overnightReport = (ids) => {
    const tasks = ask.overnight.list().filter((t) => ids.includes(t.id));
    const win = overnightMod.windowBounds(new Date(), ask.overnight.conf());
    const routines = (store.get('history') || []).filter((h) => /^(?:scheduled|missed):/.test(String(h.id)) && h.ts >= win.start && h.ts <= win.end + 2 * 3600e3).map((h) => ({ text: h.text, status: h.status })).reverse();
    const report = overnightMod.buildReport(tasks, routines);
    const maintenance=store.get('nightlyMaintenance');if(maintenance)report.text+='\n\nNightly maintenance ('+maintenance.status+'):\n'+maintenance.text;
    try { ask.outputExport('Overnight report', report.text); } catch { /* the report is still kept in Relay and can be read by voice */ }
    ask.overnight.markReported(tasks, report);
    if (Notification.isSupported()) new Notification({ title: 'Overnight report', body: report.summary.charAt(0).toUpperCase() + report.summary.slice(1) + '. Say "what happened overnight" to hear it.', silent: true }).show();
    broadcast();
  };
  // The overnight wake (wakeScheduler.js): schedule a wake for the start of the overnight window, and hold the Mac awake while overnight work runs, then let it sleep again.
  const runCmd = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 15000 }, (e, out) => res({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(out || '') })));
  const wake = new (require('./wakeScheduler').WakeScheduler)({ exec: runCmd, spawnDetached: (c, a) => { try { require('child_process').spawn(c, a, { detached: true, stdio: 'ignore' }).unref(); } catch { /* no watchdog: Relay still restores sleep itself */ } }, store, diag, settings: () => store.get('settings.overnightWake'), window: () => ask.overnight.conf(), dir: app.getPath('userData') });
  setTimeout(() => wake.recover().then(() => wake.arm()).catch(() => {}), 20000).unref?.();
  setInterval(() => wake.arm().catch(() => {}), 3600000).unref?.();
  app.on('before-quit', () => { // quitting Relay mid-hold: put sleep back now (the watchdog is the backstop)
    if (!wake.holding) return;
    wake.holding = false;
    try { const restored=require('child_process').spawnSync('/usr/bin/sudo', ['-n', '/usr/bin/pmset', '-a', 'disablesleep', wake.state().prev ? '1' : '0'], { timeout: 5000, stdio: 'ignore' }); if(restored.status===0){wake.save({ holding: false });require('fs').rmSync(wake.hb,{force:true});} } catch { /* recover() runs next start */ }
  });
  let overnightBusy = false;
  const overnightTick = async () => {
    if (overnightBusy) return;
    overnightBusy = true;
    try {
      const st = ask.overnight.next({ canRun: ask.canRunScheduled(), activeRunId: ask.activeScheduledId });
      let changed = false;
      for (const t of st.interrupted) { ask.overnight.interrupt(t, (store.get('actions') || []).filter((a) => a.requestId === t.runId)); changed = true; }
      if (st.skip.length) { ask.overnight.skip(st.skip, 'The Mac was asleep, or Relay was busy or closed, for the whole overnight window, so it was not run.'); changed = true; }
      if (st.run) { await wake.withAwake(context => runOvernightTask(st.run,context), 'night list'); changed = true; }
      const conf=ask.overnight.conf(), now=new Date(), key=String(overnightMod.windowBounds(now,conf).start);
      if(!changed && !ask.overnight.queued().length && ask.canRunScheduled() && conf.enabled && overnightMod.inWindow(now,conf)) {
        if(store.get('overnightPlannedKey')!==key){
          store.set('overnightPlannedKey',key);
          const planned=String(store.get('settings.overnight.planned')||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,3);
          for(const task of planned)ask.overnight.add(task);
          changed=planned.length>0;
        }
        if(!changed && nightlyMaintenance) { const wantNight = !!store.get('settings.selfImprove.nightly') && store.get('nightlyMaintenance')?.key !== key; changed = await (wantNight ? wake.withAwake(context => nightlyMaintenance.run(key,context), 'overnight improvement') : nightlyMaintenance.run(key)); }
      }
      if (!changed && st.report) overnightReport(st.report);
    } catch (e) { console.error('Overnight tick failed:', e); } finally { overnightBusy = false; }
  };
  setInterval(overnightTick, 30000);
  // The scheduled wake has just fired: keep the Mac up for a few minutes (it would otherwise doze again within a minute) and start the night's work at once instead of at the next tick.
  powerMonitor.on('resume', () => {
    if (!store.get('settings.overnightWake.enabled')) return;
    wake.arm().catch(() => {});
    if (overnightMod.inWindow(new Date(), ask.overnight.conf())) { const b = powerSaveBlocker.start('prevent-app-suspension'); setTimeout(() => powerSaveBlocker.stop(b), 180000).unref?.(); setTimeout(() => overnightTick().catch(() => {}), 3000); }
  });
  ask.overnightCommand = (c) => {
    const conf = ask.overnight.conf(), window = `${conf.from === 0 ? 12 : conf.from > 12 ? conf.from - 12 : conf.from} ${conf.from < 12 ? 'AM' : 'PM'} and ${conf.to === 0 ? 12 : conf.to > 12 ? conf.to - 12 : conf.to} ${conf.to < 12 ? 'AM' : 'PM'}`;
    if (c.type === 'add') {
      const r = ask.overnight.add(c.task);
      if (r.error) return r.error;
      return `Added to tonight's list (${ask.overnight.queued().length} queued): ${r.task.text}. ${conf.enabled ? `It runs between ${window}, only if the Mac is awake and Relay is open, and nobody can approve questions then, so anything risky is skipped. I'll report in the morning.` : 'Overnight tasks are switched off in Settings, so nothing runs until you turn them on.'}`;
    }
    if (c.type === 'list') { const q = ask.overnight.queued(); return q.length ? `Tonight's list: ${q.map((t, i) => `${i + 1}. ${t.text}`).join('; ')}.` : "Tonight's list is empty."; }
    if (c.type === 'clear') { const n = ask.overnight.clear(); return n ? `Cleared ${n} task${n === 1 ? '' : 's'} from tonight's list.` : "Tonight's list was already empty."; }
    if (c.type === 'cancel') { const t = ask.overnight.cancel(c.n); return t ? `Removed "${t.text}" from tonight's list.` : `There is no task ${c.n} on tonight's list.`; }
    const r = (store.get('overnight') || {}).report;
    return r ? `Last night: ${r.summary}.\n\n${r.text}` : 'There is no overnight report yet.';
  };
  // "Set up the overnight wake" / "turn on the overnight wake": see wakeScheduler.js. Relay never types your password: setup is one command you paste into Terminal.
  ask.wakeCommand = async (c) => {
    const ws = require('./wakeScheduler'), done = (reply, actions = 1) => ({ status: 'done', reply, actions });
    const cfg = store.get('settings.overnightWake') || {}, set = (patch) => { store.set('settings.overnightWake', { ...cfg, ...patch }); broadcast(); };
    const conf = ask.overnight.conf(), hour = `${conf.from === 0 ? 12 : conf.from > 12 ? conf.from - 12 : conf.from} ${conf.from < 12 ? 'AM' : 'PM'}`;
    if (c.type === 'wake-setup') {
      const cmd = ws.setupCommand(require('os').userInfo().username);
      if (!cmd) return done('I could not read your Mac user name safely, so I have not made the setup command.', 0);
      clipboard.writeText(cmd);
      return done('I copied one command to your clipboard. Open Terminal, paste it, press Return and type your Mac password when it asks. It lets Relay schedule a wake and keep the Mac awake while it works, and it allows only four exact power commands, nothing else. Then say "turn on the overnight wake".', 0);
    }
    if (c.type === 'wake-remove') { set({ enabled: false }); await wake.disarm(); clipboard.writeText(ws.removeCommand()); return done('The overnight wake is off and its wake is cancelled. To remove the permission too, paste the command I copied into Terminal.', 0); }
    if (c.type === 'wake-off') { set({ enabled: false }); await wake.disarm(); return done('Overnight wake is off. The Mac will sleep as usual and overnight work only runs if it happens to be awake.'); }
    if (c.type === 'wake-on') {
      set({ enabled: true });
      if (!(await wake.ready())) return done('Overnight wake is on, but the one-time permission is missing. Say "set up the overnight wake" and I will give you the command to paste into Terminal.', 0);
      const r = await wake.arm();
      return done(r.armed ? `Done. I will wake the Mac at ${hour} every night, hold it awake while the overnight work runs, and let it sleep again after. It needs to be plugged in (say so if you want it on battery too) and Relay must be open. Your own 8 AM wake is not touched.` : 'The permission is there but macOS would not take the wake. Say "what is the wake status" and I will check.');
    }
    const s = await wake.status(), p = await wake.power();
    return done(`Overnight wake is ${s.enabled ? 'on' : 'off'}. ${s.ready ? 'The one-time permission is in place.' : 'The one-time permission is missing: say "set up the overnight wake".'} ${s.armed ? `Next wake: ${s.armed}.` : 'No wake is scheduled.'} ${p.ac ? 'The Mac is plugged in.' : `The Mac is on battery${p.percent !== null ? ` at ${p.percent}%` : ''}, so it will not be held awake${s.battery ? ' below 50%' : ''}.`}`, 0);
  };
  let scheduleStorageFailed = false;
  const tickSchedules = (canRun) => {
    try {
      const result = ask.scheduler.tick(canRun);
      scheduleStorageFailed = false;
      return result;
    } catch (error) {
      console.error('Could not save scheduled request state:', error);
      if (!scheduleStorageFailed && Notification.isSupported()) new Notification({ title: 'Scheduled requests paused', body: 'Relay could not save scheduled request state. Check available disk space and access to Relay’s data folder.' }).show();
      scheduleStorageFailed = true;
      return { due: [], missed: [] };
    }
  };
  const notifyMissedSchedules = (missed) => {
    for (const s of missed) {
      const message = missedMessage(s);
      if (Notification.isSupported()) new Notification({ title: 'Missed a scheduled request', body: message }).show();
    }
  };
  ask.cardPanel = cardPanel;
  ask.assistPanel = assistPanel;
  // Is the Mac locked: the phone page shows it as a padlock. macOS tells us when it locks and unlocks; a slow check catches the rest.
  const lockWatch = new LockWatch({ exec: (cmd, args) => new Promise((resolve, reject) => require('child_process').execFile(cmd, args, { timeout: 4000 }, (e, out) => (e ? reject(e) : resolve(String(out))))), onChange: () => ask.statusChanged() });
  ask.lockWatch = lockWatch;
  let lockedAt = 0;
  let lastWelcome = 0;
  // After the Mac wakes (the lid was closed) the camera stream is often dead: start the camera again, so recognition and the standby screen see you and not a frozen picture.
  powerMonitor.on('resume', () => { diag.log('resume', 'the Mac woke'); try { overlay?.renewIdle(); } catch { /* the old windows stay */ } reviveListening('after wake'); });
  // The camera that watches who is at the Mac. It is started again whenever it is wanted but not delivering pictures: after the lid, after unlocking, when its page gave up, or when it never came back.
  const cameraWanted = () => !!store.get('settings.presence.enabled') || (ownerConfig(store.get('settings.owner')).enabled && (ownerState?.templates?.length || 0) > 0);
  let reviving = false;
  const revivePresence = async (why) => {
    try {
      if (reviving || screenLocked || !presence || !cameraWanted() || presence.healthy() || presence.pending) return;
      reviving = true;
      presence.disable();
      await new Promise((r) => setTimeout(r, 1500));
      const r = await presence.enable();
      diag.log(r.ok ? 'camera-restarted' : 'camera-failed', why + (r.ok ? '' : ': ' + String(r.error || '').slice(0, 80)));
      broadcast();
    } catch (e) { diag.log('camera-failed', why + ': ' + String(e.message).slice(0, 80)); } finally { reviving = false; }
  };
  // Right after the lid opens the camera is often not ready yet: look again a few times, and stop as soon as it is delivering pictures.
  const reviveSoon = (why) => { for (const s of [3, 10, 25, 60]) setTimeout(() => revivePresence(why), s * 1000).unref?.(); };
  powerMonitor.on('resume', () => reviveSoon('after wake'));
  powerMonitor.on('lock-screen', () => { diag.log('lock-screen'); lockedAt = Date.now(); screenLocked = true; lockWatch.set(true); prepareGreeting(); });
  powerMonitor.on('unlock-screen', () => {
    try { overlay?.renewIdle(); } catch { /* the old windows stay */ } // windows that sat hidden through the lock can come back blank: start from fresh ones
    // You have just unlocked the Mac with your password or fingerprint: that is you. A guard screen still up, or an alarm still counting, comes down, and the mouse is handed back.
    diag.log('unlock-screen'); reviveListening('after unlock'); reviveSoon('after unlock');
    try { if (ownerGuard?.state === 'alarm') ownerGuard.clear('owner'); intruder?.hide(); overlay?.releaseInput(); } catch { /* the screens stay */ }
    screenLocked = false; setTimeout(() => tellAboutVisits(), 1500).unref?.(); // you have just unlocked it: now is when to say who was at the Mac
    lockWatch.set(false);
    // Process overdue work before gathering the briefing; fresh due work stays queued for the regular timer.
    const { missed } = tickSchedules(false);
    notifyMissedSchedules(missed);
    if (missed.length) broadcast();
    welcomeBack(lockedAt, lastWelcome).then((did) => { if (did) lastWelcome = Date.now(); }).catch(() => {});
    lockedAt = 0;
  });
  lockWatch.refresh();
  setInterval(() => { if (store.get('settings.remote.enabled')) lockWatch.refresh(); }, 8000);
  ask.holos = holos;
  ask.stickies = new Stickies({ storage: { get: (k) => store.get(k), set: (k, v) => { store.data[k] = v; store.save(); } } });
  stickyPanel = new StickyPanel({ motion: floatingMotion, stickies: ask.stickies, preload: path.join(__dirname, 'preload.js') });
  stickyPanel.sync(); // the stickies you left are still there
  ask.drive = new Drive({
    fs: require('fs'), home: os.homedir(), cards: cardPanel,
    move: (from, to) => {
      const bin = app.isPackaged ? path.join(process.resourcesPath, 'native', 'relay-move') : path.join(__dirname, '../../native/build/relay-move');
      return new Promise((resolve, reject) => execFile(bin, [from, to], { timeout: 10000, maxBuffer: 4096 }, error => {
        if (!error) return resolve();
        reject(new Error(error.code === 17 ? 'Something appeared at the destination.' : 'Safe file moving could not be confirmed; check both locations.'));
      }));
    },
    exec: (file, args) => new Promise((res) => execFile(file, args, { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => res(out || ''))),
    thumb: async (p) => { try { const img = await nativeImage.createThumbnailFromPath(p, { width: 220, height: 220 }); return img.isEmpty() ? null : `data:image/jpeg;base64,${img.resize({ width: 160 }).toJPEG(72).toString('base64')}`; } catch { return null; } },
    trashItem: (p) => shell.trashItem(p), reveal: (p) => shell.showItemInFolder(p), open: (p) => shell.openPath(p),
    log: { read: () => store.get('driveLog') || [], write: (l) => { store.data.driveLog = l; store.save(); } }
  });
  cardPanel.onFile = (p) => ask.drive.openFile(p);
  cardPanel.onHolo = (id) => holos.openFromLibrary(id).then(() => cardPanel.hide()).catch(() => {});
  const externalDrag = new ExternalDrag({ bin: axBinPath(), allowed: () => systemPreferences.isTrustedAccessibilityClient?.(false) === true, enabled: () => store.get('settings.hands.appDragging') !== false, wanted: () => store.get('settings.hands.pinchClick') !== false || store.get('settings.hands.tabNumbers') !== false,
    front: () => new Promise((res) => execFile('/usr/bin/lsappinfo', ['front'], { timeout: 1500 }, (e, asn) => { if (e) return res(null); execFile('/usr/bin/lsappinfo', ['info', '-only', 'bundleid', String(asn).trim()], { timeout: 1500 }, (e2, out) => res(e2 ? null : (/bundleID="([^"]+)"/.exec(String(out)) || [])[1] || null)); })),
    pressTab: (n) => new Promise((res, rej) => execFile('/usr/bin/osascript', ['-e', `tell application "System Events" to keystroke "${n}" using command down`], { timeout: 4000 }, (e, _o, err) => (e ? rej(new Error(String(err || e.message))) : res()))),
    log: (k, m) => diag.log(k, m), notify: m => ask.notice(m, 'failed') });
  // A middle finger held up to the camera shows a hologram of one near your hand (a see-through, click-through window); it fades out when you put your hand down.
  let fingerWin = null, fingerReady = null, fingerTimer = 0;
  const fingerHolo = (e) => {
    try {
      const W = 240, H = 340;
      const alive = () => fingerWin && !fingerWin.isDestroyed();
      const cls = (c) => { if (alive()) fingerReady.then(() => { if (alive()) fingerWin.webContents.executeJavaScript(`document.body.className=${JSON.stringify(c)}`).catch(() => {}); }); };
      clearTimeout(fingerTimer);
      if (e.type === 'hide') { if (!alive()) return; cls(''); fingerTimer = setTimeout(() => { if (alive()) fingerWin.hide(); }, 450); return; }
      if (!alive()) {
        fingerWin = new BrowserWindow({ width: W, height: H, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, resizable: false, skipTaskbar: true, enableLargerThanScreen: true, type: 'panel' });
        fingerWin.setIgnoreMouseEvents(true);
        fingerWin.setAlwaysOnTop(true, 'screen-saver');
        fingerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        fingerWin.setHiddenInMissionControl?.(true);
        const win = fingerWin;
        fingerReady = new Promise((r) => win.webContents.once('did-finish-load', r));
        win.loadFile(path.join(__dirname, '../renderer/finger.html'));
      }
      const b = screen.getDisplayNearestPoint({ x: Math.round(e.x), y: Math.round(e.y) }).bounds;
      const x = Math.max(b.x, Math.min(b.x + b.width - W, Math.round(e.x - W / 2)));
      const y = Math.max(b.y, Math.min(b.y + b.height - H, Math.round(e.y - H / 2)));
      fingerWin.setBounds({ x, y, width: W, height: H });
      if (e.type === 'show' || !fingerWin.isVisible()) { fingerWin.showInactive(); cls('on'); }
    } catch { /* the hologram is only for fun */ }
  };
  hands = new HandControl({ motion: floatingMotion,
    onFinger: fingerHolo,
    pinchClick: () => store.get('settings.hands.pinchClick') !== false,
    extraGestures: () => store.get('settings.hands.extraGestures') !== false,
    airScroll: () => store.get('settings.hands.airScroll') !== false,
    // volume of the Mac: 'get' -> 0..100, 'set', n
    onVolume: (op, n) => new Promise((res, rej) => execFile('/usr/bin/osascript', ['-e', op === 'get' ? 'output volume of (get volume settings)' : `set volume output volume ${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}`], { timeout: 3000 }, (e, out) => (e ? rej(e) : res(op === 'get' ? Number(String(out).trim()) : true)))),
    // a swipe with nothing of Relay's under the hand: the app in front decides (browser: next or previous tab; Music or Spotify: next or previous track; slides: next or previous slide)
    appSwipe: async (dir) => {
      const apps = require('./hands/apps');
      const script = apps.scriptFor(apps.swipeAction(await hands.externalDrag.front(), dir));
      if (!script) return false;
      await new Promise((res, rej) => execFile('/usr/bin/osascript', script.flatMap((l) => ['-e', l]), { timeout: 4000 }, (e, _o, err) => (e ? rej(new Error(String(err || e.message))) : res())));
      return true;
    },
    // true when the gesture did something: the rock sign plays music, a still palm stops Relay mid-sentence, a wave opens the mic, a thumb answers a yes/no Relay is asking
    onGesture: (type) => {
      const idle = ['idle', 'done'].includes(ask.state);
      if (type === 'stop') return ask.interruptSpeech();
      const custom = store.get(`settings.hands.signCommands.${type}`); // a job of your own for the sign ("when I show the rock sign, ...")
      if (custom && (type === 'wave' || type === 'rock' || type === 'stop')) { if (type === 'stop' && ask.interruptSpeech()) return true; if (!idle) return false; ask.handleText(String(custom)).catch(() => {}); return true; }
      if (type === 'wave') { if (!idle) return false; ask.listenFromHand(null).catch(() => {}); return true; }
      if (type === 'rock') { if (!idle) return false; ask.handleText('play some music').catch(() => {}); return true; }
      if (type === 'confirm-yes') return ask.remoteConfirm(true);
      if (type === 'confirm-no') return ask.remoteConfirm(false);
      return false;
    },
    tabNumbers: () => store.get('settings.hands.tabNumbers') !== false,
    externalDrag,maxHands:()=>store.get('settings.hands.maxHands')??4,
    preview: !!store.get('settings.hands.preview'),
    sensitivity: () => store.get('settings.hands.margin') ?? 0.22,
    onThrow: rememberThrow,
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
      const fitness = fitnessPanel?.handTarget(pt); if (fitness) return fitness;
      const network = networkPanel?.handTarget(pt); if (network) return network;
      const security = securityPanel?.handTarget(pt); if (security) return security;
      const priorities = prioritiesPanel?.handTarget(pt); if (priorities) return priorities;
      const assignments = assignmentsPanel?.handTarget(pt); if (assignments) return assignments;
      const agentsDash = agentsPanel?.handTarget(pt); if (agentsDash) return agentsDash;
      const storage = storagePanel?.handTarget(pt); if (storage) return storage;
      const panel = panelWins?.handTarget(pt);
      if (panel) {
        const spec = panelHub?.panels.get(panel.id)?.spec;
        if (spec) { const original = { ...spec }; const pos = panel.position(); panel.undo = async () => { const r = await panelHub.show(original); if (!r.ok) throw new Error(r.error); const win = panelWins.windows.get(r.id); if (win && !win.isDestroyed()) win.setPosition(pos.x, pos.y); }; }
        return panel;
      }
      return cardPanel?.handTarget(pt) || null;
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
    createCursor: (slot=0) => {
      const rgb=['0,212,255','170,120,255','66,235,170','255,190,70','255,110,160','120,195,255'][slot%6];
      const win = new BrowserWindow({ width: 56, height: 56, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, resizable: false, skipTaskbar: true, enableLargerThanScreen: true, type: 'panel' });
      win.setIgnoreMouseEvents(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setHiddenInMissionControl?.(true);
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body class="open" style="margin:0;background:transparent;overflow:hidden"><style>div{position:absolute;inset:10px;border-radius:50%;border:2px solid rgba(0,212,255,.9);box-shadow:0 0 14px rgba(0,212,255,.6);transition:all .12s}.held div{background:rgba(0,212,255,.35);inset:14px}.pinch div{inset:19px;background:rgba(0,212,255,.55)}.click div{inset:2px;opacity:.5}.mic div{inset:4px;box-shadow:0 0 26px rgba(0,212,255,.95)}</style><div></div></body>'.replaceAll('0,212,255',rgb))}`);
      return { moveTo: (pt) => { if (!win.isDestroyed()) { if (!win.isVisible()) win.showInactive(); win.setPosition(Math.round(pt.x - 28), Math.round(pt.y - 28)); } }, hide: () => { if (!win.isDestroyed()) win.hide(); }, close: () => { if (!win.isDestroyed()) win.close(); }, setState: (c) => { if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.body.className=${JSON.stringify(String(c).replace(/[^a-z]/g, ''))}`).catch(() => {}); } };
    },
    air: (type, x, y) => overlay.air(type, x, y),
    shape: (r) => { const m = shapeToModel(r); if (m) holos.show({ title: m.title, items: [{ kind: 'shapes', title: m.title, credit: 'Drawn in the air', parts: m.parts }], x: Math.round(r.cx), y: Math.round(r.cy), scale: m.scale }).catch(() => {}); },
    onMic: (id) => ask.listenFromHand(id).catch(() => {}),
    notify: (m, status = 'failed') => ask.notice(m, status)
  });
  hands.onChange = () => { rebuildTray(); broadcast(); };
  ask.onHandsPause = () => { if (hands.enabled) hands.setPaused(!hands.paused); };
  presence = new PresenceControl({
    getConfig: () => store.get('settings.presence'),
    askAccess: async () => { const st = systemPreferences.getMediaAccessStatus?.('camera') ?? 'granted'; if (st === 'granted') return true; if (st === 'not-determined') return !!(await systemPreferences.askForMediaAccess('camera')); return false; },
    createCamera: async () => {
      const win = new BrowserWindow({ width: 320, height: 240, show: false, focusable: false, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
      const sender=win.webContents; presenceSender=sender;
      win.on('closed',()=>{if(presenceSender===sender) presenceSender=null;});
      win.loadFile(path.join(__dirname, '../renderer/presence.html'));
      return { close: () => { if (!win.isDestroyed()) win.close(); } };
    },
    onAway: () => ask.presenceAway(),
    onBack: () => ask.presenceBack(),
    notify: (m) => ask.notice(m, 'failed')
  });
  presence.onChange = broadcast;
  // Second-viewer guard (opt-in, locks only): more faces in view than expected starts a countdown. It counts faces; it cannot tell who anyone is.
  viewerGuard = new ViewerGuard({ lock: () => ask.mac.lockScreen(), notify: (m) => ask.notice(m, 'failed'), getConfig: () => store.get('settings.presence.guard') });
  // Self-improvement workspace: proposals for changes to Relay's own code live in separate git worktrees; tests run there; a passing change becomes one commit. Never merges, pushes or installs.
  const proposals = new ProposalWorkspace({
    store, getConfig: () => store.get('settings.selfImprove'),
    run: (args, { cwd, timeout, signal }) => new Promise((resolve) => require('child_process').execFile(args[0], args.slice(1), { cwd, timeout, signal, maxBuffer: 20 * 1024 * 1024, env: require('./nightRunner').nightEnv() }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') })))
  });
  // Claude, headless, in a proposal's own worktree: it may read and edit files, nothing else (no commands, no network), so nothing it writes has run (nightClaude.js).
  const runClaudeHeadless = options => require('./nightRunner').runRestrictedNight({...options,isPrivate:()=>store.get('settings.model.provider')==='ollama'});
  const claudeNight = async (key, {signal}={}) => {
    signal?.throwIfAborted();
    const nc = require('./nightClaude');
    const brief = nc.buildBrief({ diagLines: diag.tail(60), speed: require('./latency').describe(store.get('latencyLog')), extra: (store.get('settings.selfImprove') || {}).instruction || '' });
    diag.log('night-claude', 'started');
    const r = await nc.runNight({ proposals, runClaude: options=>runClaudeHeadless({...options,signal}), brief, key: new Date().toISOString().slice(0, 10) });
    diag.log('night-claude', r.status + (r.files ? ` ${r.files.length} file(s), ${r.lines} lines` : ''));
    return r;
  };
  nightlyMaintenance=new(require('./nightlyMaintenance').NightlyMaintenance)({store,claudeNight,proposals,settings:()=>({...store.get('settings.selfImprove'),model:store.get('settings.model.ollamaModel'),url:store.get('settings.model.ollamaUrl')}),exportReport:(title,text)=>{try{ask.outputExport(title,text);}catch{}}});
  ipcMain.handle('proposal:review',async(e,id)=>{
    if(e.sender!==mainWin?.webContents)return {error:'Open Settings first.'};
    const p=proposals.find(id);if(!p?.generated)return {error:'No generated proposal to review.'};
    const marked=await proposals.git(['add','-N','--','.'],p.dir);if(marked.code!==0)return {error:'Cannot include new files in the review.'};const diff=await proposals.git(['diff','HEAD','--no-ext-diff'],p.dir);if(diff.code!==0||!diff.stdout.trim())return {error:'No readable diff.'};/* every changed file, tests and brand-new files included, not only src */
    if(diff.stdout.length>100000)return {error:'This diff is too large to display completely. Reduce the proposal before approving tests.'};
    const reviewedState=await proposals.status(p);if(!reviewedState)return {error:'Cannot verify proposal files.'};
    const answer=await dialog.showMessageBox(mainWin,{type:'warning',message:'Review the whole generated change (source, tests, new files) before allowing tests',detail:diff.stdout,buttons:['Cancel','Approve testing'],defaultId:0,cancelId:0});
    if(answer.response!==1)return {cancelled:true};
    if(reviewedState!==await proposals.status(p))return {error:'Files changed during review. Review again.'};
    proposals.patch(p.id,{reviewed:true,reviewState:reviewedState});broadcast();return {ok:true};
  });
  // "Turn on overnight self improvement": Claude prepares one small change a night for you to review (nightClaude.js). Finds your source folder if it does not know it yet.
  ask.nightCommand = async (c) => {
    const done = (reply) => ({ status: 'done', reply, actions: 1 });
    const cfg = store.get('settings.selfImprove') || {};
    if (c.type === 'night-report') { const m = store.get('nightlyMaintenance'); return { status: 'done', reply: m ? `Last overnight run (${m.status}): ${m.text}` : 'There has been no overnight run yet.', actions: 0 }; }
    if (c.type === 'night-off') { store.set('settings.selfImprove', { ...cfg, nightly: false, claude: false }); broadcast(); return done('Overnight self-improvement is off. Nothing runs at night.'); }
    const fsx = require('fs'), pathx = require('path'), looks = (d) => fsx.existsSync(pathx.join(d, '.git')) && fsx.existsSync(pathx.join(d, 'src', 'main', 'main.js'));
    let repo = cfg.repo && looks(cfg.repo) ? cfg.repo : '';
    if (!repo) {
      const hits = [];
      for (const root of ['Downloads', 'Documents', 'Desktop'].map((d) => pathx.join(os.homedir(), d))) {
        let a = []; try { a = fsx.readdirSync(root, { withFileTypes: true }); } catch { continue; }
        for (const e of a) { if (!e.isDirectory()) continue; const d = pathx.join(root, e.name); if (looks(d)) { hits.push(d); continue; } let b = []; try { b = fsx.readdirSync(d, { withFileTypes: true }); } catch { continue; } for (const f of b) if (f.isDirectory() && looks(pathx.join(d, f.name))) hits.push(pathx.join(d, f.name)); }
      }
      repo = hits.find((h) => pathx.basename(h) === 'relay-mine') || hits[0] || '';
    }
    if (!repo) return { status: 'failed', reply: 'I could not find your Relay source folder in Downloads, Documents or Desktop, so I cannot work on it overnight.' };
    const branch = await new Promise((res) => require('child_process').execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, timeout: 5000 }, (e, out) => res(e ? '' : String(out).trim())));
    store.set('settings.selfImprove', { ...cfg, repo, base: branch && branch !== 'HEAD' ? branch : (cfg.base || 'main'), nightly: true, claude: true });
    const ov = ask.overnight.conf(); broadcast();
    return done(`Overnight self-improvement is on. Between ${ov.from} and ${ov.to} at night, if this Mac is awake and Relay is open, Claude will look for one small, safe improvement to my own code in a separate copy of ${pathx.basename(repo)}. It can only read and edit files there, so nothing it writes has run. In the morning say "what did you improve overnight", read the change, and approve it or throw it away. I never merge, push or install anything by myself.`);
  };
  ask.selfImproveCommand = async (c) => {
    const done = (reply) => ({ status: 'done', reply, actions: 1 });
    const fail = (r) => ({ status: 'failed', reply: r.error });
    if (c.type === 'list') { const l = proposals.list().filter((p) => !p.discarded); return done(l.length ? `Your proposals: ${l.map((p) => proposals.describe(p)).join('; ')}.` : 'There are no open proposals.'); }
    if (c.type === 'start') { const r = await proposals.create(c.title); return r.error ? fail(r) : done(`Workspace ready on branch ${r.proposal.branch}, in ${r.proposal.dir}. Make the changes there, then say "test the proposal". Your running Relay and your main branch are untouched.`); }
    if (c.type === 'test') { const r = await proposals.test(c.ref); return r.error ? fail(r) : done(r.ok ? `The tests passed in the proposal (${r.passed} passed, none failed). Say "save the proposal" to keep it as one commit.` : `The tests did not pass in the proposal${r.failed ? ` (${r.failed} failed)` : ''}. Nothing was saved.`); }
    if (c.type === 'commit') { const r = await proposals.commit(c.ref, c.message); return r.error ? fail(r) : done(`Saved as commit ${r.sha.slice(0, 8)} on ${r.branch}. To undo it, revert that commit. I have not merged, pushed or installed anything; review it and merge it yourself if you want it.`); }
    const r = await proposals.discard(c.ref); return r.error ? fail(r) : done('The proposal folder is removed. Its branch is kept in case you want it back.');
  };
  // Owner recognition (opt-in): your face, as numbers encrypted on this Mac. A face that is not yours, while you are not there, starts the access-denied alarm and then the lock.
  intruder = new IntruderWindow({
    touchId: () => { try { return !!systemPreferences.canPromptTouchID?.(); } catch { return false; } },
    // a fingerprint is you proving it is you: the alarm (or the standby screen) stops, and it stays quiet for five minutes. promptTouchID throws if it is not accepted.
    fingerprint: async () => {
      await authenticateOwner({
        touchId: () => systemPreferences.promptTouchID('stop the access denied alarm'),
        admin: () => new Promise((resolve, reject) => require('child_process').execFile('osascript', ['-e', 'do shell script "true" with administrator privileges with prompt "Relay: confirm it is you, to stop the access denied alarm"'], (err) => (err ? reject(err) : resolve()))),
        onProblem: (m) => { ownerState.touchIdProblem = m; }
      });
      ownerGuard.dismiss('fingerprint'); store.set('ownerArmedAt', Date.now()); return { ok: true };
    }
  });
  ownerState = { templates: [], version: 1, enroll: null };
  const loadOwner = () => { try { ownerState.templates = safeStorage.isEncryptionAvailable() ? openTemplates(store.get('ownerFace'), (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))) : []; } catch { ownerState.templates = []; } ownerState.version++; };
  ownerState.save = (templates) => { if (!safeStorage.isEncryptionAvailable()) return false; store.set('ownerFace', sealTemplates(templates, (txt) => safeStorage.encryptString(txt).toString('base64'))); ownerState.templates = templates; ownerState.version++; return true; };
  loadOwner();
  trustedPeople=new (require('./trustedPeople').TrustedPeople)({store,
    encrypt:txt=>{if(!safeStorage.isEncryptionAvailable()) throw Error('Encrypted storage unavailable'); return safeStorage.encryptString(txt).toString('base64');},
    decrypt:b64=>safeStorage.decryptString(Buffer.from(b64,'base64')),
    authenticate:()=>new Promise(resolve=>execFile(axBinPath(),['authenticate-owner'],{timeout:65000},(err,out)=>resolve(!err && out.trim()==='authenticated'))),
    changed:()=>{ownerState.version++; broadcast();}
  });
  // Pictures of strangers: when the access-denied alarm starts for a real stranger (not the test screen), up to three pictures of the camera view are taken, a few seconds apart, and
  // kept encrypted on this Mac with the stranger's face numbers (so a second visit by the same face is recognised). Coming back, you are told who was there.
  const intruderLog = new (require('./intruderLog').IntruderLog)({ store, dir: path.join(app.getPath('userData'), 'intruders'), encrypt: (txt) => safeStorage.encryptString(txt), decrypt: (buf) => safeStorage.decryptString(buf) });
  intrudersWin = new (require('./intrudersWindow').IntrudersWindow)({ log: intruderLog, motion: floatingMotion, authorize: () => trustedPeople.authorize(), onChange: () => broadcast() });
  cameraWin = new (require('./cameraWindow').CameraWindow)({ motion: floatingMotion, onView: (on) => {
    if (on) { overlay.setCameraView(true); return; }
    overlay.cameraView = false; // back to where the reactor was before the camera opened
    if (ask.state === 'idle' || ask.state === 'done') overlay.hud(ask.reactorIdle ? { state: 'reactor-idle', idlePosition: store.get('settings.reactorIdlePosition') === 'corner' ? 'corner' : 'center' } : { hide: true });
  } });
  let currentVisit = null;
  const takeShot = async () => { const wc = presenceSender; if (!wc || wc.isDestroyed()) return null; try { return await wc.executeJavaScript('window.__relaySnapshot && window.__relaySnapshot()'); } catch { return null; } };

  // "What do you see": one picture from the camera, for the model. From the camera Relay already has open for owner recognition, else from the camera window (opened on the spot, visibly, when
  // you ask: Relay never looks through the camera without showing you). Returns { mediaType, data } or null. Nothing is saved.
  ask.cameraShot = async () => {
    // "What do you see" opens the camera view too, so you see what is being looked at (and the boxes it draws), then takes the picture from it.
    cameraWin.open();
    let snap = null;
    for (let i = 0; i < 25 && !snap?.jpeg; i++) { await new Promise((r) => setTimeout(r, 400)); snap = await cameraWin.snapshot(); }
    if (snap?.jpeg) await new Promise((r) => setTimeout(r, 900)); // a moment for the finder to name things, then look again
    if (snap?.jpeg) snap = (await cameraWin.snapshot()) || snap;
    if (!snap?.jpeg) snap = await takeShot(); // the camera Relay already has open, if this window's camera would not start
    const m = /^data:(image\/jpeg);base64,(.+)$/.exec(snap?.jpeg || '');
    return m ? { mediaType: m[1], data: m[2], names: Array.isArray(snap.names) ? snap.names : [] } : null;
  };
 const startVisit = (seconds) => {
    if (ownerConfig(store.get('settings.owner')).photos === false) return;
    try { if (!safeStorage.isEncryptionAvailable()) return; } catch { return; }
    const id = intruderLog.begin(seconds); currentVisit = id;
    for (const delay of [300, 4500, 10000]) setTimeout(async () => {
      if (currentVisit !== id || ownerGuard.state !== 'alarm') return;
      const snap = await takeShot(); if (!snap || currentVisit !== id) return;
      const threshold = ownerConfig(store.get('settings.owner')).threshold;
      // the face numbers kept are the strangers': not yours, and not a trusted person's
      const strangers = (snap.faces || []).filter((f) => Array.isArray(f.embedding) && !(Number.isFinite(f.score) && f.score >= threshold) && !(Number.isFinite(f.trustedScore) && f.trustedScore >= threshold)).map((f) => f.embedding);
      intruderLog.addShot(id, { jpeg: snap.jpeg, embeddings: strangers }, { threshold });
    }, delay).unref?.();
  };
  // Stopped with your fingerprint: that was you, not an intruder, so the pictures are not kept (and never shown).
  // You stopped the alarm with your fingerprint: that was you, in some light or at some angle Relay did not know yet. The face it saw is added to the faces it knows you by, but only when it is
  // safe: you were recognised in the two minutes before the alarm began, it is one person in every picture, and that face is close to yours (not someone who merely was there). At most two a
  // time and 24 in all; "undo what you learned" takes them back out.
  const learnFromAlarmVisit = (id) => {
    try {
      const rec = intruderLog.records().find((r) => r.id === id); if (!rec) return;
      const r = learnFromAlarm({ templates: ownerState.templates, embeddings: intruderLog.readEmb(rec), sinceSeenMs: rec.at - (Number(store.get('ownerArmedAt')) || 0), threshold: ownerConfig(store.get('settings.owner')).threshold });
      if (r.learned && ownerState.save(r.samples)) { store.set('ownerLearned', (Number(store.get('ownerLearned')) || 0) + r.learned); diag.log('guard-learned', `${r.learned} new face sample(s) from an alarm you stopped with your fingerprint`); }
    } catch { /* learning is a bonus: the alarm stop itself already worked */ }
  };
  const endVisit = (outcome) => { if (!currentVisit) return; const id = currentVisit; currentVisit = null; if (outcome === 'fingerprint') { learnFromAlarmVisit(id); intruderLog.remove(id); } else intruderLog.finish(id, outcome); broadcast(); };
  tellAboutVisits = () => {
    if (screenLocked || ownerGuard.state !== 'idle') return;
    const pending = intruderLog.pending(); if (!pending.length) return;
    const newest = pending[pending.length - 1], more = pending.length > 1 ? ` There ${pending.length === 2 ? 'was 1 earlier visit' : `were ${pending.length - 1} earlier visits`} too.` : '';
    intruderLog.markReviewed(pending.map((p) => p.id)); broadcast();
    // Does the visitor look like someone you have named? Then ask a plain yes or no: each answer teaches Relay the face, until it can name them on its own. Otherwise say who it was
    // as far as it can know, and that one word ("that's Sam") names them.
    const q = newest.question, ask_ = q ? ` Is that ${q.name}? Say yes or no.` : newest.label ? '' : ' If you know who it is, say "that\'s" and their name, and I will remember the face.';
    const text = `While you were away: ${intruderLog.describe(newest)}${more} I have opened the pictures.${ask_}`;
    ask.pendingNaming = { visitId: newest.id, at: Date.now(), question: !!q };
    ask.notice(text, 'done');
    if (q || !newest.label) { try { if (store.get('settings.speakReplies')) ask.speakText(`${intruderLog.describe(newest)}${ask_}`); } catch { /* speaking is optional */ } }
    intrudersWin.open();
  };
  // "yes" / "no" / "no, that's Sam" / "that's Sam": the answer about the visitor just reported (see the hook in askController).
  ask.onNamingAnswer = async ({ yes, name }) => {
    const pn = ask.pendingNaming; if (!pn) return { status: 'done', reply: 'There is nothing waiting for an answer, Sir.' };
    const { LEARN_STREAK } = require('./intruderLog');
    const left = (r) => (r.learned ? '' : ` ${Math.max(0, LEARN_STREAK - r.streak)} more yes${LEARN_STREAK - r.streak === 1 ? '' : 'es'} in a row and I will name ${r.name} on my own.`);
    let reply;
    if (name && yes !== true) { if (intruderLog.list().find((x) => x.id === pn.visitId)?.question) intruderLog.answer(pn.visitId, false); intruderLog.setLabel(pn.visitId, name); ask.pendingNaming = null; const p = intruderLog.people().find((x) => x.name.toLowerCase() === name.toLowerCase()); reply = `Got it, that is ${name}. I have saved their face${p && p.confirmed >= 2 ? `, and I will start asking whether new visitors are ${name}` : `. Name them once more and I will start asking whether new visitors are ${name}`}.`; }
    else if (yes === true) { const r = intruderLog.answer(pn.visitId, true); ask.pendingNaming = null; reply = r ? (r.learned ? `Yes, that is ${r.name}. I know the face well enough now to name ${r.name} without asking.` : `Thank you, Sir. That is ${r.name}.${left({ ...r, name: r.name })}`) : 'There was no question to answer, Sir.'; }
    else { const r = intruderLog.answer(pn.visitId, false); ask.pendingNaming = r ? { ...pn, question: false, at: Date.now() } : null; reply = r ? `Understood, that is not ${r.name}. I will not offer that face as ${r.name} again. If you know who it is, say "that's" and their name.` : 'There was no question to answer, Sir.'; }
    broadcast(); intrudersWin.open();
    return { status: 'done', reply, actions: 1 };
  };
  ownerGuard = new OwnerGuard({
    lock: () => ask.mac.lockScreen(),
    hasTemplates: () => ownerState.templates.length > 0,
    getIdleSeconds: () => { try { return powerMonitor.getSystemIdleTime(); } catch { return Infinity; } },
    getConfig: () => store.get('settings.owner'),
    onAlarm: ({ seconds, demo }) => { diag.log('alarm-start', `${seconds}s${demo ? ' (test)' : ''}`); intruder.show({ seconds, demo }); ask.sound('Basso'); if (!demo) startVisit(seconds); },
    onClear: (reason) => { diag.log('alarm-clear', String(reason)); intruder.hide(); overlay.releaseInput(); endVisit(({ owner: 'owner-returned', fingerprint: 'fingerprint', trusted: 'trusted' })[reason] || 'ended'); },
    onLocked: () => { diag.log('guard-locked', 'the countdown ended and the Mac was locked'); intruder.hide(); overlay.releaseInput(); endVisit('locked'); },
    episodes: store.get('ownerEpisodes') || [],
    onEpisode: (_ep, all) => { store.set('ownerEpisodes', all); },
    onOwnerSeen: () => { store.set('ownerArmedAt', Date.now()); tellAboutVisits(); },
    onAway: (on) => { diag.log(on ? 'standby-on' : 'standby-off'); if (on) intruder.showAway(); else if (ownerGuard.state !== 'alarm') intruder.hide(); holdStandbyAwake(!!on); }
  });
  // Guarding must not depend on you having been seen since the app last started: a restart (an update, a crash, a wake) while you are away would otherwise leave the Mac unguarded
  // until you sat down again. If you were recognised in the last 24 hours, the guard starts armed.
  if (Date.now() - (Number(store.get('ownerArmedAt')) || 0) < 24 * 3600 * 1000 && ownerState.templates.length > 0) ownerGuard.armed = true;
  // While the standby screen is up the Mac is kept awake with its display on: it is guarding, so it must not go to sleep or lock itself (Vorssaint or any other keep-awake tool is unaffected, the two simply add up).
  // After the Mac sleeps or locks, the key listener and "Hey Jarvis" can silently stop hearing (the screen still says Ready). Start both again, and write that down.
  const reviveListening = (why) => {
    setTimeout(() => {
      try { if (hotkeys && hotkeys.restart()) diag.log('hotkeys-restarted', why); else if (hotkeys) diag.log('hotkeys-failed', why + (hotkeys.error ? ': ' + hotkeys.error : '')); } catch (e) { diag.log('hotkeys-failed', String(e.message).slice(0, 80)); }
      try { if (store.get('settings.wake.enabled')) { ask.wake.disarm(); ask.wake.refresh(); diag.log('wake-restarted', why); } } catch { /* it is retried by the check below */ }
      try { if (glass?.child) { glass.stop(); diag.log('glass-restarted', why); } } catch { /* it starts again the next time the pill is shown */ } // the see-through pill's helper can hang across sleep too, and then Jarvis answers with nothing on screen
    }, 1500).unref?.();
  };
  // Every minute: is the listening alive? A shortcut recording that never ended, a wake listener that is not armed while Relay is idle, and a key listener that has heard nothing while you were
  // typing are each put right, and the log says what was done.
  let lastKeys = -1, activeChecks = 0;
  setInterval(() => {
    try {
      if (screenLocked) return;
      revivePresence('check');
      if (ask.suspended && !captureLatch.on) { ask.suspended = false; diag.log('selfcheck', 'shortcuts were paused with no recording going on: resumed'); }
      if (store.get('settings.wake.enabled') && ['idle', 'done'].includes(ask.state) && !ask.wake.armed && ask.wake.canListen() && !ask.meeting?.active) { ask.wake.refresh(); diag.log('selfcheck', 'Hey Jarvis was not listening while idle: started it'); }
      if (hotkeys) {
        const active = powerMonitor.getSystemIdleTime() < 20;
        if (active && hotkeys.eventsSeen === lastKeys) activeChecks++; else activeChecks = 0;
        lastKeys = hotkeys.eventsSeen;
        if (activeChecks >= 3) { activeChecks = 0; if (hotkeys.restart()) diag.log('selfcheck', 'the key listener heard nothing for 3 minutes of activity: restarted'); }
      }
    } catch { /* the next check tries again */ }
  }, 60000).unref?.();
  const holdStandbyAwake = (on) => { try { if (on && standbyBlocker === null) standbyBlocker = powerSaveBlocker.start('prevent-display-sleep'); else if (!on && standbyBlocker !== null) { powerSaveBlocker.stop(standbyBlocker); standbyBlocker = null; } } catch { standbyBlocker = null; } };
  // The guard cannot guard a Mac that is asleep: the camera stops and nobody is there to raise the alarm. So while it is on and has recognised you (armed), the Mac is kept from idle sleep: plugged in, the
  // screen stays on too (the standby screen and the alarm are what you see); on battery only the system is kept awake, so the screen may dim but the camera keeps watching. Not while the Mac is locked.
  // Closing the lid still sleeps the Mac: macOS does that regardless.
  let guardHold = null; // { kind, id }
  const keepGuardAwake = () => {
    try {
      const cfg = ownerConfig(store.get('settings.owner'));
      const want = cfg.enabled && cfg.keepAwake !== false && ownerGuard?.armed && (ownerState?.templates?.length || 0) > 0 && !screenLocked;
      const kind = want ? (powerMonitor.isOnBatteryPower() ? 'prevent-app-suspension' : 'prevent-display-sleep') : null;
      if (guardHold && guardHold.kind !== kind) { powerSaveBlocker.stop(guardHold.id); guardHold = null; diag.log('guard-awake-off'); }
      if (kind && !guardHold) { guardHold = { kind, id: powerSaveBlocker.start(kind) }; diag.log('guard-awake-on', kind === 'prevent-display-sleep' ? 'plugged in: screen and Mac stay on' : 'on battery: Mac stays awake, screen may dim'); }
    } catch { /* tried again in a few seconds */ }
  };
  setInterval(keepGuardAwake, 5000).unref?.();
  setInterval(() => { ownerGuard.step(); if (intruder.sweep({ alarmWanted: ownerGuard.state === 'alarm', awayWanted: ownerGuard.awayActive })) { overlay.releaseInput(); if (!ownerGuard.awayActive) holdStandbyAwake(false); } }, 1000);
  // The face setup window (camera in a circle, ring of eight directions): it returns the finished set of numbers, and this decides whether it is a full set and keeps it.
  enrollWin = new (require('./enrollWindow').EnrollWindow)({
    motion: floatingMotion,
    save: async (samples, name, { replace = false } = {}) => {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: 'This Mac cannot encrypt your face data right now, so I will not store it.' };
      const firstPerPose = (list) => { const seen = new Set(); return list.filter((x) => x && !seen.has(x.pose) && seen.add(x.pose)); }; // trusted people keep one numbers set per pose
      const r = acceptEnrollment(name ? firstPerPose(samples) : samples);
      if (!r.ok) return { ok: false, message: r.why };
      if (name) { try { replace ? trustedPeople.upsert(name, r.templates) : trustedPeople.save(name, r.templates); } catch (e) { return { ok: false, message: e.message }; } }
      else if (!ownerState.save(r.templates)) return { ok: false, message: 'Your face could not be saved: this Mac cannot encrypt it right now.' };
      store.set('settings.owner', { ...ownerConfig(store.get('settings.owner')), enabled: true });
      ownerGuard.reset();
      if (!store.get('settings.presence.enabled')) { store.set('settings.presence.enabled', true); await setPresence(true); }
      broadcast();
      const seconds = ownerConfig(store.get('settings.owner')).seconds;
      ask.notice(`${name || 'Your face'} is enrolled (${r.templates.length} angles) and owner recognition is on. If someone else sits down, I will sound the alarm and lock after ${seconds} seconds. Say "test the access denied screen" to see it.`, 'done');
      return { ok: true, threshold: ownerConfig(store.get('settings.owner')).threshold, message: `${r.templates.length} angles saved. Owner recognition is on: a stranger at the desk gets the alarm, then the lock after ${seconds} seconds.` };
    }
  });
  ask.cameraAdjust = (c) => cameraWin.adjust(c);
  ask.diag = diag;
  ask.localCommand = (c) => require('./localMode').run(c, { store, get: (u) => ask.httpGet(u, true), ensure: ask.ensureOllama, apply: (v) => applyModelProvider(v) });
  ask.ownerCommand = async (c) => {
    const cfg = () => ownerConfig(store.get('settings.owner'));
    const done = (reply) => ({ status: 'done', reply, actions: 1 });
    const setOwner = (patch) => store.set('settings.owner', { ...cfg(), ...patch });
    const needCamera = async () => { if (store.get('settings.presence.enabled')) return ''; store.set('settings.presence.enabled', true); await setPresence(true); return ' I turned Presence on, because it uses the same camera.'; };
    if (['enroll','forget','off','liveness-off','intruders-clear','looser','forget-person'].includes(c.type)) { try { await trustedPeople.authorize(); } catch(e) { return {status:'failed',reply:e.message}; } }
    if (c.type === 'enroll') {
      if (!safeStorage.isEncryptionAvailable()) return { status: 'failed', reply: 'This Mac cannot encrypt your face data right now, so I will not store it.' };
      enrollWin.open();
      // short, and told not to stay: the reactor card would otherwise sit on the screen in front of the setup window until dismissed, and nothing should ask "anything else?" over it
      return { ...done('The face setup window is open. Follow the glow around the ring.'), noHold: true, noFollowUp: true };
    }
    if (c.type === 'explain') return done(ownerGuard.explain(store.get('settings.owner')));
    if (c.type === 'stricter' || c.type === 'looser') {
      const now = cfg().threshold, next = Math.round(Math.min(0.6, Math.max(0.3, now + (c.type === 'stricter' ? 0.05 : -0.05))) * 100) / 100;
      if (next === now) return done(`The match limit is already at its ${c.type === 'stricter' ? 'strictest (0.60)' : 'loosest (0.30)'}.`);
      setOwner({ threshold: next }); broadcast();
      return done(`The match limit is now ${next.toFixed(2)} (it was ${now.toFixed(2)}). A face must score at least that against yours to count as you, and the alarm starts for faces below ${(next - cfg().margin).toFixed(2)}. ${c.type === 'stricter' ? 'Look-alikes are less likely to pass as you; if it starts doubting you, say "make owner recognition looser".' : 'It will doubt you less, and look-alikes are more likely to pass as you.'} Your own face usually scores above 0.7.`);
    }
    if (c.type === 'people') {
      const list = intruderLog.people();
      return done(list.length ? `I have learned ${list.length} face${list.length === 1 ? '' : 's'}: ${list.map((p) => `${p.name} (${p.learned ? 'I recognise them on my own' : `${p.confirmed} naming${p.confirmed === 1 ? '' : 's'}, ${p.confirmed >= 2 ? 'I ask whether visitors are them' : 'not enough yet to ask'}`})`).join(', ')}.` : 'I have not learned anyone yet, Sir. When someone visits and you say "that\'s" and their name, I will remember the face.');
    }
    if (c.type === 'forget-person') return done(intruderLog.forgetPerson(c.name) ? `I have forgotten ${c.name}'s face and removed the name from their visits.` : `I do not know anyone called ${c.name}.`);
    if (c.type === 'unlearn') { const n = Number(store.get('ownerLearned')) || 0; if (!n) return done('I have not added any faces from alarms, Sir.'); const keep = ownerState.templates.slice(0, Math.max(1, ownerState.templates.length - n)); if (!ownerState.save(keep)) return { status: 'failed', reply: 'I could not save that right now.' }; store.set('ownerLearned', 0); diag.log('guard-unlearned', `${n} sample(s) removed`); broadcast(); return done(`Done. I removed the ${n} face${n === 1 ? '' : 's'} I had added from alarms you stopped.`); }
    if (c.type === 'camera-show') { cameraWin.open(); return done('Here is the camera, Sir. Nothing is saved. Say "hide the camera" when you are done, or ask me what I see.'); }
    if (c.type === 'camera-hide') { cameraWin.close(); return done('Camera view closed.'); }
    if (c.type === 'intruders') {
      intrudersWin.open(); const list = intruderLog.list();
      return done(list.length ? `Here are the pictures, Sir. ${list.length} visit${list.length === 1 ? '' : 's'} so far. The latest: ${intruderLog.describe(list[0])}` : 'Nobody has sat at your Mac while the alarm was watching, Sir. When someone does, their pictures will be here.');
    }
    if (c.type === 'photos-on' || c.type === 'photos-off') { setOwner({ photos: c.type === 'photos-on' }); broadcast(); return done(c.type === 'photos-on' ? 'Intruder photos are on: when the alarm starts for a stranger I will take up to three pictures and keep them encrypted on this Mac.' : 'Intruder photos are off. The alarm still sounds and locks, but no pictures are taken. The ones already saved are kept.'); }
    if (c.type === 'intruders-clear') { intruderLog.clear(); intrudersWin.close(); broadcast(); return done('All the intruder pictures are deleted.'); }
    if (c.type === 'forget') { ownerState.enroll = null; store.set('ownerFace', null); store.set('trustedFaces',[]); loadOwner(); setOwner({ enabled: false }); ownerGuard.reset(); intruder.hide(); broadcast(); return done('Your face data is deleted and owner recognition is off.'); }
    if (c.type === 'off') { setOwner({ enabled: false }); ownerGuard.reset(); intruder.hide(); broadcast(); return done('Owner recognition is off.'); }
    if (c.type === 'seconds') { const s = ownerConfig({ enabled: true, seconds: c.seconds }).seconds; setOwner({ seconds: s }); return done(`${s === c.seconds ? '' : `That is outside 5 to 120, so I used ${s}. `}The lock countdown is ${s} seconds.`); }
    if (c.type === 'away-on' || c.type === 'away-off') { setOwner({ awayScreen: c.type === 'away-on' }); if (c.type === 'away-off' && ownerGuard.state !== 'alarm') intruder.hide(); return done(c.type === 'away-on' ? `The away screen is on: after ${cfg().awaySeconds} seconds with nobody in view, the screen blurs and I say the owner will be back soon, until you are seen again.` : 'The away screen is off.'); }
    if (c.type === 'liveness-on' || c.type === 'liveness-off') { setOwner({ liveness: c.type === 'liveness-on' }); return done(c.type === 'liveness-on' ? 'The liveness check is on: a face that matches yours but has not blinked for a while is treated as a picture, not as you.' : 'The liveness check is off. A photo of you can now pass as you.'); }
    if (c.type === 'away-demo') { intruder.showAway(); setTimeout(() => { if (!ownerGuard.awayActive && ownerGuard.state === 'idle') intruder.hide(); }, 8000); return done('Showing the away screen for eight seconds.'); }
    if (c.type === 'demo') { ownerGuard.startDemo(6); return done('Showing the access denied screen for six seconds. Nothing will lock.'); }
    if (c.type === 'on') {
      if (!ownerState.templates.length) return { status: 'failed', reply: 'I do not know your face yet. Say "enroll my face" first.' };
      const note = await needCamera(); setOwner({ enabled: true }); ownerGuard.reset(); broadcast();
      return done(`Owner recognition is on, and arms itself once it has recognised you. If a face that is not yours is in view while you are not, I will sound the alarm and lock the screen after ${cfg().seconds} seconds.${note} A still photo of you will not pass (it must blink), but a video of you could, and it may flag you in poor light for a moment; coming back into view stops it.`);
    }
    const t = ownerState.templates.length;
    return done(`Owner recognition is ${cfg().enabled ? 'on' : 'off'}. ${t ? `Your face is enrolled (${t} angles).` : 'Your face is not enrolled.'} The lock countdown is ${cfg().seconds} seconds. ${ownerGuard.armed ? 'It has recognised you this session, so it is armed.' : 'It has not recognised you yet this session, so it is not armed and will not sound the alarm or lock'}${ownerState.touchIdProblem ? ` The Touch ID sheet had a problem (${ownerState.touchIdProblem}), so I used the macOS password prompt instead.` : ''}${ownerGuard.lookingAway ? ' You are looking away from the camera right now, so I am not judging your face.' : ''}${ownerGuard.lastScore !== null ? ` (best match so far ${ownerGuard.lastScore.toFixed(2)}; it needs ${cfg().threshold.toFixed(2)})` : ''}. The liveness check is ${cfg().liveness ? 'on' : 'off'}. The away screen is ${cfg().awayScreen ? `on (after ${cfg().awaySeconds} seconds with nobody in view)` : 'off'}. It only locks; it never unlocks the Mac.`);
  };
  ask.viewerGuardCommand = async (c) => {
    const limits = ' It counts faces in the camera\'s view, so it cannot tell who anyone is, a photo counts as a face, and anyone out of the camera\'s view is not seen. It only locks the screen.';
    if (c.type === 'snooze') { viewerGuard.snooze(30); return { status: 'done', reply: 'Understood, Sir. The viewer guard is paused for 30 minutes.', actions: 1 }; }
    store.set('settings.presence.guard', { ...(store.get('settings.presence.guard') || {}), enabled: c.type === 'on' }); viewerGuard.reset();
    if (c.type === 'off') { broadcast(); return { status: 'done', reply: 'The viewer guard is off.', actions: 1 }; }
    let note = '';
    if (!store.get('settings.presence.enabled')) { store.set('settings.presence.enabled', true); await setPresence(true); note = ' I turned Presence on, because the guard uses its camera.'; }
    broadcast();
    return { status: 'done', reply: `The viewer guard is on: if another face stays in view, I will warn you and lock the screen after ${config(store.get('settings.presence.guard')).seconds} seconds.${note}${limits}`, actions: 1 };
  };
  // The camera at launch. Owner recognition cannot work without it, so if recognition is on and your face is enrolled the camera is started even when Presence was left off, and a
  // start that fails for a passing reason is tried again instead of leaving Presence off for good (which silently stopped recognition, with it still reading "on").
  const startCamera = async (tries = 0) => {
    const wasOff = !store.get('settings.presence.enabled');
    const r = await presence.enable().catch(() => ({ ok: false }));
    const plan = require('./presence').cameraStartPlan({ ok: r.ok, permission: systemPreferences.getMediaAccessStatus?.('camera'), tries });
    if (plan.action === 'on') { if (wasOff) { store.set('settings.presence.enabled', true); ask.notice('Owner recognition needs the camera, so I turned Presence back on. To stop the camera, turn owner recognition off.', 'done'); } broadcast(); return; }
    if (plan.action === 'retry') { setTimeout(() => startCamera(tries + 1), plan.afterMs).unref?.(); return; }
    store.set('settings.presence.enabled', false);
    if (ownerConfig(store.get('settings.owner')).enabled) ask.notice(plan.why === 'permission' ? 'Owner recognition cannot watch: Camera access is off for Relay. Turn it on in System Settings > Privacy & Security > Camera.' : 'Owner recognition cannot watch: the camera would not start. Say "relay health" to see why.', 'failed');
    broadcast();
  };
  if (store.get('settings.presence.enabled') || (ownerConfig(store.get('settings.owner')).enabled && ownerState.templates.length > 0)) startCamera();
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
  pluginMgr = new PluginManager({ store, root: path.join(app.getPath('home'), 'Relay', 'plugins'), onUse: () => { ask.tainted = true; }, onEvent: (name, e) => ask.onProactive?.({ type: 'plugin', title: `${name}: ${e.title}`, importance: e.importance }), sandbox: process.platform==='darwin' && require('fs').existsSync('/usr/bin/sandbox-exec') });
  ask.plugins = pluginMgr;
  // Live panels
  const arrangeOpenMenus = (onlyIfOverlapping = false) => {
    for (const e of cardPanel.live()) e.manualSize = e.manualMove = true;
    const layout = require('./menuLayout'), windows = [...cardPanel.live().map(e => e.win), ...panelWins.windows.values()];
    if (!onlyIfOverlapping || layout.menusOverlap(windows)) layout.arrangeMenus(windows);
  };
  panelWins = new PanelWindows({ motion: floatingMotion, preload: path.join(__dirname, 'preload.js'), getLayouts: () => store.get('panelWindowLayouts') || {}, saveLayouts: layouts => store.set('panelWindowLayouts', layouts), onArrange: arrangeOpenMenus });
  cardPanel.onArrange = arrangeOpenMenus;
  panelWins.onRestore = async (spec, bounds) => { const r = await panelHub.show(spec); const w = panelWins.windows.get(r.id); if (w) w.once('ready-to-show', () => w.setBounds(bounds)); };
  panelWins.onRefresh = id => { const p = panelHub?.panels.get(id); if (p) return panelHub.tick(p); };
  ask.onResetMenus = () => { store.set('panelWindowLayouts', {}); arrangeOpenMenus(); };
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
    if (event.type === 'job' && callService?.config().enabled && callService.config().offerOnCompletion && !callService.privateMode() && !callsQuiet(callService.config(), Date.now())) {
      try { callService.prepare(`Review the task status: ${event.title}. Relay reported ${event.status}. Do not claim details beyond that status.`, { source: 'job', occurrence: `job:${event.id}` }); } catch {}
    }
    if (event.type !== 'security' && event.type !== 'page' && !flagsMod.isOn(store.get('settings'), 'proactive')) return; // a page you asked to watch does not wait for the experimental switch either // security warnings do not wait for the experimental switch
    const o = store.get('settings.proactive') || {};
    const d = alerts.decide(event, { mode: o.mode, quiet: o.quiet, busy: !!ask.meeting?.active || ask.state === 'listening' || !!ask.speaker?.speaking, away: !!ask.lockWatch?.locked });
    if (d.how === 'drop') return;
    if (Notification.isSupported()) new Notification({ title: 'Relay', body: d.text, silent: d.how !== 'speak' || d.quiet }).show();
    if (d.how === 'speak') ask.speakText(d.text);
    if (d.phone) ask.phone?.send({ title: 'Relay', body: d.text }).catch(() => {});
  };
  ask.onProactive = surface;
  // Security warnings on their own: check a minute and a half after start, then every few hours, and tell you about anything new that is medium or worse.
  const securityWatch = async () => {
    const w = store.get('settings.securityWatch') || {};
    if (w.enabled === false) return;
    try {
      const report = await securityPanel.run(true);
      const { warn, more, state } = securityAudit.selectWarnings(report, store.get('securityWatchState'), { min: w.min || 'medium' });
      store.set('securityWatchState', state);
      for (const x of warn) surface({ type: 'security', id: x.id, severity: x.severity, title: x.title });
      if (more) surface({ type: 'security', id: 'more', severity: 'medium', summary: true, title: `${more} more security finding${more === 1 ? '' : 's'}. Say "security audit" to see them.` });
    } catch { /* a failed check is not a warning; the next one tries again */ }
  };
  setTimeout(securityWatch, 90000);
  setInterval(securityWatch, Math.max(1, Number((store.get('settings.securityWatch') || {}).hours) || 6) * 3600e3);
  // Watched folders (Settings > Speak up on its own): a new file in one is an event.
  const watchers = new Map();
  const syncWatch = () => {
    const want = new Set(store.get('settings.proactive.folders') || []);
    for (const [d, w] of watchers) if (!want.has(d)) { w.close(); watchers.delete(d); }
    for (const d of want) if (!watchers.has(d)) { try { watchers.set(d, require('fs').watch(d, (ev, name) => { if (ev === 'rename' && name && !name.startsWith('.') && require('fs').existsSync(path.join(d, name))) surface({ type: 'folder', title: path.basename(d), name }); })); } catch { /* a folder that is gone */ } }
  };
  syncWatch();
  ipcMain.handle('proactive:add-folder', async () => {
    const r = await dialog.showOpenDialog({ title: 'Watch a folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    store.set('settings.proactive.folders', [...new Set([...(store.get('settings.proactive.folders') || []), r.filePaths[0]])].slice(0, 5));
    syncWatch(); broadcast();
    return { ok: true };
  });
  let tickN = 0;
  setInterval(async () => {
    if (!flagsMod.isOn(store.get('settings'), 'proactive')) return;
    syncWatch();
    const b = batteryEvent(await panelSampler.sample('battery').catch(() => null));
    if (b) surface(b);
    if (tickN++ % 5 === 0) { try { for (const e of calendarEvents(parseCalendar(await ask.mac.calendarEvents(1)))) surface(e); } catch { /* no calendar access: Doctor and Permissions say so */ } }
  }, 60000);
  // "Tell me when this page changes": pages you chose are re-read every half hour (public https only); a real change is told once, with what is new.
  const { PageWatcher } = require('./pageWatch');
  const pageWatcher = new PageWatcher({ load: () => store.get('pageWatches') || [], save: (v) => store.set('pageWatches', v), fetchPage: (u) => require('./safeFetch').safeGet(u), onChange: (e) => surface(e) });
  setInterval(() => { if (!ask.offline) pageWatcher.checkDue().catch(() => {}); }, 60000).unref?.();
  // "Command center": one card with today, what is due, running jobs, the owner guard, watched pages and what Relay last did.
  ask.commandCenter = async () => {
    const cc = require('./commandCenter');
    const facts = await ask.briefingFacts({ includeGreeting: false }).catch(() => null);
    const oc = ownerConfig(store.get('settings.owner'));
    const card = cc.buildCenter({ events: facts?.events, due: facts?.due, tasks: ask.taskList?.(), guard: { on: !!oc.enabled, armed: !!ownerGuard?.armed, keepAwake: oc.keepAwake !== false }, pages: pageWatcher.list(), actions: store.get('actions') || [], undoable: ask.undos.ids() });
    await cardPanel.show(card);
    return { status: 'done', reply: 'Here is your command center.', actions: 0 };
  };
  // Eye breaks (opt-in): the screens blur for 20 seconds every 20 minutes of work, and Relay asks you to look far away. Skip ends it early.
  const eyeMod = require('./eyeBreak');
  let eyeWins = [];
  const closeEye = () => { for (const w of eyeWins) { try { if (!w.isDestroyed()) w.close(); } catch { /* gone */ } } eyeWins = []; };
  const showEyeBreak = (seconds, { speak = true } = {}) => {
    if (eyeWins.length) return;
    for (const d of screen.getAllDisplays()) {
      const w = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, show: false, frame: false, transparent: true, backgroundColor: '#00000000', vibrancy: 'hud', hasShadow: false, focusable: false, resizable: false, movable: false, skipTaskbar: true, enableLargerThanScreen: true, type: 'panel' });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      w.setHiddenInMissionControl?.(true);
      w.webContents.on('will-navigate', (e, url) => { if (url.startsWith('relay-skip:')) { e.preventDefault(); closeEye(); } });
      w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(eyeMod.breakHtml(seconds))}`);
      w.once('ready-to-show', () => w.showInactive());
      eyeWins.push(w);
    }
    setTimeout(closeEye, (seconds + 3) * 1000).unref?.();
    diag.log('eye-break', `${seconds}s`);
    if (speak && !ask.meeting?.active) ask.speakText(`Eye break. Look at something far away for ${seconds} seconds.`);
  };
  const eyeBreaks = new eyeMod.EyeBreaks({ cfg: () => store.get('settings.eyeBreaks'), idleSeconds: () => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } }, busy: () => !!ask.meeting?.active || ask.state === 'listening' || screenLocked, start: (sec) => showEyeBreak(sec, { speak: (store.get('settings.eyeBreaks') || {}).speak !== false }) });
  setInterval(() => eyeBreaks.tick(), eyeMod.TICK_MS).unref?.();
  ask.eyeCommand = async (c) => {
    const done = (reply, actions = 0) => ({ status: 'done', reply, actions });
    const cfg = store.get('settings.eyeBreaks') || {};
    if (c.type === 'eye-on') { store.set('settings.eyeBreaks', { ...cfg, enabled: true }); eyeBreaks.reset(); broadcast(); return done(`Okay. After about ${cfg.everyMin || 20} minutes of work I will blur your screens for ${cfg.seconds || 20} seconds and ask you to look far away. Say "turn off eye breaks" to stop.`, 1); }
    if (c.type === 'eye-off') { store.set('settings.eyeBreaks', { ...cfg, enabled: false }); closeEye(); broadcast(); return done('Eye breaks are off.', 1); }
    if (c.type === 'eye-now') { showEyeBreak(Math.max(5, Number(cfg.seconds) || 20), { speak: false }); return done('Look at something far away.'); }
    if (c.type === 'eye-snooze') { eyeBreaks.snooze(10); closeEye(); return done('Okay, no eye break for ten minutes.'); }
    const m = eyeBreaks.minutesLeft();
    return done(m === null ? 'Eye breaks are off. Say "turn on eye breaks".' : `Your next eye break is in about ${m} minute${m === 1 ? '' : 's'}.`);
  };
  // "Connect Google": opens Connections with the guided setup running, and says the easy way first (add the account to the Mac for Calendar).
  ask.googleSetupCommand = async () => {
    let onMac = [];
    try { onMac = require('./connectors/googleEasy').googleCalendars(await ask.mac.calendarSources()); } catch { /* no calendar access yet */ }
    openMain('connectors');
    googleConnections.startGuide();
    const first = onMac.length ? 'Your Google calendar is already on this Mac, so Calendar works with no setup. ' : 'For Calendar, the fastest way is to add your Google account in System Settings, Internet Accounts. ';
    return { status: 'done', reply: `${first}For Gmail, Drive, Docs and Sheets I opened Connections with the guided setup. Follow the four steps there; when the credentials file lands in Downloads I will pick it up and start the sign-in myself.`, actions: 1 };
  };
  // "When I show the rock sign, ...": gives a sign a job of your own (it runs like anything you say, so a routine name works too).
  ask.signCommand = async (c) => {
    const done = (reply, actions = 0) => ({ status: 'done', reply, actions });
    const cur = store.get('settings.hands.signCommands') || {};
    if (c.type === 'sign-reset') { store.set('settings.hands.signCommands', {}); broadcast(); return done('Okay, your hand signs are back to normal.'); }
    if (c.type === 'sign-list') { const names = { rock: 'the rock sign', wave: 'a wave', stop: 'a still open palm' }; const mine = Object.entries(cur).map(([k, v]) => `${names[k] || k}: ${v}`); return done(`The rock sign plays music, a wave opens the mic, a still open palm stops me talking, and a thumb answers a yes or no. ${mine.length ? `Your own: ${mine.join('; ')}.` : 'You have not set any of your own.'}`); }
    store.set('settings.hands.signCommands', { ...cur, [c.sign]: c.command.slice(0, 200) }); broadcast();
    return done(`Okay. When you show ${c.sign === 'stop' ? 'a still open palm' : c.sign === 'wave' ? 'a wave' : 'the rock sign'}, I will: ${c.command}.`, 1);
  };
  ask.pageCommand = async (c) => {
    const done = (reply, actions = 0) => ({ status: 'done', reply, actions });
    const activeUrl = async () => { try { const tabs = await bridge.call('tabs.list', {}); return (Array.isArray(tabs) ? tabs : tabs?.tabs || []).find((t) => t.active)?.url || null; } catch { return null; } };
    if (c.type === 'page-list') { const l = pageWatcher.list(); return done(l.length ? `I am watching ${l.length} page${l.length === 1 ? '' : 's'}: ${l.map((w) => w.label).join(', ')}.` : 'I am not watching any pages. Say "tell me when example.com changes".'); }
    if (c.type === 'page-unwatch') { const what = c.what === 'this' ? await activeUrl() : c.what; if (!what) return done('I could not see which page you mean. Say its address.'); const n = pageWatcher.remove(what); return done(n ? `Okay, I stopped watching ${n === 1 ? 'it' : `${n} pages`}.` : 'I was not watching that.'); }
    const url = c.target === 'this' ? await activeUrl() : c.target;
    if (!url) return done('I could not see your current page. Open it in Firefox with the Relay extension, or say its address.');
    const r = pageWatcher.add(url);
    if (!r.ok) return done(r.error);
    return done(r.already ? 'I am already watching that page.' : `Okay. I will tell you when ${r.label} changes. I check about every half hour, and what I keep is only a fingerprint of the page, not the page.`, 1);
  };
  // New email: check connected Gmail accounts every few minutes and tell you about what arrived (the first check only learns what is already there).
  const mailWatch = new MailWatch({ load: () => store.get('mailSeen') || {}, save: (v) => store.set('mailSeen', v) });
  let mailTick = 0;
  let mailBusy = false;
  setInterval(async () => {
    const o = store.get('settings.mail') || {};
    if (!o.enabled || mailBusy || ask.offline || ++mailTick % Math.max(1, Number(o.everyMin) || 3) !== 0) return;
    const api = ask.googleApiIfConnected();
    if (!api) return;
    mailBusy = true;
    try {
      for (const r of await api.gmailFresh((a) => mailWatch.known(a), gmailQuery)) {
        for (const e of mailEvents(mailWatch.update(r.account, r.ids, r.fresh), { vip: o.vip || [] })) surface(e);
      }
    } catch (e) { console.error('mail check:', e.message); } finally { mailBusy = false; }
  }, 60000);
  // Notifications: read the Mac's notification database (needs Full Disk Access) so "read my notifications" works and, if you ask, important ones are spoken.
  const runWithInput = (file, args, input) => new Promise((res, rej) => { const c = execFile(file, args, { timeout: 20000, maxBuffer: 16e6 }, (e, out, err) => (e ? rej(new Error(String(err || e.message))) : res(String(out)))); if (input !== undefined) { c.stdin.on('error', () => {}); c.stdin.end(input); } });
  const notifyTick = async () => {
    const o = store.get('settings.notifications') || {};
    if (!o.enabled) { ask.notificationReader = null; return; }
    if (!ask.notificationReader) ask.notificationReader = new NotificationReader({ run: runWithInput, exists: (p) => require('fs').existsSync(p), selfApps: ['com.sergey.relay'] });
    try {
      for (const n of await ask.notificationReader.poll()) {
        const score = notifyImportance(n);
        if (o.speak && score >= 0.5) surface({ type: 'plugin', title: describeNote(n), importance: score });
      }
    } catch (e) { /* Doctor and the "read my notifications" reply explain a missing permission */ }
  };
  setInterval(notifyTick, 20000);
  connectivity = new Connectivity({
    probe: () => Promise.any(['https://api.anthropic.com', 'https://www.apple.com/library/test/success.html'].map((u) => fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(4000) }).then(() => true))).catch(() => false),
    onChange: (online) => { ask.offline = !online; if (!online && flagsMod.isOn(store.get('settings'), 'offline')) speaker?.stop(); broadcast(); }
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
    const { due, missed } = tickSchedules(ask.canRunScheduled());
    notifyMissedSchedules(missed);
    for (const s of due) {
      ask.activeScheduledId = s.runId;
      Promise.resolve().then(() => ask.runScheduled(s)).then((result) => {
        recordScheduledOutcome(store, s.runId, result);
      }).catch(() => {}).finally(() => { if (ask.activeScheduledId === s.runId) ask.activeScheduledId = null; broadcast(); }); // an uncertain outcome remains visible and is never automatically retried
    }
    if (due.length || missed.length) broadcast();
    // Each evening: say what Relay did today and what can be undone. Only when something changed or failed; a click opens the list.
    const rc = store.get('settings.recap');
    // The recap reads today's activity, so do not label yesterday's missed
    // recap as today after midnight; wait for the next scheduled evening.
    if (nightlyDue(rc) && nightlyDay(rc) === dayKey(new Date())) {
      store.set('settings.recap.lastRun', nightlyDay(rc));
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
      store.set('settings.downloadsTidy.lastRun', nightlyDay(dt));
      runNightlyProposal(ask.drive, ({ ok, result }) => { store.addAction({ id: crypto.randomUUID(), tool: 'nightly_downloads_plan', input: {}, result, ok, ts: Date.now() }); broadcast(); }).then((r) => {
        if (!r && Notification.isSupported()) new Notification({ title: 'Downloads tidy-up could not run', body: 'Relay could not prepare the plan. No files were moved.', silent: true }).show();
        if (r?.logFailed && Notification.isSupported()) new Notification({ title: 'Downloads activity not recorded', body: 'Relay checked Downloads but could not write the activity log.', silent: true }).show();
        if (r?.moves && Notification.isSupported()) new Notification({ title: 'Downloads tidy-up', body: `${r.moves} ${r.moves === 1 ? 'file' : 'files'} in Downloads could be sorted. The plan is on screen: say “apply the plan” or “skip the plan”.`, silent: true }).show();
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
  hotkeys = new Hotkeys({ getShortcuts: () => withAuxiliaryShortcuts(store.get('settings.shortcuts')), onEvent: (n, k) => ask.onShortcut(n, k), onClick: () => ask.guide.onClick() });
  hotkeys.onMouse = (down) => { floatingMotion?.mouseButton(down); holos?.mouseButton(down); overlay?.dropWatch(down); }; // a file dragged onto a hologram is accepted while the button is held over it

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

  bootDoneAt = Date.now(); // the setup above ran to its end without throwing
  if (store.get('onboardingDone')) openMain(process.env.RELAY_PAGE || 'home');
  else openOnboarding();
});

app.on('second-instance', () => openMain('home'));
app.on('activate', () => { if (!mainWin || mainWin.isDestroyed() || !mainWin.isVisible()) openMain('home'); });
app.on('window-all-closed', (e) => e.preventDefault()); // keep running in the menu bar
app.on('before-quit', () => {
  try { ask.ducker.restoreNow((script) => require('child_process').execFileSync('osascript', ['-e', script], { timeout: 3000 }).toString().trim()); } catch {} // never quit with the volume left low
  quitting = true;
  try { ask.assistStop(); assistPanel?.destroy(); } catch {}
  mapPanel?.close();
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
