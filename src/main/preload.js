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
  testModel: () => invoke('model:test'),
  permissions: () => invoke('perm:status'),
  requestAccessibility: () => invoke('perm:request-accessibility'),
  openPane: (name) => invoke('perm:open-pane', name),
  testAutomation: (app) => invoke('perm:test-automation', app),
  saveRoutine: (r) => invoke('routine:save', r),
  deleteRoutine: (id) => invoke('routine:delete', id),
  runRoutine: (id) => invoke('routine:run', id),
  addVocab: (terms) => invoke('vocab:add', terms),
  removeVocab: (t) => invoke('vocab:remove', t),
  clearHistory: () => invoke('history:clear'),
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
    onState: (cb) => on('ask:state', cb)
  },
  onStateChanged: (cb) => on('state-changed', cb),
  onNavigate: (cb) => on('navigate', cb),
  onOverlayPoint: (cb) => on('overlay:point', cb)
});
