// Starts the real Electron with the real card and Recent windows, shows one of each with sample content, waits for the
// animations, and saves what each window really drew. It catches things a browser mock cannot, like a main/page channel
// mismatch. Run: node_modules/.bin/electron scripts/smoke-panels.js [outDir]
const { app, ipcMain, screen } = require('electron');
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.message));
const fs = require('fs');
const path = require('path');
const { CardPanel } = require('../src/main/cards/panel');
const { RecentPanel } = require('../src/main/recent');
const { buildCard } = require('../src/main/cards/card');

const out = process.argv[2] || path.join(__dirname, '../shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
ipcMain.handle('state:get', () => ({ history: [{ id: '1', text: 'Who is Gustave Eiffel?', status: 'done', reply: 'A French engineer.', ts: Date.now() - 60000 }, { id: '2', text: 'Open Notes', status: 'done', reply: 'Done.', ts: Date.now() - 600000 }] }));

app.whenReady().then(async () => {
  const preload = path.join(__dirname, '../src/main/preload.js');
  const card = new CardPanel({ preload });
  ipcMain.handle('card:size', (_e, h) => card.setSize(h));
  ipcMain.handle('card:close', () => card.hide());
  ipcMain.handle('card:hover', () => {});
  ipcMain.handle('card:open', () => {});
  ipcMain.handle('recent:size', () => {});
  ipcMain.handle('recent:hit', () => {});
  const recent = new RecentPanel({ getEnabled: () => true, preload });
  const result = {};
  try {
    const built = await buildCard({ title: 'Gustave Eiffel', subtitle: 'French engineer, 1832 to 1923', summary: 'Designed the Eiffel Tower and built bridges and viaducts across Europe. He also built the internal frame of the Statue of Liberty.', facts: [{ label: 'Born', value: 'Dijon, France' }, { label: 'Known for', value: 'Eiffel Tower, Statue of Liberty frame' }], image_query: 'Gustave Eiffel' });
    await card.show(built);
    await wait(2200);
    fs.writeFileSync(path.join(out, 'real-card.png'), (await card.win.webContents.capturePage()).toPNG());
    result.card = { visible: card.win.isVisible(), bounds: card.win.getBounds(), hasImage: !!built.image };
    const list = await buildCard({ title: 'Things to see in Boston', items: [{ title: 'Boston Common', subtitle: 'Oldest city park in the US', note: 'Free', url: 'https://www.boston.gov' }, { title: 'Fenway Park', subtitle: 'Red Sox ballpark' }, { title: 'Freedom Trail', subtitle: '2.5 mile walking route' }] });
    await card.show(list);
    await wait(2200);
    fs.writeFileSync(path.join(out, 'real-card-list.png'), (await card.win.webContents.capturePage()).toPNG());
    card.hide();
    recent.open(screen.getPrimaryDisplay());
    await wait(2200);
    fs.writeFileSync(path.join(out, 'real-recent.png'), (await recent.win.webContents.capturePage()).toPNG());
    result.recent = { visible: recent.win.isVisible(), bounds: recent.win.getBounds(), page: await recent.win.webContents.executeJavaScript("JSON.stringify({ cls: document.body.className, op: getComputedStyle(document.getElementById('glass')).opacity, items: document.querySelectorAll('.item').length, err: window.__err || null })") };
    result.card.page = await card.win.webContents.executeJavaScript("JSON.stringify({ cls: document.body.className, h: document.getElementById('card').scrollHeight })").catch(() => null);
  } catch (e) {
    result.error = e.stack;
  }
  console.log('RESULT', JSON.stringify(result));
  app.exit(0);
});
