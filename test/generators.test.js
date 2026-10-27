const test = require('node:test');
const assert = require('node:assert/strict');
const { GradioSpace } = require('../src/main/models/gradio');
const { photoToModel, findGlb, ENGINES } = require('../src/main/models/generators');

const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(2000, 7)]);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// A pretend Gradio Space. apis: { name: { inputs: ['image', 'state', ...], run(data, calls) -> output data | throws { quota } } }
function fakeSpace(host, apis, log) {
  const deps = Object.entries(apis).map(([name, a], i) => ({ id: i, api_name: name, inputs: a.inputs.map((_, k) => i * 100 + k) }));
  const comps = Object.entries(apis).flatMap(([, a], i) => a.inputs.map((t, k) => ({ id: i * 100 + k, type: t })));
  const pending = new Map();
  let ev = 0;
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== host) return null;
    if (u.pathname === '/config') return json({ api_prefix: '/gradio_api', dependencies: deps, components: comps });
    if (u.pathname === '/gradio_api/upload') return json(['/tmp/gradio/abc/photo.jpg']);
    if (u.pathname === '/gradio_api/queue/join') {
      const b = JSON.parse(init.body);
      const dep = deps.find((d) => d.id === b.fn_index);
      const name = dep.api_name;
      log.push({ host, name, data: b.data, session: b.session_hash, auth: init.headers?.authorization || '' });
      const id = `e${++ev}`;
      let out;
      try { out = { success: true, output: { data: apis[name].run(b.data) } }; } catch (e) { out = { success: false, output: { error: e.message, title: e.title || '' } }; }
      pending.set(b.session_hash, { id, out });
      return json({ event_id: id });
    }
    if (u.pathname === '/gradio_api/queue/data') {
      const p = pending.get(u.searchParams.get('session_hash'));
      const body = `data: ${JSON.stringify({ msg: 'estimation', event_id: p.id })}\n\ndata: ${JSON.stringify({ msg: 'process_completed', event_id: p.id, ...p.out })}\n\n`;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (u.pathname.startsWith('/gradio_api/file=')) return new Response(GLB);
    return new Response('nope', { status: 404 });
  };
}
const router = (...fakes) => async (url, init) => { for (const f of fakes) { const r = await f(url, init); if (r) return r; } return new Response('no host', { status: 404 }); };
const photo = { bytes: Buffer.alloc(3000, 1), type: 'image/jpeg' };
const file = (n) => ({ path: `/tmp/gradio/x/${n}`, url: `https://h.hf.space/gradio_api/file=/tmp/gradio/x/${n}`, orig_name: n });

test('the Gradio client sends hidden state as null, keeps the session, passes the token, and downloads only from the Space', async () => {
  const log = [];
  const f = fakeSpace('x.hf.space', { go: { inputs: ['image', 'state', 'slider'], run: (d) => [file('a.glb')] } }, log);
  const s = new GradioSpace({ host: 'https://x.hf.space', fetchImpl: router(f), token: 'hf_test' });
  const up = await s.upload(Buffer.from('x'), 'image/png');
  assert.equal(up.path, '/tmp/gradio/abc/photo.jpg');
  const out = await s.run('go', [up, 5], { session: 'sess1' });
  assert.deepEqual(log[0].data, [up, null, 5], 'the state input is null, the others in order');
  assert.equal(log[0].session, 'sess1');
  assert.equal(log[0].auth, 'Bearer hf_test');
  assert.equal((await s.download(out[0])).length, GLB.length);
  await assert.rejects(() => s.download({ url: 'https://evil.example.com/x.glb' }), /free 3D service/);
  await assert.rejects(() => s.run('missing', [], { session: 's' }), /no longer has/);
});

test('TRELLIS.2 is driven through its four steps in one session, TRELLIS in one call', async () => {
  const log = [];
  const t2 = fakeSpace('microsoft-trellis-2.hf.space', {
    start_session: { inputs: [], run: () => [] }, preprocess_image: { inputs: ['image'], run: () => [file('clean.png')] },
    image_to_3d: { inputs: ['image', 'slider', 'radio', ...Array(12).fill('slider')], run: () => [null, '<html>'] }, extract_glb: { inputs: ['state', 'slider', 'slider'], run: () => [file('out.glb'), file('out.glb')] }
  }, log);
  const r = await photoToModel(photo, { only: 'trellis2', fetchImpl: router(t2), token: 'hf_x' });
  assert.equal(r.name, 'TRELLIS.2');
  assert.deepEqual(log.map((l) => l.name), ['start_session', 'preprocess_image', 'image_to_3d', 'extract_glb']);
  assert.equal(new Set(log.map((l) => l.session)).size, 1, 'one session: the Space keeps the shape between the steps');
  assert.equal(log[2].data[0].path, '/tmp/gradio/x/clean.png', 'the cleaned picture goes on');
  assert.deepEqual(log[3].data, [null, 300000, 2048]);
  log.length = 0;
  const tr = fakeSpace('trellis-community-trellis.hf.space', { generate_and_extract_glb: { inputs: ['image', 'gallery', 'state', ...Array(8).fill('slider')], run: () => [null, file('v.mp4'), file('m.glb'), file('m.glb')] } }, log);
  const r2 = await photoToModel(photo, { only: 'trellis', fetchImpl: router(tr) });
  assert.equal(r2.name, 'TRELLIS');
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].data.slice(1, 3), [[], null], 'no extra images, hidden state null');
});

test('a busy or out-of-quota generator falls back down the list; asking for one engine does not fall back', async () => {
  const log = [];
  const quota = Object.assign(new Error('You have exceeded your ZeroGPU quota (120s requested vs. 0s left)'), { title: 'ZeroGPU quota exceeded' });
  const t2 = fakeSpace('microsoft-trellis-2.hf.space', { start_session: { inputs: [], run: () => [] }, preprocess_image: { inputs: ['image'], run: () => { throw quota; } } }, log);
  const tr = fakeSpace('trellis-community-trellis.hf.space', { generate_and_extract_glb: { inputs: ['image', 'gallery', 'state', ...Array(8).fill('slider')], run: () => { throw quota; } } }, log);
  const sf = fakeSpace('stabilityai-stable-fast-3d.hf.space', {}, log); // the old one is covered by its own tests: stand in with a failing space
  const tried = [];
  await assert.rejects(() => photoToModel(photo, { fetchImpl: router(t2, tr, sf), order: ['trellis2', 'trellis'], onTry: (e) => tried.push(e.id) }), /daily limit/);
  assert.deepEqual(tried, ['trellis2', 'trellis'], 'each in turn');
  const only = [];
  await assert.rejects(() => photoToModel(photo, { fetchImpl: router(t2, tr), only: 'trellis', onTry: (e) => only.push(e.id), order: ['trellis2', 'trellis', 'sf3d'] }), /daily limit/);
  assert.deepEqual(only, ['trellis'], 'a comparison of one engine is honest: no silent swap');
  assert.deepEqual(ENGINES.map((e) => e.id), ['trellis2', 'trellis', 'sf3d']);
  assert.equal(findGlb([null, { path: '/a/b.mp4' }, { value: { path: '/a/c.glb' } }]).path, '/a/c.glb');
});
