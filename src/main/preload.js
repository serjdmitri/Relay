const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const handler = (_e, ...a) => cb(...a);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('relay', {
  getState: () => invoke('state:get'),
  set: (key, value) => invoke('state:set', key, value),
  setApiKey: (key) => invoke('model:set-key', key),
  setPresetKey: (id, key) => invoke('model:set-preset-key', id, key),
  testModel: () => invoke('model:test'),
  claudeStatus: () => invoke('claude:status'),
  claudeLogin: () => invoke('claude:login'),
  claudeCancelLogin: () => invoke('claude:cancel-login'),
  claudeLogout: () => invoke('claude:logout'),
  requestMic: () => invoke('speech:request-mic'),
  speechLocales: () => invoke('speech:locales'),
  setSpeechLocale: (id) => invoke('speech:set-locale', id),
  inputDevice: () => invoke('speech:device'),
  inputDevices: () => invoke('speech:inputs'),
  voices: () => invoke('voice:list'),
  previewVoice: (voice, rate) => invoke('voice:preview', voice, rate),
  openVoiceSettings: () => invoke('voice:open-settings'),
  setInput: (pref) => invoke('speech:set-input', pref),
  appIcons: () => invoke('app:icons'),
  permissions: () => invoke('perm:status'),
  requestAccessibility: () => invoke('perm:request-accessibility'),
  openPane: (name) => invoke('perm:open-pane', name),
  testAutomation: (app) => invoke('perm:test-automation', app),
  saveRoutine: (r) => invoke('routine:save', r),
  deleteRoutine: (id) => invoke('routine:delete', id),
  runRoutine: (id) => invoke('routine:run', id),
  addVocab: (terms) => invoke('vocab:add', terms),
  addReplacement: (from, to) => invoke('replace:add', from, to),
  removeReplacement: (id) => invoke('replace:remove', id),
  runningApps: () => invoke('apps:running'),
  removeVocab: (t) => invoke('vocab:remove', t),
  clearHistory: () => invoke('history:clear'),
  deleteDictation: (id) => invoke('dictation:delete', id),
  clearDictation: () => invoke('dictation:clear'),
  setShortcut: (name, def) => invoke('shortcut:set', name, def),
  resetShortcuts: () => invoke('shortcut:reset'),
  setCapturing: (on) => invoke('shortcut:capturing', on),
  finishOnboarding: () => invoke('onboarding:finish'),
  openWindow: (name) => invoke('window:open', name),
  extensionAction: (what) => invoke('firefox:action', what),
  ask: {
    open: (text) => invoke('ask:open', text),
    submit: (text) => invoke('ask:submit', text),
    cancel: () => invoke('ask:cancel'),
    confirm: (yes) => invoke('ask:confirm', yes),
    resize: (h) => invoke('ask:resize', h),
    interactive: (on) => invoke('ask:interactive', on),
    hidden: () => invoke('ask:hidden'),
    onState: (cb) => on('ask:state', cb)
  },
  onStateChanged: (cb) => on('state-changed', cb),
  onNavigate: (cb) => on('navigate', cb),
  onOverlayPoint: (cb) => on('overlay:point', cb)
});
