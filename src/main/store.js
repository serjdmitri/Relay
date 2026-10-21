const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  onboardingDone: false,
  settings: {
    talking: 'tap-or-hold', // tap-or-hold | tap | hold
    playSounds: true,
    actEnabled: true, // off: Relay only types what you say into the previous app
    cursor: true,
    speakReplies: false,
    pillActivates: true, // bring Relay forward while asking so Talkify's paste lands in the request box
    openAtLogin: false,
    showInDock: true,
    shortcuts: {
      ask: { code: 'AltRight', mods: [] },
      type: { code: 'KeyT', mods: ['Alt'] }
    },
    model: {
      provider: 'anthropic', // anthropic | ollama
      anthropicModel: 'claude-sonnet-5-5',
      ollamaModel: 'qwen2.5:14b',
      ollamaUrl: 'http://127.0.0.1:11434',
      anthropicKeyEnc: '' // base64 of safeStorage ciphertext
    },
    firefox: { enabled: false, port: 47831 }
  },
  history: [], // {id, text, status, reply, ts, actions}
  actions: [], // {id, requestId, tool, input, result, ok, ts}
  routines: [], // {id, name, steps: string[]}
  vocabulary: [], // strings
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

  addAction(entry) {
    this.data.actions.unshift(entry);
    this.data.actions = this.data.actions.slice(0, 1000);
    this.save();
  }

  stats() {
    const h = this.data.history;
    const words = h.reduce((n, x) => n + (x.text.trim() ? x.text.trim().split(/\s+/).length : 0), 0);
    const actions = this.data.actions.length;
    // rough estimate: typing 40 wpm vs speaking, plus ~20s per automated action
    const seconds = Math.round((words / 40) * 60 + actions * 20);
    return { requests: h.length, actions, words, minutesSaved: Math.round(seconds / 60) };
  }
}

module.exports = { Store, DEFAULTS, merge };
