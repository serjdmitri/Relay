const fs = require('fs');
const path = require('path');
const { PRESETS } = require('./agent/providers/presets');

const SCHEMA = 3;

const DEFAULTS = {
  schema: SCHEMA,
  onboardingDone: false,
  settings: {
    talking: 'tap-or-hold', // tap-or-hold | tap | hold
    playSounds: true,
    duckAudio: true, // lower other audio while listening
    actEnabled: true, // off: Relay only types what you say into the previous app
    cursor: true,
    look: 'jarvis', // the interface look of the pill, the buddy and guides: 'jarvis' | 'classic'
    wake: { enabled: false, phrase: 'hey jarvis' }, // listen for a wake phrase while Relay is idle (on-device)
    assistantName: 'J.A.R.V.I.S', // the name shown in the middle of the reactor
    showUsage: true, // a small line under the answer: model, time, tokens (never spoken)
    memory: true, // remember facts you tell it, and use them in every request
    learnWords: true, // after you dictate, notice words you fixed by hand and learn them
    recent: true, // a glass list of recent asks opens when you rest the pointer on the left edge
    buddy: true, // a small helper follows your pointer while Relay works
    speakReplies: false,
    dictation: true, // off: the Dictate shortcut (right ⌘) does nothing
    saveDictation: true, // off: dictated text is typed but not kept in History
    glass: true, // draw the pill as real see-through glass when this Mac can
    voice: 'auto', // auto, or a voice name from `say -v ?`
    voiceRate: 'normal', // slower | normal | faster
    tts: { // which voice speaks replies: system | kokoro (on this Mac) | openai | elevenlabs (your own key)
      engine: 'system',
      kokoro: { voice: 'af_heart' },
      openai: { model: 'gpt-4o-mini-tts', voice: 'coral', instructions: 'Speak naturally and warmly, like a helpful friend. Keep a relaxed pace.', keyEnc: '' },
      elevenlabs: { voiceId: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2', keyEnc: '' }
    },
    openAtLogin: false,
    showInDock: true,
    shortcuts: {
      ask: { code: 'AltRight', mods: [] },
      dictate: { code: 'MetaRight', mods: [] },
      type: { code: 'KeyT', mods: ['Alt'] },
      mark: { code: 'ControlLeft', mods: [] } // hold it, circle something, let go
    },
    speech: { locale: 'en-US', input: 'auto' }, // input: auto | default | a device UID
    appStyles: [], // {app, style}: dictation style per app (default | casual | chat)
    model: {
      provider: 'claude', // claude (signed in with your Claude account) | anthropic (API key) | ollama | a key of PRESETS (openai, gemini, ...)
      claudeModel: 'auto', // auto (Haiku for simple requests, Sonnet when it is harder) | haiku | sonnet | opus
      anthropicModel: 'claude-sonnet-5-5',
      ollamaModel: 'qwen2.5:14b',
      ollamaUrl: 'http://127.0.0.1:11434',
      anthropicKeyEnc: '', // base64 of safeStorage ciphertext
      // OpenAI-compatible services: one model and one encrypted key each (custom also keeps its address)
      presets: Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, { model: p.model, keyEnc: '', ...(id === 'custom' ? { url: '' } : {}) }]))
    },
    firefox: { enabled: false, port: 47831 }
  },
  history: [], // {id, text, status, reply, ts, actions}
  dictations: [], // {id, text, ts}
  actions: [], // {id, requestId, tool, input, result, ok, ts}
  routines: [], // {id, name, steps: string[]}
  timers: [], // {id, endsAt, seconds, label}
  replacements: [], // {id, from, to}: word fixes applied to dictation and requests
  vocabulary: [], // strings
  memories: [], // {id, text, ts}: what you told Relay to remember
  schedules: [], // requests to run later or on repeat: see schedule.js
  corrections: {}, // fixes seen once, waiting for a second sighting: { 'from>to': count }
  lastReply: ''
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = k in base ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'relay.json');
    let loaded = {};
    try {
      loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    this.data = merge(JSON.parse(JSON.stringify(DEFAULTS)), loaded);
    const from = loaded.schema || 1;
    if (from < 2) {
      // Version 1 needed a pasted API key or Ollama. Version 2 signs in with your Claude account.
      this.data.settings.model.provider = 'claude';
      this.data.onboardingDone = false; // show the new setup once: sign in, microphone, dictation
    }
    if (from < 3 && this.data.settings.model.claudeModel === 'sonnet') {
      this.data.settings.model.claudeModel = 'auto'; // Sonnet was only the old default
    }
    this.data.schema = SCHEMA;
    this._timer = null;
  }

  get(key) {
    return key.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
  }

  set(key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    const target = parts.reduce((o, k) => o[k], this.data);
    target[last] = value;
    this.save();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this._timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  addHistory(entry) {
    this.data.history.unshift(entry);
    this.data.history = this.data.history.slice(0, 500);
    this.save();
  }

  updateHistory(id, patch) {
    const h = this.data.history.find((x) => x.id === id);
    if (h) Object.assign(h, patch);
    this.save();
  }

  addDictation(entry) {
    if (this.data.settings.saveDictation === false) return;
    this.data.dictations.unshift(entry);
    this.data.dictations = this.data.dictations.slice(0, 500);
    this.save();
  }

  addAction(entry) {
    this.data.actions.unshift(entry);
    this.data.actions = this.data.actions.slice(0, 1000);
    this.save();
  }

  stats() {
    const h = this.data.history;
    const count = (list) => list.reduce((n, x) => n + (x.text.trim() ? x.text.trim().split(/\s+/).length : 0), 0);
    const words = count(h) + count(this.data.dictations);
    const actions = this.data.actions.length;
    // rough estimate: typing 40 wpm vs speaking, plus ~20s per automated action
    const seconds = Math.round((words / 40) * 60 + actions * 20);
    return { requests: h.length, actions, words, minutesSaved: Math.round(seconds / 60) };
  }
}

module.exports = { Store, DEFAULTS, SCHEMA, merge };
