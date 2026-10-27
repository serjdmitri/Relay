// The reactor (HUD) in a real window: a finished task is on the left; while a new ask is listened to, many updates arrive (level, words).
// Counts how often the task list's elements are created or changed: it must not be rebuilt on every update (that looked like flicker).
// Run: <electron> scripts/smoke-hud.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { preload: path.join(__dirname, '../src/main/preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '../src/renderer/overlay.html'));
  const send = (cmd) => win.webContents.send('overlay:cmd', cmd);
  await win.webContents.executeJavaScript(`window.__muts = 0; window.__added = 0; new MutationObserver((list) => { for (const m of list) { window.__muts++; window.__added += m.addedNodes.length; } }).observe(document.getElementById('hudtasks'), { childList: true, subtree: true, characterData: true, attributes: true }); 0`);
  const task = { id: 't1', text: 'Can you please tell me what you found and put that in notes?', status: 'done' };
  send({ type: 'hud', state: { state: 'done', mode: 'ask', tasks: [task], reply: 'Done.' } });
  await wait(600);
  const base = await win.webContents.executeJavaScript('({ muts: window.__muts, added: window.__added })');
  // a new ask is listened to: 80 updates (level and words) with the finished task still listed
  send({ type: 'hud', state: { state: 'listening', mode: 'ask', tasks: [task], reset: true, partial: '' } });
  for (let i = 0; i < 80; i++) { send({ type: 'hud', state: { state: 'listening', mode: 'ask', tasks: [task], partial: 'hey there '.repeat(1 + (i % 4)), level: (i % 10) / 10 } }); await wait(15); }
  const after = await win.webContents.executeJavaScript('({ muts: window.__muts, added: window.__added, items: document.querySelectorAll("#hudtasks li").length })');
  console.log('RESULT', JSON.stringify({ base, after }));
  app.exit(0);
});
