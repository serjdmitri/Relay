// MediaPipe in a real Electron page, on a still photo of a hand (no camera): does it load and find the hand? Run: <electron> scripts/smoke-hands.js <photo.jpg>...
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../src/main/preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 300)); });
  await win.loadFile(path.join(__dirname, '../src/renderer/hands.html'), { search: 'still' });
  const out = [];
  for (const f of process.argv.slice(2)) {
    const b64 = fs.readFileSync(f).toString('base64');
    const r = await win.webContents.executeJavaScript(`(async () => { const img = new Image(); img.src = 'data:image/jpeg;base64,${b64}'; await img.decode(); const t = performance.now(); const fr = await window.__hands.still(img); return { ms: Math.round(performance.now() - t), hands: fr.hands }; })()`).catch((e) => ({ error: String(e) }));
    out.push({ file: path.basename(f), ...r });
  }
  console.log('RESULT', JSON.stringify(out));
  app.exit(0);
});
