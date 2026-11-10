const { DEFAULTS: CALL_DEFAULTS } = require('./calls/service');
const fs = require('fs');
const path = require('path');
const { PRESETS } = require('./agent/providers/presets');

const SCHEMA = 3;

const DEFAULTS = {
  schema: SCHEMA,
  onboardingDone: false,
  panelLayouts: [], // saved panel and hologram arrangements
  skillSuggestions: [], // proposed routines; never run without review and approval
  settings: {
    calls: { ...CALL_DEFAULTS, keyEnc: '' },
    driveRoots: [], // explicitly selected file-workspace folders
    menuSnap: true, // align floating menus near a screen edge without resizing
    talking: 'tap-or-hold', // tap-or-hold | tap | hold
    playSounds: true,
    soundVolume: 1, // volume of state cues, independent of spoken replies
    duckAudio: true, // lower other audio while listening
    meeting: { hidden: true, nameOnly: false, names: '', input: '' }, // private answers in meetings: hide the window from screen sharing, answer only when your name is said, the names, the audio source ("" = the microphone setting)
    failover: { codex: true, until: 0 }, // when Claude is out of usage, carry on with Codex (signed in with ChatGPT) without a word; `until` is when Claude is tried again
    recap: { enabled: true, hour: 20, minute: 30, lastRun: '' }, // each evening: a notification with what Relay did today, and what can be undone
    robotics: { lists: {}, sheetId: '' }, // checklists you edited (the standard ones are built in), and the Google Sheet that "log this" adds a line to
    clutter: { enabled: true }, // every few hours Relay looks at the folders you chose and tells you quietly when one is cluttered; a preview of tidying it is one click in Files settings
    quick: { enabled: true, model: 'llama-3.1-8b-instant', keyEnc: '' }, // plain questions go straight to Groq's free tier for a faster answer (needs a Groq key); anything personal, timely or involving this Mac never does
    overnight: { enabled: true, from: 1, to: 6 }, // work you hand Relay for the night runs between these hours (24-hour clock), one task at a time, only if the Mac is awake and Relay is open; the report comes in the morning
    filePermissions: { levels: { low: 'allow', medium: 'allow', high: 'ask', critical: 'ask-mac' } }, // how risky a file operation is (low, medium, high, critical) and what to do about each: allow | ask | ask-mac (only at this Mac) | deny
    homeOnly: true, // ask before a tool touches anything outside the home folder (a drive in /Volumes, /Applications, /etc); background agents are refused instead
    homework: { full: true, explain: true, format: 'docx', voiceSample: '', voiceStyle: '' }, // the homework helper: allow whole solutions, add a "How it works" section, Word | PDF | text, a sample of your writing and how you describe your voice
    flags: { panels: true }, // custom panels require approval; other experimental features are off by default
    notifications: { enabled: false, speak: false }, // read the Mac's notifications (notifications.js); needs Full Disk Access
    mail: { enabled: false, everyMin: 3, vip: [] }, // tell me about new email (mailWatch.js); needs a connected Google account
    proactive: { mode: 'silent-urgent', quiet: { on: true, from: 22, to: 7 } }, // Relay speaking up on its own: silent | silent-urgent | speak, and quiet hours
    notes: { folders: [] }, // folders "ask my notes" may read (Settings > Doctor > Ask my notes)
    inbound: { unanswered: 'expire' }, // a question nobody answers (on the Mac or by text): expire after 30 minutes | reask (hourly, 3 times) | forever
    securityWatch: { enabled: true, min: 'medium', hours: 6 }, // Relay warns you on its own when a new security problem turns up (medium and worse); say "turn off security warnings" to stop
    doctor: { fix: 'ask' }, // when Relay Doctor finds something fixable: ask | small (small fixes run themselves) | never
    recentDelay: 140, // milliseconds the pointer must rest on the left-edge tab before the Recent menu opens (0 to 1500)
    welcome: { enabled: true, name: 'Sir', minAwayMin: 5, repeatMin: 10, speak: true, show: true }, // "Welcome back, Sir" with what happened, when you unlock after being away a while
    workMode: 'personal', // response style for the user's current context
    fastMode: true, // faster answers: no extended thinking, less re-checking of what it just did (off: slower, double-checks)
    answerStays: true, // an answer (and its card) stays on screen until you say ok, press Esc or ask the next thing
    actEnabled: true, // off: Relay only types what you say into the previous app
    cursor: true,
    look: 'jarvis', // the interface look of the pill, the buddy and guides: 'jarvis' | 'classic'
    wake: { enabled: false, phrase: 'hey jarvis', apps: [], requireClaps: false, spokenAck: false, engine: 'model' }, // on-device wake phrase; optionally require two claps immediately beforehand
    workshop: { enabled: false, prevSpeak: false }, // workshop mode: teaching younger students (slower calm voice, simple wording); prevSpeak remembers whether replies were spoken before
    clipboardHistory: { enabled: true, minutes: 1440 }, // "what did I copy earlier": text only, kept in memory (never on disk) for this many minutes; never passwords or keys
    briefing: { city: '', name: '', units: 'f', schoolUrl: '', sources: {}, say: { weather: false }, onlyNew: true }, // say: which parts are read aloud (the card shows everything; the weather is shown, not spoken); onlyNew: a repeat briefing the same day says only what is new
    // an optional signed-in school assignment page
    language: { reply: 'auto', ui: 'en' }, // what language answers come in: auto (the one you asked in) or a code like 'es'
    followUp: { enabled: true, seconds: 6 }, // after a spoken ask is answered, keep listening this many seconds for the next thing
    autoSend: { enabled: true, silenceSeconds: 1.5 }, // tap to ask: submit after a pause; off for noisy environments
    bargeIn: { enabled: true, mode: 'talk' }, // talk over Relay to stop it (talk), or only by saying stop (word); works best with headphones
    focus: { apps: ['Messages', 'Slack', 'Discord', 'Mail', 'Telegram', 'WhatsApp', 'Steam', 'Twitter', 'Instagram', 'Facebook', 'Reddit'], minutes: 25, shortcutOn: 'Relay Focus On', shortcutOff: 'Relay Focus Off', reopen: true }, // focus mode by voice: apps it closes, default length, and the two Shortcuts that switch Do Not Disturb
    downloadsTidy: { enabled: true, hour: 21, minute: 0, lastRun: '' }, // each evening: work out where new downloads belong and SHOW it (nothing moves until you say yes; nothing is ever deleted)
    voices: { quiet: { volume: 0.55 }, reading: {} }, // how confirmations and long answers sound (see voiceProfile.js)
    assistantName: 'J.A.R.V.I.S', // the name shown in the middle of the reactor
    assistantVisual: 'reactor', // reactor | orb
    reactorIdlePosition: 'center', // center | corner
    assistantBorder: true, // show a screen-edge frame with the Jarvis HUD
    assistantBlur: false, // optional macOS vibrancy behind the active assistant
    hfTokenEnc: '', // an optional free Hugging Face token: more free GPU time for the better 3D generators (TRELLIS)
    models3dFromPhotos: true, // make realistic 3D models from real photos with a free online service (only the public photo is sent)
    models3d: true, // show a 3D model you can turn: a real one when there is one, else built from shapes
    cards: true, // answer cards with a picture, facts and links
    showUsage: true, // a small line under the answer: model, time, tokens (never spoken)
    memory: true, // remember facts you tell it, and use them in every request
    sentient: { enabled: false }, // optional remote, read-only personal vault
    learnWords: true, // after you dictate, notice words you fixed by hand and learn them
    recent: true, // a glass list of recent asks opens when you rest the pointer on the left edge
    buddy: true, // a small helper follows your pointer while Relay works
    spokenOnIt: false, speakReplies: false,
    dictation: true, // off: the Dictate shortcut (right ⌘) does nothing
    saveDictation: true, // off: dictated text is typed but not kept in History
    glass: true, // draw the pill as real see-through glass when this Mac can
    voice: 'auto', // auto, or a voice name from `say -v ?`
    voiceRate: 'normal', // slower | normal | faster
    tts: { // which voice speaks replies: system | kokoro (on this Mac) | openai | elevenlabs | gemini (your own key)
      engine: 'system',
      kokoro: { voice: 'af_heart' },
      openai: { model: 'gpt-4o-mini-tts', voice: 'coral', instructions: 'Speak naturally and warmly, like a helpful friend. Keep a relaxed pace.', keyEnc: '' },
      elevenlabs: { voiceId: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2', keyEnc: '' },
      gemini: { model: 'gemini-3.8-flash-tts', voice: 'Charon', style: 'Calm, dry and polite, like a British butler', keyEnc: '' }
    },
    notify: { enabled: false, channel: 'ntfy', ntfyTopic: '', ntfyServer: 'https://ntfy.sh', imessageTo: '', minSeconds: 30, includeText: false }, // tell the phone when a long job finishes (see notify.js)
    remote: { enabled: false, lan: true, port: 47900, tailscaleServing: false }, // Relay Remote: talk to Relay from your phone
    connectors: { // Notion (a token you paste) and Google (your own OAuth app, several accounts): secrets are encrypted
      notion: { tokenEnc: '', name: '' },
      google: { clientId: '', clientSecretEnc: '', accounts: [] }, // accounts: { email, refreshEnc }
      apps: { url: '', headerName: 'x-api-key', keyEnc: '', count: 0 } // Composio (or any MCP server): its address and key
    },
    holoUi: { controls: 'menu', spin: true, spinDelay: 10, dragFormat: 'stl', pointsPerInch: 125 }, // holograms: where the controls are (menu, side, bar), slow turning, and how long to leave it alone after a touch
    news: { feeds: [] }, // RSS/Atom feeds you added (https only); "my news" reads them, "what's on Hacker News" needs none
    obsidian: { vault: '' }, // your Obsidian vault folder (inside your home folder); "find my Obsidian vault" sets it
    owner: { enabled: false, seconds: 20, threshold: 0.363 }, // owner recognition (opt-in): a face that is not yours while you are away starts the access-denied alarm, then locks after this many seconds
    overnightWake: { enabled: false, battery: false }, // wake the Mac for the overnight window and keep it awake while overnight work runs (wakeScheduler.js; needs a one-time permission you give in Terminal)
    selfImprove: { repo: '', base: 'main' }, // proposals for changes to Relay's own code, in separate git worktrees; off until repo is the absolute path of a source checkout
    presence: { enabled: false, awayAfter: 60, pause: true, resume: true, keepMusic: false, pauseVideo: true, lock: false, guard: { enabled: false, seconds: 10, expected: 1 } }, // opt-in: the camera counts faces once a second; when nobody has been there for a while, pause the music (and lock if asked)
    batterySaver: true, // unplugged: the voice model is not pre-loaded and is unloaded after 5 idle minutes; the local model is kept for 5 minutes instead of 30
    persona: { key: '', custom: '' }, // how Relay talks ("be concise", "talk like a butler"); empty is its usual style
    scenes: { away: '', back: '' }, // what to run when you leave the desk or come back (needs the presence camera); empty means nothing
    nutrition: { enabled: false }, // opt-in food log by voice ("log two eggs"); off, nothing listens for food phrases
    ambient: { enabled: false, localOnly: true, perHour: 6 }, // opt-in: a factual question heard near you is answered quietly in the private window, by a local model
    budget: { enabled: false, dailyUsd: 0, monthlyUsd: 0, action: 'ask', warnAt: 0.8 }, // spend limits you set (opt-in): at the limit Relay asks (or stops) before using the model
    eyeBreaks: { enabled: false, everyMin: 20, seconds: 20, speak: true }, // opt-in: every 20 minutes at the screen, the screens blur for 20 seconds and you look far away
    hands: { enabled: false, preview: false, margin: 0.22, previewPosition: null, peaceShortcut: 'listen', appDragging: true, pinchClick: true, tabNumbers: true, extraGestures: true, airScroll: true }, // Hand control: move holograms in the air through the camera (opt-in)
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
  callRequests: [], callSchedules: [], // outbound phone call reviews and check-in times
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
  constructor(dir, { io = fs.promises, onError = () => {} } = {}) {
    this.io = io; this.onError = onError; this.lastError = null; this._generation = 0; this._writing = Promise.resolve();
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
    if(!require('./ipcSecurity').safeKey(key)) throw Error('Invalid storage path.');
    const parts = key.split('.');
    const last = parts.pop();
    const target = parts.reduce((o, k) => o[k], this.data);
    target[last] = value;
    this.save();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveAsync(), 150);
  }

  // Serialize routine writes off the main thread. Explicit flush remains synchronous
  // for shutdown and security-critical checkpoints, and invalidates stale queued writes.
  saveAsync() {
    clearTimeout(this._timer);
    const generation = ++this._generation;
    const snapshot = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.${process.pid}.${generation}.tmp`;
    this._writing = this._writing.then(async () => {
      if (generation !== this._generation) return;
      try {
        await this.io.mkdir(path.dirname(this.file), { recursive: true });
        await this.io.writeFile(tmp, snapshot, { mode: 0o600, flag: 'wx' });
        // This small atomic commit cannot race an explicit flush on the JS thread.
        if (generation === this._generation) { fs.renameSync(tmp, this.file); this.lastError = null; }
      } catch (e) {
        this.lastError = e.code || 'WRITE_FAILED';
        try { this.onError(this.lastError); } catch {}
      } finally { try { await this.io.unlink(tmp); } catch {} }
    });
    return this._writing;
  }

  flush() {
    clearTimeout(this._timer);
    this._generation++;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); // settings hold encrypted keys and your history: owner only
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
