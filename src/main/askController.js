const { app, BrowserWindow, screen, clipboard, desktopCapturer, safeStorage } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const { parseCommand } = require('./commands');
const { runAgent } = require('./agent/loop');
const { buildTools } = require('./agent/tools');
const { buildSystemPrompt } = require('./agent/system-prompt');
const { AnthropicProvider } = require('./agent/providers/anthropic');
const { OllamaProvider } = require('./agent/providers/ollama');
const { createMac } = require('./agent/mac');

const PILL_W = 480;
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

function encryptKey(key) {
  if (!key) return '';
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(key).toString('base64');
  return 'plain:' + key;
}

class AskController {
  constructor({ store, bridge, overlay, onChange }) {
    this.store = store;
    this.bridge = bridge;
    this.overlay = overlay;
    this.onChange = onChange;
    this.state = 'idle'; // idle | input | working | confirm | done
    this.win = null;
    this.abort = null;
    this.pendingConfirm = null;
    this.prevApp = null;
    this.suspended = false; // true while a shortcut is being recorded in the UI
    this.recording = null; // string[] while recording a routine
    this.lastOk = null;
    this.scale = 1;
    this.doneTimer = null;
    this.clipTimer = null;
    this.mac = createMac({ clipboard, capture: () => this.capture() });
  }

  // ----- window -----
  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: PILL_W, height: 60, show: false, frame: false, transparent: true, resizable: false, hasShadow: true,
      skipTaskbar: true, alwaysOnTop: true, type: 'panel', fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Messages sent before the page registers its listener are lost, so callers await this.
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.win.loadFile(path.join(__dirname, '../renderer/ask.html'));
    return this.win;
  }

  position(height) {
    const d = screen.getPrimaryDisplay();
    const x = Math.round(d.bounds.x + (d.bounds.width - PILL_W) / 2);
    const y = d.workArea.y + 8;
    this.win.setBounds({ x, y, width: PILL_W, height: Math.max(48, Math.round(height)) });
  }

  resize(h) {
    if (this.win && !this.win.isDestroyed()) this.position(h);
  }

  push(extra = {}) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('ask:state', {
      state: this.state,
      askLabel: require('./shortcuts').label(this.store.get('settings.shortcuts.ask')),
      ...extra
    });
  }

  sound(name) {
    if (!this.store.get('settings.playSounds')) return;
    execFile('afplay', [`/System/Library/Sounds/${name}.aiff`], () => {});
  }

  // ----- shortcut events -----
  onShortcut(name, kind) {
    if (this.suspended) return;
    const mode = this.store.get('settings.talking');
    if (name === 'type') {
      if (kind !== 'press') return;
      if (this.state === 'idle') return this.open({ typed: true });
      if (this.state === 'input') return this.close();
      return;
    }
    // ask shortcut
    if (kind === 'tap' && mode === 'hold') return;
    if ((kind === 'hold-start' || kind === 'hold-end') && mode === 'tap') return;

    if (this.state === 'working' || this.state === 'confirm') {
      if (kind === 'tap' || kind === 'hold-start') this.stop();
      return;
    }
    if (kind === 'tap' || kind === 'hold-start') {
      if (this.state === 'idle' || this.state === 'done') return this.open();
      if (this.state === 'input' && kind === 'tap') return this.requestSubmit();
      return;
    }
    if (kind === 'hold-end' && this.state === 'input') this.requestSubmit();
  }

  // ----- lifecycle -----
  async open({ typed = false } = {}) {
    clearTimeout(this.doneTimer);
    if (this.state === 'working' || this.state === 'confirm') return;
    try {
      this.prevApp = await Promise.race([this.mac.frontmostApp(), new Promise((r) => setTimeout(() => r(null), 800))]);
    } catch {
      this.prevApp = null;
    }
    const win = this.ensureWindow();
    await this.ready;
    this.state = 'input';
    win.setFocusable(true);
    this.position(60);
    this.push({ typed, reset: true });
    win.show();
    if (this.store.get('settings.pillActivates')) app.focus({ steal: true });
    win.focus();
    this.sound('Tink');
    this.startClipboardWatch();
  }

  startClipboardWatch() {
    // Talkify normally pastes into the focused field. If focus was missed, it still copies
    // to the clipboard, so pick the new clipboard text up as the request.
    clearInterval(this.clipTimer);
    let last = clipboard.readText();
    this.clipTimer = setInterval(() => {
      const now = clipboard.readText();
      if (now !== last) {
        last = now;
        this.push({ clipboardText: now });
      }
    }, 200);
  }

  close() {
    clearInterval(this.clipTimer);
    clearTimeout(this.doneTimer);
    this.state = 'idle';
    if (this.win && !this.win.isDestroyed()) this.win.hide();
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
    clearInterval(this.clipTimer);
    if (!text) return this.close();
    if (this.state !== 'input') return;

    if (!this.store.get('settings.actEnabled')) {
      this.state = 'idle';
      this.win.hide();
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
    if (this.prevApp) this.mac.focusApp(this.prevApp).catch(() => {});

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
      default:
        return this.runRequest(text, entry);
    }
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

  async runRoutine(routine, entry) {
    this.abort = new AbortController();
    let last = { status: 'done', reply: '' };
    for (let i = 0; i < routine.steps.length; i++) {
      this.push({ label: `${routine.name}: step ${i + 1} of ${routine.steps.length}`, text: routine.steps[i] });
      last = await this.execute(routine.steps[i], entry.id);
      if (last.status !== 'done') break;
    }
    if (last.status === 'done') last.reply = routine.steps.length > 1 ? `Finished "${routine.name}".` : last.reply;
    return this.finish(entry, last);
  }

  async runRequest(text, entry) {
    this.abort = new AbortController();
    const res = await this.execute(text, entry.id);
    if (res.status === 'done') {
      this.lastOk = text;
      if (this.recording) this.recording.push(text);
    }
    return this.finish(entry, res);
  }

  // ----- the actual agent run -----
  buildProvider() {
    const m = this.store.get('settings.model');
    if (m.provider === 'ollama') {
      return { provider: new OllamaProvider({ url: m.ollamaUrl, model: m.ollamaModel }), vision: VISION_RE.test(m.ollamaModel) };
    }
    return { provider: new AnthropicProvider({ apiKey: decryptKey(m.anthropicKeyEnc), model: m.anthropicModel }), vision: true };
  }

  async execute(text, requestId) {
    let runningApps = [];
    try {
      runningApps = await this.mac.listApps();
    } catch {}
    const { provider, vision } = this.buildProvider();
    const display = screen.getPrimaryDisplay();
    const tools = buildTools({
      mac: this.mac,
      firefox: this.bridge,
      overlay: this.overlay,
      getScale: () => this.scale,
      visionCapable: vision
    });
    const system = buildSystemPrompt({
      frontmost: this.prevApp, runningApps,
      vocabulary: this.store.get('vocabulary'), routines: this.store.get('routines'),
      firefoxConnected: this.bridge.isConnected(), screen: display.size, visionCapable: vision
    });
    try {
      return await runAgent({
        text, provider, tools, system, signal: this.abort.signal,
        confirm: (q) => this.askConfirm(q),
        onEvent: (e) => {
          if (e.type === 'tool-start') this.push({ label: e.label || e.name.replace(/_/g, ' ') });
          if (e.type === 'tool') {
            this.store.addAction({ id: crypto.randomUUID(), requestId, tool: e.name, input: e.input, result: e.result, ok: e.ok, ts: Date.now() });
            this.onChange();
          }
        }
      });
    } catch (e) {
      if (this.abort.signal.aborted) return { status: 'stopped', reply: 'Stopped.', actions: 0 };
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
      this.push({ question: q.question });
      this.win.show();
      this.sound('Tink');
    });
  }

  finish(entry, res) {
    const reply = res.reply || '';
    this.store.addHistory({ ...entry, status: res.status, reply, actions: res.actions || 0 });
    this.store.set('lastReply', reply);
    this.abort = null;
    this.state = 'done';
    this.push({ reply, status: res.status });
    this.overlay.hide();
    this.sound(res.status === 'done' ? 'Pop' : 'Basso');
    if (this.store.get('settings.speakReplies') && res.status === 'done') execFile('say', [reply], () => {});
    this.onChange();
    clearTimeout(this.doneTimer);
    this.doneTimer = setTimeout(() => {
      if (this.state === 'done') this.close();
    }, Math.min(12000, 4000 + reply.length * 40));
    return res;
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

module.exports = { AskController, encryptKey, decryptKey };
