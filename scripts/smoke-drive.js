// The file finder in real Electron: Spotlight (mdfind) and Quick Look thumbnails, on this project's own folder (read-only). Run: <electron> scripts/smoke-drive.js
const { app, nativeImage } = require('electron');
const os = require('os');
const { execFile } = require('child_process');
const { Drive } = require('../src/main/drive');
app.whenReady().then(async () => {
  const cards = [];
  const d = new Drive({
    fs: require('fs'), home: os.homedir(), cards: { show: async (c) => { cards.push(c); }, hide() {} },
    exec: (f, a) => new Promise((res) => execFile(f, a, { timeout: 8000, maxBuffer: 8e6 }, (_e, out) => res(out || ''))),
    thumb: async (p) => { try { const img = await nativeImage.createThumbnailFromPath(p, { width: 220, height: 220 }); return img.isEmpty() ? null : `data:image/jpeg;base64,${img.resize({ width: 160 }).toJPEG(72).toString('base64')}`; } catch (e) { return null; } },
    trashItem: async () => { throw new Error('not in a test'); }
  });
  const text = await d.find({ query: 'icon', folder: '~/Documents/Relay/assets', kind: 'image' });
  const scan = d.scan({ folder: '~/Documents/Relay/docs', depth: 1 });
  console.log('RESULT', JSON.stringify({ text: text.split('\n').slice(0, 4), items: cards[0]?.items.map((i) => ({ title: i.title, subtitle: i.subtitle, note: i.note, thumb: (i.image || '').length })), scanHead: scan.split('\n').slice(0, 2) }));
  app.exit(0);
});
