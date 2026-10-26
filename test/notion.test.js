const test = require('node:test');
const assert = require('node:assert/strict');
const { NotionApi, notionTools, textToBlocks, blockText } = require('../src/main/connectors/notion');

const rt = (t) => [{ plain_text: t }];
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const key = `${init.method} ${url.replace('https://api.notion.com/v1', '')}`;
    const r = routes[key];
    if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => 'nope' };
    return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) };
  };
  f.calls = calls;
  return f;
}

test('search maps results and sends the token and version', async () => {
  const f = fakeFetch({ 'POST /search': { results: [{ id: 'p1', object: 'page', last_edited_time: '2026-10-20T10:00:00Z', url: 'u1', properties: { Name: { type: 'title', title: rt('Trip ideas') } } }, { id: 'd1', object: 'database', title: rt('Tasks'), url: 'u2' }] } });
  const api = new NotionApi({ token: 'secret_x', fetchImpl: f });
  assert.deepEqual(await api.search('trip'), [{ id: 'p1', type: 'page', title: 'Trip ideas', edited: '2026-10-20', url: 'u1' }, { id: 'd1', type: 'database', title: 'Tasks', edited: '', url: 'u2' }]);
  assert.equal(f.calls[0].headers.authorization, 'Bearer secret_x');
  assert.equal(f.calls[0].headers['notion-version'], '2022-06-28');
  assert.equal(f.calls[0].body.query, 'trip');
});

test('a page is read as text, blocks keep their shape', async () => {
  const f = fakeFetch({
    'GET /pages/p1': { url: 'u1', properties: { Name: { type: 'title', title: rt('Trip ideas') } } },
    'GET /blocks/p1/children?page_size=100': { results: [{ type: 'heading_1', heading_1: { rich_text: rt('Packing') } }, { type: 'to_do', to_do: { rich_text: rt('Passport'), checked: true } }, { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('Charger') } }, { type: 'paragraph', paragraph: { rich_text: [] } }] }
  });
  const r = await new NotionApi({ token: 't', fetchImpl: f }).read('p1');
  assert.equal(r.title, 'Trip ideas');
  assert.equal(r.text, '# Packing\n[x] Passport\n- Charger');
});

test('text becomes blocks, long lines are split, and create/append send them', async () => {
  const blocks = textToBlocks('# Title\n- one\ntwo\n\n' + 'x'.repeat(2500));
  assert.deepEqual(blocks.slice(0, 3).map((b) => b.type), ['heading_1', 'bulleted_list_item', 'paragraph']);
  assert.equal(blocks.length, 5); // the long line is two blocks
  const f = fakeFetch({ 'POST /pages': { id: 'n1', url: 'https://notion.so/n1' }, 'PATCH /blocks/p1/children': {} });
  const api = new NotionApi({ token: 't', fetchImpl: f });
  assert.equal((await api.create('p1', 'Plan', '- a\n- b')).url, 'https://notion.so/n1');
  assert.equal(f.calls[0].body.parent.page_id, 'p1');
  assert.equal(f.calls[0].body.children.length, 2);
  await api.append('p1', 'more');
  assert.equal(f.calls[1].method, 'PATCH');
});

test('errors say what to do', async () => {
  const api = new NotionApi({ token: 't', fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) });
  await assert.rejects(api.search('x'), /Connections/);
  const bad = new NotionApi({ token: 't', fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) });
  await assert.rejects(bad.me(), /rejected the token/);
});

test('the tools call the API', async () => {
  const calls = [];
  const api = { search: async (q) => { calls.push(['search', q]); return [{ id: 'a' }]; }, read: async (id) => ({ title: 'T', url: 'u', text: 'body', more: false }), create: async () => ({ url: 'u' }), append: async () => true };
  const t = Object.fromEntries(notionTools(api).map((x) => [x.name, x]));
  assert.equal(await t.notion_search.run({ query: 'x' }), '[{"id":"a"}]');
  assert.match(await t.notion_read.run({ id: 'a' }), /^T\nu\n\nbody/);
  assert.match(await t.notion_create.run({ parent_id: 'p', title: 'N' }), /Created "N"/);
  assert.equal(blockText({ type: 'quote', quote: { rich_text: rt('hi') } }), '> hi');
});
