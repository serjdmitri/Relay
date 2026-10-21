const { app, BrowserWindow, screen, clipboard, desktopCapturer, safeStorage, systemPreferences } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const { parseCommand } = require('./commands');
const { runAgent } = require('./agent/loop');
const { buildTools } = require('./agent/tools');
const { buildSystemPrompt, buildContext } = require('./agent/system-prompt');
const { routeModel } = require('./agent/router');
const { AnthropicProvider } = require('./agent/providers/anthropic');
const { OllamaProvider } = require('./agent/providers/ollama');
const { OpenAICompatProvider } = require('./agent/providers/openai');
const { PRESETS, isPreset } = require('./agent/providers/presets');
const { McpHost, ClaudeSession, runSmart, findClaude } = require('./agent/claudeCli');
const { createMac } = require('./agent/mac');
const { parseQuick, runQuick } = require('./quick');
const { applyReplacements, applyDictationCommands, applyStyle, styleFor } = require('./dictation');
const { isUndo, isAgain } = require('./meta');

const PILL_W = 480;
const PAD = 36; // transparent margin around the pill: room for its shadow and the liquid drop
const BELOW = 48;
const VISION_RE = /llava|vision|minicpm-v|qwen2\.5-?vl|qwen3-?vl|gemma3|bakllava|moondream/i;

function decryptKey(enc) {
  if (!enc) return '';
  if (enc.startsWith('plain:')) return enc.slice(6);
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return '';
  }
}

// The model service picked in Account when it is one of the OpenAI-compatible presets.
function compatProvider(m) {
  const p = PRESETS[m.provider];
  const s = m.presets?.[m.provider] || {};
  const model = s.model || p.model;
  const provider = new OpenAICompatProvider({ baseUrl: m.provider === 'custom' ? s.url : p.baseUrl, apiKey: decryptKey(s.keyEnc), model, label: p.label, keyOptional: !!p.keyOptional });
  return { provider, vision: p.vision || VISION_RE.test(model) };
}

function encryptKey(key) {
  if (!key) return '';
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(key).toString('base64');
  return 'plain:' + key;
}

const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 1500 }, (e, out) => (e ? reject(e) : resolve(String(out).trim()))));

// Relay's own helper processes are never "the app you were in".
const HELPER_RE = /^(Relay|Electron|relay-glass|relay-speech)$/;

// The front app in a few milliseconds. AppleScript takes about 300ms for the same answer.
async function fastFrontmost() {
  const asn = await run('lsappinfo', ['front']);
  const info = await run('lsappinfo', ['info', '-only', 'name', asn]);
  const m = info.match(/^"(.+?)"\s+ASN/);
  if (!m) throw new Error('no front app');
  return m[1];
}

// States: idle | listening | finishing | input | working | confirm | done
class AskController {
  constructor({ store, bridge, overlay, speech, speaker, timers, glass, onChange }) {
    this.store = store;
    this.bridge = bridge;
    this.overlay = overlay;
    this.speech = speech;
    this.speaker = speaker;
    this.timers = timers;
    this.glass = glass;
    this.glassHeight = 0;
    this.onChange = onChange;
    this.state = 'idle';
    this.mode = 'ask'; // ask | dictate | type
    this.win = null;
    this.abort = null;
    this.pendingConfirm = null;
    this.prevApp = null;
    this.suspended = false; // true while a shortcut is being recorded in the UI
    this.recording = null; // string[] while recording a routine
    this.lastOk = null;
    this.scale = 1;
    this.doneTimer = null;
    this.heldStart = false; // the current listening session was started by holding the key
    this.ducked = null;
    this.duckChain = Promise.resolve();
    this.lastLevelPush = 0;
    this.lastApps = [];
    this.lastDictation = null;
    this.lastAction = null; // { kind: quick | model | dictation, ts, undo? }: what "undo that" would reverse
    this.lastRequestText = '';
    this.warm = null; // a Claude process started before the request is ready
    this.warming = false;
    this.warmTimer = null;
    this.listenStartedAt = 0;
    this.visible = false;
    this.disp = null;
    this.hideTimer = null;
    this.frontP = null;
    this.appsP = null;
    this.mcp = new McpHost();
    this.mac = createMac({ clipboard, capture: () => this.capture() });

    speech.on('partial', (text) => {
      if (this.state === 'listening') this.push({ partial: text });
    });
    speech.on('level', (v) => {
      const now = Date.now();
      if (this.state === 'listening' && now - this.lastLevelPush > 60) {
        this.lastLevelPush = now;
        this.push({ level: v });
      }
    });
    speech.on('preparing', (f) => {
      if (this.state === 'listening') this.push({ preparing: f });
    });
    speech.on('exit', () => {
      if (this.state === 'listening' || this.state === 'finishing') this.listenFailed(new Error('The dictation helper stopped.'));
    });
  }

  // The state drives the menu bar icon, so every change goes through here.
  get state() {
    return this._state;
  }

  set state(v) {
    if (v === this._state) return;
    this._state = v;
    this.onState?.(v);
  }

  // Name of the app in front right now.
  frontName() {
    return fastFrontmost();
  }

  // ----- window -----
  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: PILL_W + 2 * PAD, height: 140, show: false, frame: false, transparent: true, resizable: false,
      hasShadow: false, // the pill draws its own shadow; the window's shadow would show as a box
      enableLargerThanScreen: true, // lets the drop start at the very top edge, behind the notch
      skipTaskbar: true, alwaysOnTop: true, type: 'panel', fullscreenable: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Click-through, except over the pill itself (the page switches this on while the mouse is over it).
    this.win.setIgnoreMouseEvents(true, { forward: true });
    // Messages sent before the page registers its listener are lost, so callers await this.
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.win.loadFile(path.join(__dirname, '../renderer/ask.html'));
    return this.win;
  }

  // The pill follows you to whichever screen the pointer is on.
  display() {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  // Distance from the window's top edge (the top of the screen) down to the pill: below the menu bar and notch.
  topOffset(d = this.disp || screen.getPrimaryDisplay()) {
    return d.workArea.y - d.bounds.y + 6;
  }

  position(contentH) {
    const d = this.disp || screen.getPrimaryDisplay();
    const w = PILL_W + 2 * PAD;
    const x = Math.round(d.bounds.x + (d.bounds.width - w) / 2);
    this.win.setBounds({ x, y: d.bounds.y, width: w, height: this.topOffset(d) + Math.max(40, Math.round(contentH)) + BELOW });
    // The real glass behind the pill follows the same rectangle.
    const h = Math.max(40, Math.round(contentH));
    if (this.visible && this.useGlass() && h !== this.glassHeight) {
      this.glassHeight = h;
      this.glass.frame(this.glassRect(d, h), Math.min(27, h / 2));
    }
  }

  // Native glass is used when the helper can run and you have not turned it off.
  useGlass() {
    return !!this.glass && this.glass.supported && this.store.get('settings.glass') !== false;
  }

  glassRect(d, h) {
    const w = PILL_W + 2 * PAD;
    return { x: Math.round(d.bounds.x + (d.bounds.width - w) / 2) + PAD, y: d.bounds.y + this.topOffset(d), w: PILL_W, h };
  }

  notchRect(d) {
    return { x: d.bounds.x + d.bounds.width / 2 - 95, y: d.bounds.y - 36, w: 190, h: 64 };
  }

  resize(h) {
    if (this.win && !this.win.isDestroyed()) this.position(h);
  }

  // Shows the pill. A pill that was hidden drops out of the notch; one already showing just updates.
  // mode: 'inactive' keeps focus in your app, 'show' brings the window forward, 'focus' also takes keyboard focus.
  reveal(extra = {}, mode = 'inactive') {
    clearTimeout(this.hideTimer);
    const win = this.ensureWindow();
    const fresh = !this.visible;
    if (fresh) {
      this.disp = this.display();
      this.position(56);
    }
    this.visible = true;
    if (fresh && this.useGlass()) {
      const d = this.disp || screen.getPrimaryDisplay();
      this.glassHeight = 56;
      this.glass.show(this.glassRect(d, 56), this.notchRect(d), 27);
    }
    if (mode === 'inactive') win.showInactive();
    else win.show();
    if (mode === 'focus') {
      app.focus({ steal: true });
      win.focus();
    }
    this.push({ ...extra, ...(fresh ? { show: true } : {}) });
  }

  // Retracts the pill into the notch, then hides the window.
  hideSoft() {
    if (!this.win || this.win.isDestroyed() || !this.visible) return;
    this.visible = false;
    if (this.useGlass()) this.glass.hide(this.notchRect(this.disp || screen.getPrimaryDisplay()));
    this.glassHeight = 0;
    this.push({ hide: true });
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.finishHide(), 450);
  }

  finishHide() {
    if (!this.visible && this.win && !this.win.isDestroyed()) this.win.hide();
  }

  push(extra = {}) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('ask:state', {
      state: this.state,
      mode: this.mode,
      top: this.topOffset(),
      glass: this.useGlass(),
      askLabel: require('./shortcuts').label(this.store.get('settings.shortcuts.ask')),
      dictateLabel: require('./shortcuts').label(this.store.get('settings.shortcuts.dictate')),
      ...extra
    });
  }

  sound(name) {
    if (!this.store.get('settings.playSounds')) return;
    execFile('afplay', [`/System/Library/Sounds/${name}.aiff`], () => {});
  }

  // ----- lower other audio while listening -----
  duck() {
    if (!this.store.get('settings.duckAudio')) return;
    this.duckChain = this.duckChain.then(async () => {
      if (this.ducked !== null) return;
      try {
        const v = Number(await this.mac.osa('output volume of (get volume settings)'));
        if (Number.isFinite(v) && v > 20) {
          this.ducked = v;
          await this.mac.osa(`set volume output volume ${Math.round(v * 0.3)}`);
        }
      } catch {}
    });
  }

  unduck() {
    this.duckChain = this.duckChain.then(async () => {
      if (this.ducked === null) return;
      const v = this.ducked;
      this.ducked = null;
      try {
        await this.mac.osa(`set volume output volume ${v}`);
      } catch {}
    });
    return this.duckChain;
  }

  // ----- shortcut events -----
  onShortcut(name, kind) {
    if (this.suspended) return;
    if (name === 'cancel') {
      if (this.state !== 'idle') this.cancelAll();
      return;
    }
    if (name === 'dictate' && this.store.get('settings.dictation') === false) {
      // Only the press that starts it: a key-up after a hold must not show the message again.
      if (kind === 'press' || kind === 'tap' || kind === 'hold-start') this.notice('Dictation is turned off. Turn it on in General.', 'failed');
      return;
    }
    const mode = this.store.get('settings.talking');
    if (name === 'type') {
      if (kind !== 'press') return;
      if (this.state === 'idle' || this.state === 'done') return this.open({ typed: true }); // a reply on screen does not block the next request
      if (this.state === 'input') return this.close();
      return;
    }
    // ask and dictate are voice shortcuts
    const start = kind === 'tap' || kind === 'hold-start';
    if (kind === 'tap' && mode === 'hold') return;
    if ((kind === 'hold-start' || kind === 'hold-end') && mode === 'tap') return;

    if (this.state === 'working' || this.state === 'confirm') {
      if (name === 'ask' && start) this.stop();
      return;
    }
    if (this.state === 'listening') {
      if (kind === 'tap' || kind === 'hold-start') return this.finishListening();
      if (kind === 'hold-end' && this.heldStart) {
        // A press that ended almost as soon as it counted as a hold was a slow tap: keep listening until the next tap.
        if (mode === 'tap-or-hold' && Date.now() - this.listenStartedAt < 400) {
          this.heldStart = false;
          return;
        }
        return this.finishListening();
      }
      return;
    }
    if (this.state === 'finishing') return;
    if (start) {
      if (this.state === 'idle' || this.state === 'done') return this.listen(name, kind === 'hold-start');
      if (this.state === 'input' && name === 'ask' && kind === 'tap') return this.requestSubmit();
    }
  }

  cancelAll() {
    this.speaker?.stop();
    if (this.state === 'working' || this.state === 'confirm') return this.stop();
    if (this.state === 'listening' || this.state === 'finishing') {
      this.speech.cancel();
      this.unduck();
    }
    this.close();
  }

  makeTools(vision = true) {
    return buildTools({ mac: this.mac, firefox: this.bridge, overlay: this.overlay, getScale: () => this.scale, visionCapable: vision });
  }

  // The same for every request: the time, front app and running apps travel with each request instead.
  claudeSystem() {
    return buildSystemPrompt({
      vocabulary: this.store.get('vocabulary'), routines: this.store.get('routines'), firefoxConnected: this.bridge.isConnected(),
      screen: (this.disp || screen.getPrimaryDisplay()).size, visionCapable: true, withContext: false
    });
  }

  // Starts Claude while you are still talking or typing. Its first answer then starts with the request,
  // not with a second of start-up.
  async warmUp() {
    if (this.store.get('settings.model.provider') !== 'claude' || this.warm?.alive || this.warming) return;
    this.warming = true;
    try {
      const claudePath = await findClaude();
      if (!claudePath) return;
      await this.mcp.start();
      if (this.warm?.alive || !['listening', 'finishing', 'input'].includes(this.state)) return;
      this.warm = new ClaudeSession({ claudePath, host: this.mcp, system: this.claudeSystem(), tools: this.makeTools(), model: 'haiku' });
      clearTimeout(this.warmTimer);
      this.warmTimer = setTimeout(() => this.dropWarm(), 90000);
    } catch {
      this.warm = null;
    } finally {
      this.warming = false;
    }
  }

  // Closes a Claude process that was started early and never used. One that has taken part in a conversation
  // is kept (for follow-ups like "make that bigger") unless force is set.
  dropWarm(force = false) {
    if (!force && this.warm?.turns > 0) return;
    clearTimeout(this.warmTimer);
    this.warm?.close();
    this.warm = null;
  }

  // Keeps the conversation going for a few minutes, so a follow-up has context and starts instantly.
  keepConversation(session, res) {
    if (!session.alive || res.status !== 'done' || res.fatal || session.turns >= 8) return session.close();
    this.warm = session;
    clearTimeout(this.warmTimer);
    this.warmTimer = setTimeout(() => this.dropWarm(true), 5 * 60 * 1000);
  }

  // The last couple of exchanges, for a fresh process or a provider with no memory of its own.
  followUpContext() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    const recent = (this.store.get('history') || []).filter((h) => h.ts > cutoff && h.status === 'done').slice(0, 2).reverse();
    if (!recent.length) return '';
    return `Recent conversation, for follow-ups such as "undo that" or "make it bigger":\n${recent.map((h) => `User: ${h.text}\nRelay: ${h.reply}`).join('\n')}`;
  }

  // Looks up the front app and the running apps while you are still talking, so the request starts at once.
  prefetch() {
    this.frontP = fastFrontmost().catch(() => this.mac.frontmostApp()).then((n) => (/^(relay-glass|relay-speech)$/.test(n) ? this.prevApp : n)).catch(() => null);
    this.appsP = this.mac.listApps().catch(() => []);
    this.appsP.then((a) => { if (a.length) this.lastApps = a; });
  }

  // ----- voice -----
  async micAllowed() {
    let status = systemPreferences.getMediaAccessStatus?.('microphone') ?? 'granted';
    if (status === 'not-determined') {
      const ok = await systemPreferences.askForMediaAccess('microphone');
      status = ok ? 'granted' : 'denied';
    }
    return status === 'granted';
  }

  async listen(mode, held) {
    clearTimeout(this.doneTimer);
    this.mode = mode;
    this.heldStart = held;
    this.listenStartedAt = Date.now();
    this.state = 'listening';
    this.speaker?.stop(); // the microphone must not hear Relay talking
    this.prefetch();
    if (mode === 'ask') this.warmUp();
    this.prevApp = await this.frontP;
    if (this.state !== 'listening') return; // cancelled while we looked
    const win = this.ensureWindow();
    await this.ready;
    win.setFocusable(false);
    this.reveal({ reset: true, partial: '' }, 'inactive');
    this.sound('Tink');
    this.duck();
    try {
      if (!(await this.micAllowed())) throw new Error('Microphone access is off. Turn it on in Permissions.');
      if (this.state !== 'listening') return;
      await this.speech.listen(this.store.get('settings.speech.input') || 'auto');
    } catch (e) {
      return this.listenFailed(e);
    }
    if (this.state !== 'listening') this.speech.cancel(); // cancelled while the microphone was opening
  }

  listenFailed(e) {
    this.unduck();
    this.speech.cancel();
    if (this.state === 'idle') return;
    // Fall back to the typing box so the request is not lost.
    this.state = 'input';
    this.mode = 'type';
    const win = this.ensureWindow();
    win.setFocusable(true);
    this.reveal({ reset: true, typed: true, notice: `${e.message} You can type instead.` }, 'focus');
  }

  async finishListening() {
    if (this.state !== 'listening') return;
    this.state = 'finishing';
    this.push({ finishing: true });
    let text = '';
    try {
      text = await this.speech.finish();
    } catch (e) {
      this.unduck();
      return this.notice(e.message, 'failed');
    }
    this.unduck();
    if (this.state !== 'finishing') return; // cancelled
    if (!text) return this.notice("I didn't catch that.", 'failed');
    text = applyReplacements(text, this.store.get('replacements'));
    if (this.mode === 'dictate') return this.insertDictation(text);
    this.state = 'input';
    return this.submit(text);
  }

  async insertDictation(text) {
    this.state = 'idle';
    this.hideSoft();
    const cmd = applyDictationCommands(text);
    if (cmd.scratchOnly) {
      const r = await this.scratchLast();
      return r.ok ? this.sound('Pop') : this.notice(r.reason, 'failed');
    }
    if (!cmd.text) return;
    const app = this.prevApp;
    const shaped = applyStyle(cmd.text, styleFor(this.store.get('settings.appStyles'), app));
    const entry = { id: crypto.randomUUID(), text: shaped.text, ts: Date.now() };
    this.store.addDictation(entry);
    this.onChange();
    try {
      // The pill never takes focus, so the app you were typing in still has it.
      const front = await this.mac.frontmostApp().catch(() => null);
      if (this.prevApp && front && front !== this.prevApp && HELPER_RE.test(front)) await this.mac.focusApp(this.prevApp);
      await this.mac.typeText(shaped.text);
      if (shaped.pressReturn) {
        await new Promise((r) => setTimeout(r, 150));
        await this.mac.pressKeys('return');
      }
      this.lastDictation = { id: entry.id, ts: Date.now(), app, returned: shaped.pressReturn };
      this.lastAction = { kind: 'dictation', ts: Date.now() };
      this.sound('Pop');
    } catch (e) {
      this.notice(`Could not type that: ${e.message}`, 'failed');
    }
  }

  // "Scratch that": undo the last thing dictated, if it is recent and you are still in the same app.
  async scratchLast() {
    const d = this.lastDictation;
    const front = await this.mac.frontmostApp().catch(() => null);
    if (!d || Date.now() - d.ts > 3 * 60 * 1000 || d.returned || (d.app && front && front !== d.app)) return { ok: false, reason: 'Nothing to scratch.' };
    try {
      await this.mac.pressKeys('cmd+z');
    } catch (e) {
      return { ok: false, reason: `Could not undo that: ${e.message}` };
    }
    this.lastDictation = null;
    if (this.lastAction?.kind === 'dictation') this.lastAction = null;
    this.store.data.dictations = this.store.data.dictations.filter((x) => x.id !== d.id);
    this.store.save();
    this.onChange();
    return { ok: true };
  }

  // A short message in the pill that closes itself.
  notice(text, status = 'done') {
    this.state = 'done';
    const win = this.ensureWindow();
    win.setFocusable(false);
    this.reveal({ reply: text, status }, 'inactive');
    this.sound(status === 'done' ? 'Pop' : 'Basso');
    clearTimeout(this.doneTimer);
    this.doneTimer = setTimeout(() => {
      if (this.state === 'done') this.close();
    }, 2500);
  }

  // ----- lifecycle -----
  async open({ typed = false } = {}) {
    clearTimeout(this.doneTimer);
    if (this.state === 'working' || this.state === 'confirm') return;
    this.speaker?.stop();
    this.prefetch();
    this.prevApp = await this.frontP;
    this.mode = 'type';
    this.state = 'input';
    this.warmUp();
    const win = this.ensureWindow();
    await this.ready;
    this.state = 'input';
    win.setFocusable(true);
    this.reveal({ typed: true, reset: true }, 'focus');
    this.sound('Tink');
  }

  close() {
    clearTimeout(this.doneTimer);
    this.state = 'idle';
    this.dropWarm();
    this.hideSoft();
  }

  requestSubmit() {
    // Ask the renderer for its current text, then it calls ask:submit.
    this.push({ requestSubmit: true });
  }

  stop() {
    this.abort?.abort();
    if (this.pendingConfirm) {
      this.pendingConfirm(false);
      this.pendingConfirm = null;
    }
  }

  async submit(raw) {
    const text = String(raw || '').trim();
    if (!text) return this.close();
    if (this.state !== 'input') return;

    if (!this.store.get('settings.actEnabled')) {
      this.state = 'idle';
      this.hideSoft();
      if (this.prevApp) await this.mac.focusApp(this.prevApp).catch(() => {});
      await this.mac.typeText(text).catch(() => {});
      return;
    }
    await this.handleText(text);
  }

  async handleText(text) {
    const routines = this.store.get('routines');
    const cmd = parseCommand(text, routines, { recording: !!this.recording });
    this.state = 'working';
    this.win.setFocusable(false);
    this.push({ label: 'Thinking', text });

    const entry = { id: crypto.randomUUID(), text, status: 'working', reply: '', ts: Date.now() };
    switch (cmd.type) {
      case 'routine-start':
        this.recording = [];
        return this.finish(entry, { status: 'done', reply: 'Recording a routine. Do each step, then say save it as, and a name.' });
      case 'routine-save':
        return this.finish(entry, this.saveRoutine(cmd));
      case 'routine-inline':
        this.upsertRoutine(cmd.name, cmd.steps);
        return this.finish(entry, { status: 'done', reply: `Saved routine "${cmd.name}" with ${cmd.steps.length} step${cmd.steps.length === 1 ? '' : 's'}.` });
      case 'routine-run':
        return this.runRoutine(cmd.routine, entry);
      default: {
        if (isUndo(text)) return this.undoLast(entry);
        let effective = text;
        if (isAgain(text)) {
          if (!this.lastRequestText) return this.finish(entry, { status: 'failed', reply: 'There is nothing to repeat yet.', actions: 0 });
          effective = this.lastRequestText;
          this.push({ label: 'Doing it again', text: effective });
        }
        this.lastRequestText = effective;
        const quick = await this.tryQuick(effective, entry);
        return quick || this.runRequest(effective, entry);
      }
    }
  }

  // Simple commands ("open Notes", "volume down") run at once, without asking the model.
  quickContext() {
    return {
      timers: this.timers,
      brightness: { get: () => this.speech.brightness(), set: (v) => this.speech.brightness(v) },
      prevApp: this.prevApp,
      runningApps: this.lastApps
    };
  }

  // A timer or alarm went off: say so in the pill (if it is free) and with a sound.
  alert(text) {
    if (['idle', 'done'].includes(this.state)) this.notice(text, 'done');
    this.sound('Glass');
    setTimeout(() => this.sound('Glass'), 900);
  }

  async quick(text, requestId) {
    const q = parseQuick(text);
    if (!q) return null;
    try {
      const r = await runQuick(q, this.mac, this.quickContext());
      if (!r) return null;
      this.store.addAction({ id: crypto.randomUUID(), requestId, tool: r.tool, input: r.input, result: r.reply, ok: true, ts: Date.now() });
      this.onChange();
      return r;
    } catch {
      return null; // let the model try
    }
  }

  async tryQuick(text, entry) {
    const r = await this.quick(text, entry.id);
    if (!r) return null;
    this.lastOk = text;
    if (this.recording) this.recording.push(text);
    // Answers that change nothing (the time, a timer's status) leave "undo that" pointing at what came before.
    if (!r.readonly) this.lastAction = { kind: 'quick', ts: Date.now(), undo: r.undo };
    this.dropWarm();
    return this.finish(entry, { status: 'done', reply: r.reply, actions: 1 });
  }

  upsertRoutine(name, steps) {
    const routines = this.store.get('routines');
    const existing = routines.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.steps = steps;
    else routines.push({ id: crypto.randomUUID(), name, steps });
    this.store.save();
    this.onChange();
  }

  saveRoutine(cmd) {
    const steps = cmd.source === 'recording' ? this.recording : this.lastOk ? [this.lastOk] : [];
    if (!steps || !steps.length) return { status: 'failed', reply: 'There is nothing to save yet.' };
    this.upsertRoutine(cmd.name, steps);
    this.recording = null;
    return { status: 'done', reply: `Saved routine "${cmd.name}" with ${steps.length} step${steps.length === 1 ? '' : 's'}.` };
  }

  // Hands the keyboard back to the app you were in, so the model's tools act on it. Instant commands skip this:
  // "open Notes" should leave Notes in front, not send you back.
  refocus() {
    if (this.prevApp) this.mac.focusApp(this.prevApp).catch(() => {});
  }

  async runRoutine(routine, entry) {
    this.refocus();
    this.abort = new AbortController();
    let last = { status: 'done', reply: '' };
    for (let i = 0; i < routine.steps.length; i++) {
      this.push({ label: `${routine.name}: step ${i + 1} of ${routine.steps.length}`, text: routine.steps[i] });
      const quick = await this.quick(routine.steps[i], entry.id);
      last = quick ? { status: 'done', reply: quick.reply, actions: 1 } : await this.execute(routine.steps[i], entry.id);
      if (last.status !== 'done') break;
    }
    if (last.status === 'done') last.reply = routine.steps.length > 1 ? `Finished "${routine.name}".` : last.reply;
    return this.finish(entry, last);
  }

  async runRequest(text, entry, { internal = false } = {}) {
    this.refocus();
    this.abort = new AbortController();
    const res = await this.execute(text, entry.id);
    if (res.status === 'done' && !internal) {
      this.lastOk = text;
      if (this.recording) this.recording.push(text);
    }
    if (res.status === 'done') this.lastAction = internal ? null : { kind: 'model', ts: Date.now() };
    return this.finish(entry, res);
  }

  // "Undo that": reverse the last instant command, the last dictation, or ask Claude to reverse what it just did.
  async undoLast(entry) {
    const a = this.lastAction;
    if (!a || Date.now() - a.ts > 5 * 60 * 1000) return this.finish(entry, { status: 'failed', reply: 'There is nothing to undo.', actions: 0 });
    if (a.kind === 'quick') {
      if (!a.undo) return this.finish(entry, { status: 'failed', reply: "I can't undo that one.", actions: 0 });
      try {
        const reply = await a.undo();
        this.lastAction = null;
        this.store.addAction({ id: crypto.randomUUID(), requestId: entry.id, tool: 'undo', input: {}, result: reply, ok: true, ts: Date.now() });
        return this.finish(entry, { status: 'done', reply, actions: 1 });
      } catch (e) {
        return this.finish(entry, { status: 'failed', reply: `I could not undo that: ${e.message}`, actions: 0 });
      }
    }
    if (a.kind === 'dictation') {
      const r = await this.scratchLast();
      return this.finish(entry, { status: r.ok ? 'done' : 'failed', reply: r.ok ? 'Took back what you dictated.' : r.reason, actions: r.ok ? 1 : 0 });
    }
    return this.runRequest(
      'Undo what you just did for my previous request, if your tools can reverse it: close what you opened, put back what you changed, delete what you created. If it cannot be undone, such as a message that was sent, say so plainly and do nothing.',
      entry, { internal: true }
    );
  }

  // ----- the actual agent run -----
  buildProvider() {
    const m = this.store.get('settings.model');
    if (m.provider === 'ollama') {
      return { provider: new OllamaProvider({ url: m.ollamaUrl, model: m.ollamaModel }), vision: VISION_RE.test(m.ollamaModel) };
    }
    if (isPreset(m.provider)) return compatProvider(m);
    return { provider: new AnthropicProvider({ apiKey: decryptKey(m.anthropicKeyEnc), model: m.anthropicModel }), vision: true };
  }

  async execute(text, requestId) {
    // Use the list fetched while you were talking; never wait long for it.
    const runningApps = await Promise.race([this.appsP || this.mac.listApps().catch(() => []), new Promise((r) => setTimeout(() => r(this.lastApps), 500))]);
    const model = this.store.get('settings.model');
    const signedIn = model.provider === 'claude';
    const confirm = (q) => this.askConfirm(q);
    const signal = this.abort.signal;
    const onEvent = (e) => {
      if (e.type === 'escalate') this.push({ label: 'Thinking harder' });
      if (e.type === 'tool-start') this.push({ label: e.label || e.name.replace(/_/g, ' ') });
      if (e.type === 'tool') {
        this.store.addAction({ id: crypto.randomUUID(), requestId, tool: e.name, input: e.input, result: e.result, ok: e.ok, ts: Date.now() });
        this.onChange();
      }
    };
    if (signedIn) {
      // Take the Claude process that was started while you were talking, or start one now.
      let session = this.warm?.alive ? this.warm : null;
      this.warm = null;
      clearTimeout(this.warmTimer);
      let result = { status: 'failed' };
      try {
        if (!session) {
          const claudePath = await findClaude();
          if (!claudePath) return { status: 'failed', reply: 'Claude Code is not installed. Open Account in Relay for the one-line install.', actions: 0 };
          await this.mcp.start();
          session = new ClaudeSession({ claudePath, host: this.mcp, system: this.claudeSystem(), tools: this.makeTools(), model: 'haiku' });
        }
        const route = routeModel(text, model.claudeModel);
        const fresh = session.turns === 0;
        const context = [buildContext({ frontmost: this.prevApp, runningApps }), fresh ? this.followUpContext() : ''].filter(Boolean).join('\n\n');
        result = await runSmart({ session, text, context, model: route.model, escalate: route.escalate, confirm, onEvent, signal });
        return result;
      } catch (e) {
        if (signal.aborted) return { status: 'stopped', reply: 'Stopped.', actions: 0 };
        return { status: 'failed', reply: e.message, actions: 0 };
      } finally {
        if (session) this.keepConversation(session, result);
      }
    }
    const { provider, vision } = this.buildProvider();
    const display = screen.getPrimaryDisplay();
    const tools = this.makeTools(vision);
    const system = buildSystemPrompt({
      frontmost: this.prevApp, runningApps,
      vocabulary: this.store.get('vocabulary'), routines: this.store.get('routines'),
      firefoxConnected: this.bridge.isConnected(), screen: display.size, visionCapable: vision
    });
    const followUp = this.followUpContext();
    try {
      return await runAgent({ text: followUp ? `${followUp}\n\nRequest: ${text}` : text, tools, system, signal, confirm, onEvent, provider });
    } catch (e) {
      if (signal.aborted) return { status: 'stopped', reply: 'Stopped.', actions: 0 };
      return { status: 'failed', reply: e.message, actions: 0 };
    }
  }

  askConfirm(q) {
    return new Promise((resolve) => {
      this.state = 'confirm';
      this.win.setFocusable(true);
      this.pendingConfirm = (yes) => {
        this.pendingConfirm = null;
        this.state = 'working';
        this.win.setFocusable(false);
        this.push({ label: yes ? 'Working' : 'Skipping' });
        resolve(yes);
      };
      this.reveal({ question: q.question }, 'show');
      this.sound('Tink');
    });
  }

  finish(entry, res) {
    const reply = res.reply || '';
    this.store.addHistory({ ...entry, status: res.status, reply, actions: res.actions || 0, ...(res.model ? { model: res.model, escalated: !!res.escalated } : {}) });
    this.store.set('lastReply', reply);
    this.abort = null;
    this.state = 'done';
    this.push({ reply, status: res.status });
    this.overlay.hide();
    this.sound(res.status === 'done' ? 'Pop' : 'Basso');
    if (this.store.get('settings.speakReplies') && res.status === 'done') this.speaker?.speak(reply, { voice: this.store.get('settings.voice'), rate: this.store.get('settings.voiceRate') });
    this.onChange();
    clearTimeout(this.doneTimer);
    this.doneTimer = setTimeout(() => {
      if (this.state === 'done') this.close();
    }, Math.min(12000, 4000 + reply.length * 40));
    return res;
  }

  // Developer aid: RELAY_DEMO=listening|working|confirm|done|input shows the pill in that state.
  async demo(kind) {
    this.ensureWindow();
    await this.ready;
    this.mode = 'ask';
    this.state = { listening: 'listening', working: 'working', confirm: 'confirm', done: 'done', input: 'input' }[kind] || 'listening';
    const win = this.win;
    win.setFocusable(kind === 'input' || kind === 'confirm');
    const first = {
      listening: { reset: true, partial: 'Open Notes and make a note called groceries', level: 0.5 },
      working: { label: 'Opening Notes', text: 'Open Notes and make a note called groceries' },
      confirm: { question: 'Send "running late" to Sam?' },
      done: { reply: 'Made a note called groceries.', status: 'done' },
      input: { typed: true, reset: true }
    }[kind] || {};
    this.reveal(first, kind === 'input' ? 'focus' : 'inactive');
    if (kind === 'listening') {
      setInterval(() => this.push({ level: 0.15 + Math.random() * 0.7 }), 90);
    }
  }

  // ----- screenshot for the model -----
  async capture() {
    const d = screen.getPrimaryDisplay();
    const wasVisible = this.win && !this.win.isDestroyed() && this.win.isVisible();
    if (wasVisible) this.win.setOpacity(0);
    await new Promise((r) => setTimeout(r, 80));
    try {
      const pxW = Math.round(d.size.width * d.scaleFactor);
      const pxH = Math.round(d.size.height * d.scaleFactor);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: pxW, height: pxH } });
      const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
      if (!src) throw new Error('No screen source. Grant Screen Recording to Relay.');
      let img = src.thumbnail;
      if (img.isEmpty()) throw new Error('Screen capture returned an empty image. Grant Screen Recording to Relay in System Settings.');
      const maxW = 1400;
      if (img.getSize().width > maxW) img = img.resize({ width: maxW });
      const size = img.getSize();
      this.scale = d.size.width / size.width;
      return { mediaType: 'image/jpeg', data: img.toJPEG(75).toString('base64'), width: size.width, height: size.height };
    } finally {
      if (wasVisible) this.win.setOpacity(1);
    }
  }
}

module.exports = { AskController, encryptKey, decryptKey, compatProvider };
