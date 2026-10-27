// Finds photos for some names, scores them, and shows the ranking (real photos, real decoding). Run: <electron> scripts/score-photos.js <outDir> <name>...
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { findPhotos, fetchPhoto } = require('../src/main/models/photos');
const { rankPhotos, decodeWith } = require('../src/main/models/photoscore');
app.whenReady().then(async () => {
  const [out, ...names] = process.argv.slice(2);
  const all = {};
  for (const q of names) {
    const cands = await findPhotos(q, { n: 6 });
    const bytes = new Map();
    const ranked = await rankPhotos(cands, async (c) => { const f = await fetchPhoto(c.url).catch(() => null); if (!f) return null; bytes.set(c.url, f.bytes); return decodeWith(nativeImage, f.bytes); });
    all[q] = ranked.map((r, k) => { const f = path.join(out, `${q.replace(/\W+/g, '_')}-${k + 1}.jpg`); if (bytes.get(r.url)) fs.writeFileSync(f, bytes.get(r.url)); return { rank: k + 1, score: r.score, parts: r.parts, title: r.title.slice(0, 50), file: path.basename(f) }; });
  }
  console.log('RESULT', JSON.stringify(all));
  app.exit(0);
});
