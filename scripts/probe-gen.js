// Runs one or more photo-to-3D engines on a photo for real and saves the GLBs: node scripts/probe-gen.js <photo> <outDir> <engine>...
const fs = require('fs');
const path = require('path');
const { photoToModel } = require('../src/main/models/generators');
(async () => {
  const [photoPath, out, ...engines] = process.argv.slice(2);
  const bytes = fs.readFileSync(photoPath);
  const type = /\.png$/i.test(photoPath) ? 'image/png' : 'image/jpeg';
  for (const e of engines) {
    const t = Date.now();
    try {
      const r = await photoToModel({ bytes, type }, { only: e });
      const f = path.join(out, `${path.basename(photoPath, path.extname(photoPath))}-${e}.glb`);
      fs.writeFileSync(f, r.bytes);
      console.log(JSON.stringify({ engine: e, ok: true, seconds: +((Date.now() - t) / 1000).toFixed(1), kb: Math.round(r.bytes.length / 1024), file: f }));
    } catch (err) { console.log(JSON.stringify({ engine: e, ok: false, seconds: +((Date.now() - t) / 1000).toFixed(1), error: String(err.message).slice(0, 120), raw: err.raw })); }
  }
})();
