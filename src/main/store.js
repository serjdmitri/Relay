const fs = require('fs');
const path = require('path');
const { PRESETS } = require('./agent/providers/presets');

const SCHEMA = 3;

const DEFAULTS = {
  schema: SCHEMA,
  onboardingDone: false,
  skillSuggestions: [], // proposed routines; never run without review and approval
  settings: {
    talking: 'tap-or-hold', // tap-or-hold | tap | hold
    playSounds: true,
    duckAudio: true, // lower other audio while listening
    meeting: { hidden: true, nameOnly: false, names: '', input: '' }, // private answers in meetings: hide the window from screen sharing, answer only when your name is said, the names, the audio source ("" = the microphone setting)
    failover: { codex: true, until: 0 }, // when Claude is out of usage, carry on with Codex (signed in with ChatGPT) without a word; `until` is when Claude is tried again
    recap: { enabled: true, hour: 20, minute: 30, lastRun: '' }, // each evening: a notification with what Relay did today, and what can be undone
    robotics: { lists: {}, sheetId: '' }, // checklists you edited (the standard ones are built in), and the Google Sheet that "log this" adds a line to
    homeOnly: true, // ask before a tool touches anything outside the home folder (a drive in /Volumes, /Applications, /etc); background agents are refused instead
    homework: { full: true, explain: true, format: 'docx', voiceSample: '', voiceStyle: '' }, // the homework helper: allow whole solutions, add a "How it works" section, Word | PDF | text, a sample of your writing and how you describe your voice
    flags: { panels: true }, // custom panels require approval; other experimental features are off by default
    proactive: { mode: 'silent-urgent', quiet: { on: true, from: 22, to: 7 } }, // Relay speaking up on its own: silent | silent-urgent | speak, and quiet hours
    notes: { folders: [] }, // folders "ask my notes" may read (Settings > Doctor > Ask my notes)
    inbound: { unanswered: 'expire' }, // a question nobody answers (on the Mac or by text): expire after 30 minutes | reask (hourly, 3 times) | forever
    doctor: { fix: 'ask' }, // when Relay Doctor finds something fixable: ask | small (small fixes run themselves) | never
    recentDelay: 140, // milliseconds the pointer must rest on the left-edge tab before the Recent menu opens (0 to 1500)
    welcome: { enabled: true, name: 'Sir', minAwayMin: 5, repeatMin: 10, speak: true, show: true }, // "Welcome back, Sir" with what happened, when you unlock after being away a while
    workMode: 'personal', // response style for the user's current context
    fastMode: true, // faster answers: no extended thinking, less re-checking of what it just did (off: slower, double-checks)
    answerStays: true, // an answer (and its card) stays on screen until you say ok, press Esc or ask the next thing
    actEnabled: true, // off: Relay only types what you say into the previous app
    cursor: true,
    look: 'jarvis', // the interface look of the pill, the buddy and guides: 'jarvis' | 'classic'
    wake: { enabled: false, phrase: 'hey jarvis', apps: [] }, // listen for a wake phrase while Relay is idle (on-device). apps: only while one of these is in front; empty means always
    workshop: { enabled: false, prevSpeak: false }, // workshop mode: teaching younger students (slower calm voice, simple wording); prevSpeak remembers whether replies were spoken before
    clipboardHistory: { enabled: true, minutes: 1440 }, // "what did I copy earlier": text only, kept in memory (never on disk) for this many minutes; never passwords or keys
    briefing: { city: '', name: '', units: 'f' }, // the morning briefing: where to get the weather for (a city name), what to call you, f or c
    language: { reply: 'auto', ui: 'en' }, // what language answers come in: auto (the one you asked in) or a code like 'es'
    followUp: { enabled: true, seconds: 6 }, // after a spoken ask is answered, keep listening this many seconds for the next thing
    bargeIn: { enabled: true, mode: 'talk' }, // talk over Relay to stop it (talk), or only by saying stop (word); works best with headphones
    focus: { apps: ['Messages', 'Slack', 'Discord', 'Mail', 'Telegram', 'WhatsApp', 'Steam', 'Twitter', 'Instagram', 'Facebook', 'Reddit'], minutes: 25, shortcutOn: 'Relay Focus On', shortcutOff: 'Relay Focus Off', reopen: true }, // focus mode by voice: apps it closes, default length, and the two Shortcuts that switch Do Not Disturb
    downloadsTidy: { enabled: true, hour: 21, minute: 0, lastRun: '' }, // each evening: work out where new downloads belong and SHOW it (nothing moves until you say yes; nothing is ever deleted)
    voices: { quiet: { volume: 0.55 }, reading: {} }, // how confirmations and long answers sound (see voiceProfile.js)
    assistantName: 'J.A.R.V.I.S', // the name shown in the middle of the reactor
    hfTokenEnc: '', // an optional free Hugging Face token: more free GPU time for the better 3D generators (TRELLIS)
    models3dFromPhotos: true, // make realistic 3D models from real photos with a free online service (only the public photo is sent)
    models3d: true, // show a 3D model you can turn: a real one when there is one, else built from shapes
    cards: true, // answer cards with a picture, facts and links
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
    notify: { enabled: false, channel: 'ntfy', ntfyTopic: '', ntfyServer: 'https://ntfy.sh', imessageTo: '', minSeconds: 30, includeText: false }, // tell the phone when a long job finishes (see notify.js)
    remote: { enabled: false, lan: true, port: 47900, tailscaleServing: false }, // Relay Remote: talk to Relay from your phone
    connectors: { // Notion (a token you paste) and Google (your own OAuth app, several accounts): secrets are encrypted
      notion: { tokenEnc: '', name: '' },
      google: { clientId: '', clientSecretEnc: '', accounts: [] }, // accounts: { email, refreshEnc }
      apps: { url: '', headerName: 'x-api-key', keyEnc: '', count: 0 } // Composio (or any MCP server): its address and key
    },
    holoUi: { controls: 'menu', spin: true, spinDelay: 10, dragFormat: 'stl', pointsPerInch: 125 }, // holograms: where the controls are (menu, side, bar), slow turning, and how long to leave it alone after a touch
    presence: { enabled: false, awayAfter: 60, pause: true, resume: true, lock: false }, // opt-in: the camera counts faces once a second; when nobody has been there for a while, pause the music (and lock if asked)
    hands: { enabled: false, preview: false, margin: 0.12 }, // Hand control: move holograms in the air through the camera (opt-in)
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
  stickies: [], // sticky notes on the screen: { id, text, color, x, y } (see stickies.js)
  stickiesHidden: false,
  holoLibrary: [], // every hologram that has been on screen, with a small picture (see holo/library.js)
  holoScenes: [], // saved sets of holograms: where each is and how big
  history: [], // {id, text, status, reply, ts, actions}
  dictations: [], // {id, text, ts}
  actions: [], // {id, requestId, tool, input, result, ok, ts}
  routines: [], // {id, name, steps: string[]}
  timers: [], // {id, endsAt, seconds, label}
  replacements: [], // {id, from, to}: word fixes applied to dictation and requests
  vocabulary: [], // strings
  memories: [], // {id, text, ts}: what you told Relay to remember
  inboundState: { paired: false, last: 0 }, // Command Relay by text: paired with your own thread, the last message read
  toolMisses: [], // times the model had to ask for a hidden tool group (Fewer tools per request), for Doctor
  queue: [], // texts waiting to run (see queue.js)
  lessons: [], // {id, trigger, fix, conf, ts, lastUsed, uses}: learned from your corrections (Smarter memory, lessons.js)
  inferred: [], // {id, text, status: pending | approved, conf, ts}: things Relay noticed about you; unused until you approve
  holograms: [], // pinned holograms: where they are and links to their models (never the model files)
  remoteDevices: [], // paired phones: { id, name, hash, created, lastSeen } (only a hash of each token)
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
