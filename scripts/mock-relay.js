// Stand-in for the preload bridge so the renderer pages can run in plain Chromium.
(() => {
  const now = Date.now();
  const state = {
    onboardingDone: true,
    settings: {
      talking: 'tap-or-hold', playSounds: true, actEnabled: true, cursor: true, speakReplies: false, openAtLogin: false, showInDock: true,
      shortcuts: { ask: { code: 'AltRight', mods: [] }, type: { code: 'KeyT', mods: ['Alt'] } },
      model: { provider: 'anthropic', anthropicModel: 'claude-sonnet-5-5', ollamaModel: 'qwen2.5:14b', ollamaUrl: 'http://127.0.0.1:11434' },
      firefox: { enabled: false, port: 47831 }
    },
    history: [
      { id: '1', text: 'What apps do I have open?', status: 'done', reply: 'You have 6 apps open: Claude, darktable, Finder, Firefox, Preview and System Settings.', ts: now - 37 * 60e3 },
      { id: '2', text: 'Open notes.', status: 'stopped', reply: 'Stopped.', ts: now - 37 * 60e3 },
      { id: '3', text: 'Can you show me my download folder?', status: 'done', reply: 'Opened the Downloads folder.', ts: now - 37 * 60e3 }
    ],
    actions: [
      { id: 'a1', tool: 'open_path', input: { path: '~/Downloads' }, result: 'Opened /Users/sergey/Downloads.', ok: true, ts: now - 37 * 60e3 },
      { id: 'a2', tool: 'list_running_apps', input: {}, result: 'Claude, darktable, Finder', ok: true, ts: now - 38 * 60e3 }
    ],
    routines: [], vocabulary: [], lastReply: '', hasKey: false,
    stats: { requests: 3, actions: 2, words: 19, minutesSaved: 1 },
    labels: { ask: 'Right ⌥', type: '⌥T' },
    firefoxConnected: false, hotkeysRunning: true, hotkeysError: null, version: '0.1.0', extensionPath: '/Applications/Relay.app/Contents/Resources/firefox-extension'
  };
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
    getState: async () => JSON.parse(JSON.stringify(state)),
    set: async (k, v) => { calls.push(['set', k, v]); setPath(k, v); emit(); },
    setApiKey: async (k) => { calls.push(['setApiKey', k]); state.hasKey = !!k; emit(); },
    testModel: async () => ({ ok: state.hasKey, error: 'No Anthropic API key set. Add one in Relay > Model.', text: 'OK' }),
    permissions: async () => window.__perms || { accessibility: false, screen: false },
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
      onState: (cb) => { window.__askState = cb; return () => {}; }
    },
    onStateChanged: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    onNavigate: (cb) => { window.__navigate = cb; return () => {}; },
    onOverlayPoint: (cb) => { window.__overlayPoint = cb; return () => {}; }
  };
})();
