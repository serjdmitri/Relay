const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/main/council');

test('commands are understood, with an optional deeper round', () => {
  assert.deepEqual(c.parseCouncilCommand('Ask the council whether I should buy the blue one'), { type: 'council', question: 'I should buy the blue one', mode: 'quick' });
  assert.deepEqual(c.parseCouncilCommand('convene the council on moving my study time, think hard'), { type: 'council', question: 'moving my study time', mode: 'thinking' });
  assert.equal(c.parseCouncilCommand('open notes'), null);
  assert.equal(c.parseCouncilCommand('ask the council'), null);
});

test('votes are parsed strictly and the majority wins', () => {
  assert.deepEqual(c.parseVote('Sure {"vote":"Approve","reason":"fine"}'), { vote: 'approve', reason: 'fine' });
  assert.equal(c.parseVote('{"vote":"maybe"}'), null);
  assert.equal(c.parseVote('nope'), null);
  assert.deepEqual(c.tally([{ vote: 'approve' }, { vote: 'deny' }, { vote: 'approve' }]), { verdict: 'approve', yes: 2, no: 1, unanimous: false });
  assert.equal(c.tally([{ vote: 'approve' }, null, null]), null, 'one voice is not a council');
  assert.equal(c.tally([{ vote: 'deny' }, { vote: 'approve' }]).verdict, 'deny', 'a tie is a no');
});

test('quick mode asks each voice once; thinking shows the others and lets a vote change', async () => {
  const prompts = [];
  const ask = async (p) => {
    prompts.push(p);
    const who = /You are the (\w+)/.exec(p)[1];
    const saw = p.includes('The other voices said');
    if (who === 'Guardian' && saw) return '{"vote":"approve","reason":"convinced"}';
    return who === 'Guardian' ? '{"vote":"deny","reason":"risky"}' : '{"vote":"approve","reason":"ok"}';
  };
  const quick = await c.convene({ ask, question: 'buy it' });
  assert.equal(prompts.length, 3);
  assert.equal(quick.result.yes, 2);
  prompts.length = 0;
  const deep = await c.convene({ ask, question: 'buy it', mode: 'thinking' });
  assert.equal(prompts.length, 6);
  assert.equal(deep.result.unanimous, true);
  assert.match(c.speak(deep), /^The council says yes, 3 to 0, unanimous\./);
});

test('a voice that fails is skipped; too few answers is said plainly', async () => {
  let n = 0;
  const flaky = async () => { if (++n > 1) throw new Error('down'); return '{"vote":"approve","reason":"ok"}'; };
  const r = await c.convene({ ask: flaky, question: 'go' });
  assert.equal(r.result, null);
  assert.match(c.speak(r), /could not reach a decision/);
});
