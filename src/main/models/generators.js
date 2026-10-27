// Ways to turn one photo into a textured 3D model (a GLB), all on Hugging Face's free public Spaces (no key, only the public photo is sent).
// They differ a lot in quality: TRELLIS.2 and TRELLIS make far cleaner shapes and textures than Stable Fast 3D, but they use more of the free
// GPU time, so Relay tries the best first and falls back down the list when one is busy or out of its daily quota.

const { GradioSpace, GradioError, friendly } = require('./gradio');
const sf3d = require('./sf3d');

const sid = () => Math.random().toString(36).slice(2, 12);

// The GLB among a Space's outputs (a file path or object ending in .glb).
function findGlb(data) {
  for (const d of data || []) {
    const f = d && typeof d === 'object' && !Array.isArray(d) ? d.value ?? d : d;
    const name = typeof f === 'string' ? f : f?.path || f?.url || f?.orig_name || '';
    if (/\.glb(\?|$)/i.test(String(name))) return f;
  }
  return null;
}

const ENGINES = [
  {
    id: 'trellis2', name: 'TRELLIS.2', host: 'https://microsoft-trellis-2.hf.space',
    async run(photo, { fetchImpl, token }) {
      const space = new GradioSpace({ host: this.host, fetchImpl, token });
      const session = sid();
      await space.run('start_session', [], { session }).catch(() => {});
      const file = await space.upload(photo.bytes, photo.type);
      const pre = await space.run('preprocess_image', [file], { session, timeoutMs: 120000 });
      const image = pre[0] && typeof pre[0] === 'object' ? (pre[0].value ?? pre[0]) : pre[0];
      await space.run('image_to_3d', [image, 0, '1024', 7.5, 0.7, 12, 5.0, 7.5, 0.5, 12, 3.0, 1.0, 0.0, 12, 3.0], { session, timeoutMs: 300000 });
      const out = await space.run('extract_glb', [300000, 2048], { session, timeoutMs: 300000 });
      const glb = findGlb(out);
      if (!glb) throw new GradioError(friendly(''));
      return space.download(glb);
    }
  },
  {
    id: 'trellis', name: 'TRELLIS', host: 'https://trellis-community-trellis.hf.space',
    async run(photo, { fetchImpl, token }) {
      const space = new GradioSpace({ host: this.host, fetchImpl, token });
      const session = sid();
      const file = await space.upload(photo.bytes, photo.type);
      const out = await space.run('generate_and_extract_glb', [file, [], 0, 7.5, 12, 3.0, 12, 'stochastic', 0.9, 1024], { session, timeoutMs: 300000 });
      const glb = findGlb(out);
      if (!glb) throw new GradioError(friendly(''));
      return space.download(glb);
    }
  },
  {
    id: 'sf3d', name: 'Stable Fast 3D',
    async run(photo, { fetchImpl }) { return sf3d.photoToGlb(photo, { fetchImpl }); }
  }
];

const byId = (id) => ENGINES.find((e) => e.id === id);

// Tries the engines in order (or just the one asked for, with the rest as fallbacks) until one makes a model.
// Returns { bytes, engine, name, attempts } or throws the last problem (with .attempts). onTry(engine) is told which one is being tried.
// attempts: what each tried engine did: { engine, name, ok, seconds, error }.
async function photoToModel(photo, { fetchImpl = fetch, token = '', prefer = null, only = null, onTry = () => {}, order = ENGINES.map((e) => e.id) } = {}) {
  const ids = only ? [only] : prefer ? [prefer, ...order.filter((i) => i !== prefer)] : order;
  const attempts = [];
  let last = null;
  for (const id of ids) {
    const e = byId(id);
    if (!e) continue;
    onTry(e);
    const t0 = Date.now();
    try {
      const bytes = await e.run(photo, { fetchImpl, token });
      if (bytes.length < 1000 || bytes.slice(0, 4).toString() !== 'glTF') throw new GradioError(friendly(''));
      attempts.push({ engine: e.id, name: e.name, ok: true, seconds: +((Date.now() - t0) / 1000).toFixed(1) });
      return { bytes, engine: e.id, name: e.name, attempts };
    } catch (err) {
      last = err;
      attempts.push({ engine: e.id, name: e.name, ok: false, seconds: +((Date.now() - t0) / 1000).toFixed(1), error: String(err.message || '').slice(0, 160), raw: String(err.raw || '').slice(0, 240) });
    }
  }
  const out = last || new GradioError(friendly(''));
  out.attempts = attempts;
  throw out;
}

module.exports = { ENGINES, photoToModel, findGlb, byId };
