// Stand-in for the preload bridge so the renderer pages can run in plain Chromium.
(() => {
  const now = Date.now();
  const min = 60e3;
  const state = {
    schema: 3,
    onboardingDone: true,
    settings: {
      talking: 'tap-or-hold', playSounds: true, duckAudio: true, actEnabled: true, cursor: true, speakReplies: false, dictation: true, saveDictation: true,
      glass: true, voice: 'auto', voiceRate: 'normal', openAtLogin: true, showInDock: false,
      shortcuts: { ask: { code: 'AltRight', mods: [] }, dictate: { code: 'MetaRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } },
      speech: { locale: 'en-US', input: 'auto' },
      appStyles: [{ app: 'Messages', style: 'chat' }],
      model: { provider: 'claude', claudeModel: 'auto', anthropicModel: 'claude-sonnet-5-5', ollamaModel: 'qwen2.5:14b', ollamaUrl: 'http://127.0.0.1:11434',
        presets: { openai: { model: 'gpt-4.1-mini' }, gemini: { model: 'gemini-3.8-flash' }, groq: { model: 'llama-3.3-70b-versatile' }, mistral: { model: 'mistral-large-latest' }, xai: { model: 'grok-4' }, deepseek: { model: 'deepseek-chat' }, custom: { model: '', url: '' } } },
      firefox: { enabled: true, port: 47831 }
    },
    history: [
      { id: '1', text: 'Remind me to call mom at 5pm', status: 'done', reply: 'Reminder set: call mom, today at 5:00 PM.', ts: now - 4 * min },
      { id: '2', text: 'What is on my calendar tomorrow?', status: 'done', reply: 'Tomorrow you have a design review at 10:00 and lunch with Sam at 12:30.', ts: now - 19 * min },
      { id: '3', text: 'Make a note called Trip ideas saying book flights and check passports', status: 'done', reply: 'Created the note "Trip ideas".', ts: now - 52 * min },
      { id: '4', text: 'Open github.com in Firefox', status: 'done', reply: 'Opened github.com in Firefox.', ts: now - 95 * min },
      { id: '5', text: 'Set a timer for 10 minutes', status: 'done', reply: 'Timer set for 10 minutes.', ts: now - 3 * 60 * min },
      { id: '6', text: 'Send "running late" to Alex', status: 'stopped', reply: 'Cancelled. Nothing was sent.', ts: now - 5 * 60 * min }
    ],
    dictations: [
      { id: 'd1', text: 'Thanks for the update, I will review the draft this afternoon and send comments by tomorrow morning.', ts: now - 11 * min },
      { id: 'd2', text: 'Can we move the standup to ten thirty?', ts: now - 40 * min },
      { id: 'd3', text: 'Meeting notes: ship the beta on Friday, follow up with design about the icon.', ts: now - 2 * 60 * min }
    ],
    actions: [
      { id: 'a1', tool: 'reminders_add', input: { title: 'Call mom', when: 'today 17:00' }, result: 'Added reminder "Call mom" for 17:00.', ok: true, ts: now - 4 * min },
      { id: 'a2', tool: 'calendar_list', input: { range: 'tomorrow' }, result: '2 events', ok: true, ts: now - 19 * min },
      { id: 'a3', tool: 'notes_create', input: { title: 'Trip ideas' }, result: 'Created note "Trip ideas".', ok: true, ts: now - 52 * min },
      { id: 'a4', tool: 'open_url', input: { url: 'https://github.com' }, result: 'Opened in Firefox.', ok: true, ts: now - 95 * min }
    ],
    routines: [
      { id: 'r1', name: 'start my day', steps: ['open Calendar and read me today', 'open Notes', 'set a timer for 25 minutes'] },
      { id: 'r2', name: 'wind down', steps: ['turn on dark mode', 'set brightness to 30 percent', 'pause the music'] }
    ],
    timers: [], replacements: [{ id: 'w1', from: 'superbase', to: 'Supabase' }], vocabulary: ['Supabase', 'Talkify', 'Ollama', 'Haiku'], lastReply: '',
    hasKey: false,
    hasKeys: { openai: false, gemini: false, groq: false, mistral: false, xai: false, deepseek: false, custom: false },
    presetInfo: {
      openai: { label: 'OpenAI (ChatGPT API)', keyUrl: 'https://platform.openai.com/api-keys', vision: true },
      gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', vision: true },
      groq: { label: 'Groq', keyUrl: 'https://console.groq.com/keys', vision: false },
      mistral: { label: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys', vision: false },
      xai: { label: 'xAI (Grok)', keyUrl: 'https://console.x.ai', vision: false },
      deepseek: { label: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', vision: false },
      custom: { label: 'Custom address', keyUrl: '', vision: false, keyOptional: true }
    },
    stats: { requests: 42, actions: 97, words: 1850, minutesSaved: 31 },
    labels: { ask: 'Right ⌥', dictate: 'Right ⌘', type: '⌥T' },
    claude: { installed: true, loggedIn: true, checked: true, email: '', path: '/usr/local/bin/claude' },
    speech: { available: true, device: 'MacBook Pro Microphone', preparing: null, prepared: true, error: null },
    firefoxConnected: true, hotkeysRunning: true, hotkeysSeen: true, hotkeysError: null, version: '0.1.0', extensionPath: '/Applications/Relay.app/Contents/Resources/firefox-extension'
  };
  const day = 24 * 60 * min;
  [3, 5, 2, 7, 4, 6].forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      state.history.push({ id: `old${i}-${k}`, text: ['Open Notes', 'Set a timer for 10 minutes', 'What is on my calendar today?', 'Pause the music', 'Remind me to stretch at 3'][k % 5], status: 'done', reply: 'Done.', ts: now - (6 - i) * day - k * 37 * min });
    }
  });
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  const LABEL = { AltRight: 'Right ⌥', AltLeft: 'Left ⌥', MetaRight: 'Right ⌘' };
  const lab = (d) => d.mods.map((m) => ({ Alt: '⌥', Control: '⌃', Shift: '⇧', Meta: '⌘' }[m])).join('') + (LABEL[d.code] || d.code.replace(/^Key/, ''));
  const setPath = (key, value) => {
    const parts = key.split('.');
    const last = parts.pop();
    parts.reduce((o, k) => o[k], state)[last] = value;
  };
  const calls = [];
  window.__relayCalls = calls;
  window.__relayState = state;
  window.relay = {
    claudeStatus: async () => state.claude,
    claudeLogin: async () => ({ ok: true }), claudeCancelLogin: async () => {}, claudeLogout: async () => {},
    requestMic: async () => ({ ok: true, status: 'granted' }),
    speechLocales: async () => [{ id: 'en-US', name: 'English (United States)' }, { id: 'en-GB', name: 'English (United Kingdom)' }, { id: 'es-ES', name: 'Spanish (Spain)' }, { id: 'fr-FR', name: 'French (France)' }, { id: 'de-DE', name: 'German (Germany)' }],
    setSpeechLocale: async () => {},
    inputDevice: async () => 'MacBook Pro Microphone',
    inputDevices: async () => ({ default: 'MacBook Pro Microphone', using: 'MacBook Pro Microphone', list: [{ uid: 'a', name: 'MacBook Pro Microphone' }, { uid: 'b', name: 'AirPods Pro' }] }),
    voices: async () => ({ picked: 'Samantha', voices: [{ name: 'Samantha', kind: 'Standard', lang: 'en_US' }, { name: 'Ava (Premium)', kind: 'Premium', lang: 'en_US' }] }),
    previewVoice: async () => {}, openVoiceSettings: async () => {}, setInput: async () => {},
    appIcons: async () => ({}), runningApps: async () => ['Notes', 'Reminders', 'Messages', 'Safari', 'Firefox'],
    addReplacement: async (from, to) => { state.replacements.push({ id: String(Date.now()), from, to }); emit(); },
    removeReplacement: async (id) => { state.replacements = state.replacements.filter((r) => r.id !== id); emit(); },
    deleteDictation: async (id) => { state.dictations = state.dictations.filter((d) => d.id !== id); emit(); },
    clearDictation: async () => { state.dictations = []; emit(); },
    getState: async () => JSON.parse(JSON.stringify(state)),
    set: async (k, v) => { calls.push(['set', k, v]); setPath(k, v); emit(); },
    setPresetKey: async (id, k) => { calls.push(['setPresetKey', id, k]); state.hasKeys[id] = !!k; emit(); },
    setApiKey: async (k) => { calls.push(['setApiKey', k]); state.hasKey = !!k; emit(); },
    testModel: async () => ({ ok: state.hasKey, error: 'No Anthropic API key set. Add one in Relay > Model.', text: 'OK' }),
    permissions: async () => window.__perms || { accessibility: true, screen: true, micStatus: 'granted' },
    requestAccessibility: async () => false,
    openPane: async (n) => calls.push(['openPane', n]),
    testAutomation: async (a) => ({ ok: a !== 'Messages', denied: a === 'Messages' }),
    saveRoutine: async (r) => { calls.push(['saveRoutine', r]); state.routines.push({ id: String(state.routines.length + 1), ...r }); emit(); },
    deleteRoutine: async (id) => { state.routines = state.routines.filter((r) => r.id !== id); emit(); },
    runRoutine: async (id) => calls.push(['runRoutine', id]),
    addVocab: async (t) => { state.vocabulary.push(...t.map((x) => x.trim()).filter(Boolean)); emit(); },
    removeVocab: async (t) => { state.vocabulary = state.vocabulary.filter((x) => x !== t); emit(); },
    clearHistory: async () => { state.history = []; state.actions = []; emit(); },
    setShortcut: async (n, d) => { calls.push(['setShortcut', n, d]); state.settings.shortcuts[n] = d; state.labels[n] = lab(d); emit(); },
    setCapturing: async (on) => calls.push(['setCapturing', on]),
    resetShortcuts: async () => { state.settings.shortcuts = { ask: { code: 'AltRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } }; state.labels = { ask: 'Right ⌥', type: '⌥T' }; emit(); },
    finishOnboarding: async () => calls.push(['finishOnboarding']),
    openWindow: async () => {},
    extensionAction: async (w) => calls.push(['extensionAction', w]),
    ask: {
      open: async (t) => calls.push(['ask.open', t]),
      submit: async (t) => calls.push(['ask.submit', t]),
      cancel: async () => calls.push(['ask.cancel']),
      confirm: async (y) => calls.push(['ask.confirm', y]),
      resize: async (h) => { window.__pillHeight = h; },
      interactive: async () => {}, hidden: async () => {},
      onState: (cb) => { window.__askState = cb; return () => {}; }
    },
    onStateChanged: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    onNavigate: (cb) => { window.__navigate = cb; return () => {}; },
    onOverlay: (cb) => { window.__overlay = cb; return () => {}; },
    overlayMark: () => {}
  };
})();
