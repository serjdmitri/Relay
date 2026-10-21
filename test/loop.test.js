const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgent, trimImages } = require('../src/main/agent/loop');

function scripted(steps) {
  let i = 0;
  return {
    calls: [],
    async step(args) {
      this.calls.push(JSON.parse(JSON.stringify(args.messages)));
      const s = steps[i++];
      if (!s) throw new Error('provider called too many times');
      const toolCalls = (s.tools || []).map((t, n) => ({ id: `t${i}_${n}`, name: t.name, input: t.input || {} }));
      return {
        text: s.text || '',
        toolCalls,
        assistantContent: [...(s.text ? [{ type: 'text', text: s.text }] : []), ...toolCalls.map((c) => ({ type: 'tool_use', ...c }))]
      };
    }
  };
}

const tool = (name, run, extra = {}) => ({ name, description: name, input_schema: { type: 'object', properties: {} }, run, ...extra });

test('runs a tool then answers', async () => {
  const provider = scripted([{ tools: [{ name: 'list_apps' }] }, { text: 'You have 2 apps open.' }]);
  const events = [];
  const r = await runAgent({
    text: 'What apps do I have open?', provider, system: 's',
    tools: [tool('list_apps', async () => 'Finder, Notes')],
    confirm: async () => true, onEvent: (e) => events.push(e.type)
  });
  assert.equal(r.status, 'done');
  assert.equal(r.reply, 'You have 2 apps open.');
  assert.equal(r.actions, 1);
  assert.deepEqual(events, ['tool-start', 'tool']);
  const last = provider.calls[1].at(-1);
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].content[0].text, 'Finder, Notes');
});

test('confirmation gate: declined action is not run', async () => {
  let ran = false;
  const provider = scripted([{ tools: [{ name: 'send', input: { to: 'x' } }] }, { text: 'I did not send it.' }]);
  const r = await runAgent({
    text: 'text mom', provider, system: 's', confirm: async () => false,
    tools: [tool('send', async () => { ran = true; return 'sent'; }, { confirm: () => 'Send?' })]
  });
  assert.equal(ran, false);
  assert.match(provider.calls[1].at(-1).content[0].content[0].text, /declined/);
  assert.equal(r.status, 'done');
});

test('confirmation gate: approved action runs', async () => {
  let ran = false;
  const provider = scripted([{ tools: [{ name: 'send' }] }, { text: 'Sent.' }]);
  await runAgent({
    text: 't', provider, system: 's', confirm: async (q) => { assert.equal(q.question, 'Send?'); return true; },
    tools: [tool('send', async () => { ran = true; return 'ok'; }, { confirm: () => 'Send?' })]
  });
  assert.equal(ran, true);
});

test('tool errors are reported to the model, not thrown', async () => {
  const provider = scripted([{ tools: [{ name: 'boom' }] }, { text: 'That failed.' }]);
  const r = await runAgent({ text: 't', provider, system: 's', confirm: async () => true, tools: [tool('boom', async () => { throw new Error('nope'); })] });
  assert.equal(r.status, 'done');
  const tr = provider.calls[1].at(-1).content[0];
  assert.equal(tr.is_error, true);
  assert.match(tr.content[0].text, /nope/);
});

test('unknown tool is an error result', async () => {
  const provider = scripted([{ tools: [{ name: 'ghost' }] }, { text: 'ok' }]);
  await runAgent({ text: 't', provider, system: 's', confirm: async () => true, tools: [] });
  assert.equal(provider.calls[1].at(-1).content[0].is_error, true);
});

test('abort stops before the next step', async () => {
  const ac = new AbortController();
  const provider = scripted([{ tools: [{ name: 'a' }] }, { text: 'never' }]);
  const r = await runAgent({
    text: 't', provider, system: 's', confirm: async () => true, signal: ac.signal,
    tools: [tool('a', async () => { ac.abort(); return 'x'; })]
  });
  assert.equal(r.status, 'stopped');
});

test('step cap', async () => {
  const provider = { async step() { return { text: '', toolCalls: [{ id: 'x', name: 'a', input: {} }], assistantContent: [{ type: 'tool_use', id: 'x', name: 'a', input: {} }] }; } };
  const r = await runAgent({ text: 't', provider, system: 's', confirm: async () => true, tools: [tool('a', async () => 'x')], maxSteps: 3 });
  assert.equal(r.status, 'failed');
});

test('only the latest screenshots are kept', () => {
  const img = (n) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: n, content: [{ type: 'image', source: { data: n } }, { type: 'text', text: 'shot' }] }] });
  const msgs = [img('1'), img('2'), img('3')];
  trimImages(msgs);
  assert.equal(msgs[0].content[0].content[0].type, 'text');
  assert.equal(msgs[1].content[0].content[0].type, 'image');
  assert.equal(msgs[2].content[0].content[0].type, 'image');
});

test('image tool output is passed as an image block', async () => {
  const provider = scripted([{ tools: [{ name: 'shot' }] }, { text: 'seen' }]);
  await runAgent({ text: 't', provider, system: 's', confirm: async () => true, tools: [tool('shot', async () => ({ image: { mediaType: 'image/jpeg', data: 'AAA' }, text: 'hi' }))] });
  const c = provider.calls[1].at(-1).content[0].content;
  assert.equal(c[0].type, 'image');
  assert.equal(c[0].source.media_type, 'image/jpeg');
});
