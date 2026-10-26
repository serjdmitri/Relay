// A photo in, a real-looking 3D model out (a textured GLB), through Stable Fast 3D on Hugging Face's free public Space. It takes a few
// seconds. Only the (public) photo is sent; nothing about you. The Space can be busy or out of its free quota, and it can change; when
// it does, the error says so and Relay falls back to another option.

const { UA } = require('../cards/lookup');

const BASE = 'https://stabilityai-stable-fast-3d.hf.space';
const MAX_GLB = 40 * 1024 * 1024;

class Sf3dError extends Error {}

const friendly = (msg) => (/quota|gpu|zerogpu|exceeded|rate/i.test(msg || '') ? 'The free 3D service has hit its daily limit. Try again later.' : /queue|busy|full/i.test(msg || '') ? 'The free 3D service is busy right now. Try again in a minute.' : 'The free 3D service could not make a model from that photo.');

// One call to the Space (Gradio's queue): returns the finished event's data, or throws.
async function call(fetchImpl, base, session, fnIndex, data, timeoutMs) {
  const join = await fetchImpl(`${base}/queue/join`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ data, event_data: null, fn_index: fnIndex, trigger_id: 0, session_hash: session }), signal: AbortSignal.timeout(20000) });
  if (!join.ok) throw new Sf3dError(friendly(`HTTP ${join.status}`));
  const { event_id: id } = await join.json();
  const res = await fetchImpl(`${base}/queue/data?session_hash=${session}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Sf3dError(friendly(`HTTP ${res.status}`));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Sf3dError('The free 3D service stopped answering.');
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = chunk.match(/^data: (.*)$/m);
        if (!m) continue;
        let ev;
        try { ev = JSON.parse(m[1]); } catch { continue; }
        if (ev.event_id && id && ev.event_id !== id) continue;
        if (ev.msg === 'process_completed') {
          if (!ev.success) throw new Sf3dError(friendly(String(ev.output?.error || '')));
          return ev.output?.data || [];
        }
        if (ev.msg === 'queue_full') throw new Sf3dError(friendly('queue full'));
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* done */ }
  }
}

const fileValue = (d) => (d && typeof d === 'object' ? d.value ?? d : null);

// photo: { bytes, type }. Returns the GLB as a Buffer.
async function photoToGlb(photo, { fetchImpl = fetch, base = BASE, timeoutMs = 150000 } = {}) {
  const session = Math.random().toString(36).slice(2, 12);
  const form = new FormData();
  form.append('files', new Blob([photo.bytes], { type: photo.type }), `photo.${photo.type.split('/')[1] || 'jpg'}`);
  const up = await fetchImpl(`${base}/upload?upload_id=${session}`, { method: 'POST', body: form, headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!up.ok) throw new Sf3dError(friendly(`HTTP ${up.status}`));
  const paths = await up.json();
  if (!paths?.[0]) throw new Sf3dError(friendly(''));
  const file = { path: paths[0], url: `${base}/file=${paths[0]}`, orig_name: 'photo', mime_type: photo.type, meta: { _type: 'gradio.FileData' } };
  // The Space's own two clicks: "Remove Background", then "Run". The same function (fn_index 5) answers both.
  const first = await call(fetchImpl, base, session, 5, ['Remove Background', file, null, 0.85, 'None', -1, 1024], timeoutMs);
  const label = fileValue(first[0]);
  const second = await call(fetchImpl, base, session, 5, [typeof label === 'string' ? label : 'Run', file, null, 0.85, 'None', -1, 1024], timeoutMs);
  const glb = fileValue(second[4]);
  const url = glb && glb.url;
  if (!url || !/^https:\/\/[a-z0-9-]+\.hf\.space\//.test(url)) throw new Sf3dError(friendly(''));
  const dl = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!dl.ok) throw new Sf3dError(friendly(`HTTP ${dl.status}`));
  const bytes = Buffer.from(await dl.arrayBuffer());
  if (bytes.length > MAX_GLB || bytes.slice(0, 4).toString() !== 'glTF') throw new Sf3dError(friendly(''));
  return bytes;
}

module.exports = { photoToGlb, Sf3dError, friendly, BASE };
