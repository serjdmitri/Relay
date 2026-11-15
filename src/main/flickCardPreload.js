// The only thing a flicked-photo card can do: tell the app which button was pressed, and hear what the photo is now called and where it is.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flickCard', {
  act: (req) => ipcRenderer.invoke('flickcard:act', req),
  onState: (cb) => { ipcRenderer.on('flickcard:state', (_event, state) => cb(state)); }
});
