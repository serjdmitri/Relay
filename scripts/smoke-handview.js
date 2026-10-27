// The hand view in a real Electron window, on still hand photos (no camera): is the picture drawn with the hand outline, the gesture name and the count?
// Run: <electron> scripts/smoke-handview.js <out-dir> <photo.jpg>...
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
app.whenReady().then(async () => {
  const out = process.argv[2];
  const win = new BrowserWindow({ width: 336, height: 300, show: true, frame: false, transparent: true, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, '../src/main/preload.js'), contextIsolation: true } });
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('PAGE', msg.slice(0, 300)); });
  await win.loadFile(path.join(__dirname, '../src/renderer/hands.html'), { search: 'still' });
  for (const f of process.argv.slice(3)) {
    const b64 = fs.readFileSync(f).toString('base64');
    const r = await win.webContents.executeJavaScript(`(async () => { const img = new Image(); img.src = 'data:image/jpeg;base64,${b64}'; await img.decode(); const fr = await window.__hands.stillDraw(img, ${!!process.env.PLAIN}); return { hands: fr.hands.length, count: document.getElementById('count').textContent, state: document.getElementById('state').textContent, visible: !document.getElementById('card').hidden }; })()`);
    await new Promise((r2) => setTimeout(r2, 250));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `handview-${path.basename(f, '.jpg')}.png`), img.toPNG());
    console.log('RESULT', path.basename(f), JSON.stringify(r));
  }
  app.exit(0);
});
