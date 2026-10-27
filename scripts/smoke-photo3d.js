// The photo-to-3D glue in real Electron, with real photos and the real free service: search, rank, make a model from the best. Run: <electron> scripts/smoke-photo3d.js "<name>"
const { app } = require('electron');
const { AskController } = require('../src/main/askController');
const { findPhotos } = require('../src/main/models/photos');
app.whenReady().then(async () => {
  const ctl = Object.create(AskController.prototype);
  ctl.store = { get: () => '' }; // no Hugging Face token, no cache
  ctl.modelCache = null;
  const name = process.argv[2] || 'Toyota Corolla';
  const found = await findPhotos(name, { n: 6 });
  const ranked = await ctl.rankedPhotos(found, 3);
  const t = Date.now();
  let made = null;
  try { const it = await ctl.generatePhotoModel({ title: name, url: ranked[0].url, credit: ranked[0].credit, bytes: ranked[0].bytes, type: ranked[0].type }); made = { kind: it.kind, credit: it.credit, kb: Math.round(it.bytes.length / 1024), engine: it.engine, seconds: +((Date.now() - t) / 1000).toFixed(1) }; } catch (e) { made = { error: e.message }; }
  console.log('RESULT', JSON.stringify({ found: found.map((f) => f.title), ranked: ranked.map((r) => [r.title, r.score, !!r.bytes]), made, order: ctl.engineOrder() }));
  app.exit(0);
});
