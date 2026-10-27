// The reactor in a real window: is a point on it (centre while listening, top left while it works) and not off it? That is what lets a file dragged
// onto the reactor be accepted. Run: <electron> scripts/smoke-reactordrop.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { preload: path.join(__dirname, '../src/main/preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '../src/renderer/overlay.html'));
  const send = (cmd) => win.webContents.send('overlay:cmd', cmd);
  const hit = (x, y) => win.webContents.executeJavaScript(`window.__hudHit(${x}, ${y})`);
  const result = {};
  result.beforeShown = await hit(700, 410);
  send({ type: 'hud', state: { state: 'listening', mode: 'ask', tasks: [], reset: true, partial: '' } });
  await wait(1500);
  result.centreWhileListening = await hit(700, 410);
  result.cornerWhileListening = await hit(60, 60);
  result.farAway = await hit(1350, 850);
  send({ type: 'hud', state: { state: 'working', mode: 'ask', tasks: [{ id: 't', text: 'x', status: 'running' }], label: 'Working' } });
  await wait(2500);
  const r = await win.webContents.executeJavaScript(`(() => { const b = document.getElementById('hudR').getBoundingClientRect(); return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), w: Math.round(b.width) }; })()`);
  result.whileWorking = r;
  result.onReactorWhileWorking = await hit(r.cx, r.cy);
  result.centreWhileWorking = await hit(700, 410);
  // the drop handler is there and does not throw on an empty drop
  result.dropHandler = await win.webContents.executeJavaScript(`(() => { try { window.dispatchEvent(new DragEvent('dragover', { cancelable: true })); const c = document.getElementById('hud').classList.contains('dropping'); window.dispatchEvent(new DragEvent('dragleave')); return { whileOver: c, after: document.getElementById('hud').classList.contains('dropping') }; } catch (e) { return String(e); } })()`);
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
