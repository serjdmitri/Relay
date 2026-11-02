const test = require('node:test'), assert = require('node:assert/strict');
const { Twilio, twimlFor } = require('../src/main/calls/twilio');
const { Bland } = require('../src/main/calls/bland');
const { Calls, DEFAULTS } = require('../src/main/calls/service');

const SID = 'AC' + 'a'.repeat(32), CALL = 'CA' + 'b'.repeat(32), TOKEN = 'secret-token-1234';
const creds = { sid: SID, token: TOKEN, from: '+15555550100', voice: 'Polly.Brian' };
const reply = (status, body) => ({ ok: status < 300, status, json: async () => { if (body === undefined) throw Error('no body'); return body; } });
function client(handler, c = creds) { const seen = []; return { t: new Twilio({ getCreds: () => c, fetchFn: async (url, options) => { seen.push({ url, options }); return handler(url, options, seen.length); } }), seen }; }

test('a call is one form POST to Twilio with Basic auth, the Twilio number as caller and the message as inline TwiML', async () => {
  const { t, seen } = client(async () => reply(201, { sid: CALL, status: 'queued' }));
  const out = await t.dial({ id: 'r', number: '+15555550123', purpose: 'Your <robotics> meeting & "lunch" at 3' });
  assert.deepEqual(out, { callId: CALL });
  const { url, options } = seen[0];
  assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`);
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
  assert.equal(options.headers.authorization, 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'));
  assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(options.body);
  assert.equal(form.get('To'), '+15555550123'); assert.equal(form.get('From'), '+15555550100');
  const twiml = form.get('Twiml');
  assert.match(twiml, /^<Response><Say voice="Polly\.Brian">Hello, this is Jarvis, your AI assistant\./);
  assert.ok(twiml.includes('Your &lt;robotics&gt; meeting &amp; &quot;lunch&quot; at 3'), 'the purpose is escaped, so it cannot add TwiML');
  assert.equal(twiml.split('Your &lt;robotics&gt;').length - 1, 2, 'the purpose is read twice');
  assert.match(twiml, /<Hangup\/><\/Response>$/);
  assert.ok(!options.body.includes(TOKEN), 'the token travels only in the header');
});

test('the message cannot smuggle TwiML, a bad voice falls back, and a long purpose is cut', () => {
  const evil = twimlFor({ purpose: '</Say><Dial>+19995551234</Dial><Say>' });
  assert.ok(!evil.includes('<Dial>') && evil.includes('&lt;Dial&gt;'));
  assert.match(twimlFor({ purpose: 'x' }, 'Polly.Brian"><Hangup/>'), /voice="Polly\.Brian"/);
  assert.match(twimlFor({ purpose: 'x' }, 'Polly.Amy'), /voice="Polly\.Amy"/);
  assert.ok(twimlFor({ purpose: 'y'.repeat(5000) }).length < 3000);
  assert.ok(!/[\u0000-\u0008]/.test(twimlFor({ purpose: 'a\u0000b\u0007c' })));
});

test('Twilio problems are explained plainly and never leak the token', async () => {
  const run = async (status, body) => { const { t } = client(async () => reply(status, body)); try { await t.dial({ number: '+15555550123', purpose: 'x' }); } catch (e) { return e; } };
  assert.match((await run(401, { code: 20003 })).message, /rejected the account SID or auth token/);
  assert.match((await run(400, { code: 21219, message: `The number is unverified for ${TOKEN}` })).message, /only call numbers you verified/);
  assert.match((await run(400, { code: 21211 })).message, /did not accept that phone number/);
  assert.match((await run(500, { code: 99999 })).message, /HTTP 500, code 99999/);
  for (const e of [await run(401, {}), await run(400, { code: 21219, message: TOKEN }), await run(500, {})]) assert.ok(!e.message.includes(TOKEN) && !e.message.includes(SID));
  const { t } = client(async () => { throw Error('socket hang up'); });
  const net = await t.dial({ number: '+15555550123', purpose: 'x' }).catch((e) => e);
  assert.match(net.message, /could not be reached.*uncertain/); assert.notEqual(net.fallbackOk, true, 'an unclear network failure is never a reason to call again');
  assert.match((await client(async () => reply(201, { sid: 'nope', status: 'queued' })).t.dial({ number: '+15555550123', purpose: 'x' }).catch((e) => e)).message, /verifiable call ID/);
  assert.throws(() => new Twilio({ getCreds: () => ({ sid: 'bad', token: 't', from: '+1' }) }).creds(), /Add your Twilio/);
  assert.throws(() => new Twilio({ getCreds: () => ({ sid: SID, token: '', from: '+15555550100' }) }).creds(), /Add your Twilio/);
});

test('call details come back in the shape the call service already reads', async () => {
  const det = async (d) => client(async () => reply(200, d)).t.details(CALL);
  const live = await det({ status: 'in-progress' }); assert.equal(live.completed, false); assert.equal(live.status, 'in-progress');
  const done = await det({ status: 'completed', duration: '42', price: '-0.0140' });
  assert.deepEqual([done.completed, done.status, done.answered_by, done.price], [true, 'completed', 'human', 0.014]); assert.ok(Math.abs(done.call_length - 0.7) < 1e-9);
  assert.match(done.summary, /read your message aloud \(42 seconds\)\. This is a one-way message call/);
  assert.equal((await det({ status: 'completed', duration: '0' })).answered_by, 'unknown'); assert.match((await det({ status: 'completed', duration: '0' })).summary, /ended before the message played/);
  assert.equal((await det({ status: 'canceled' })).status, 'cancelled');
  assert.equal((await det({ status: 'failed' })).error_message, 'Twilio could not complete the call.');
  assert.equal((await det({ status: 'busy' })).completed, true); assert.equal((await det({ status: 'ringing' })).completed, false);
  await assert.rejects(client(async () => reply(200, {})).t.details('../../x'), /valid call ID/);
});

test('stopping hangs up a live call and cancels one that has not been answered; check reports a trial account', async () => {
  const posts = [];
  const { t } = client(async (url, o) => { if (o.method === 'POST') { posts.push(new URLSearchParams(o.body).get('Status')); return reply(200, {}); } return reply(200, { status: url.includes('live') ? 'in-progress' : 'ringing' }); });
  const live = new Twilio({ getCreds: () => creds, fetchFn: async (url, o) => { if (o.method === 'POST') { posts.push(new URLSearchParams(o.body).get('Status')); return reply(200, {}); } return reply(200, { status: 'in-progress' }); } });
  await live.stop(CALL); await t.stop(CALL);
  assert.deepEqual(posts, ['completed', 'canceled']);
  assert.deepEqual(await client(async () => reply(200, { status: 'active', type: 'Trial' })).t.check(), { ok: true, trial: true });
  assert.deepEqual(await client(async () => reply(200, { status: 'active', type: 'Full' })).t.check(), { ok: true, trial: false });
  await assert.rejects(client(async () => reply(200, { status: 'suspended' })).t.check(), /suspended/);
});

// ---- the shared service: provider choice and the safe fallback ----
function service({ provider = 'auto', bland, twilio, hasKey = true, hasTwilio = true } = {}) {
  const store = { data: { settings: { calls: { ...DEFAULTS, enabled: true, ownerNumber: '+15555550123', quiet: false, provider } }, callRequests: [], callSchedules: [] }, get(k) { return k.split('.').reduce((o, p) => o?.[p], this.data); }, set(k, v) { this.data.settings.calls = v; }, flush() {} };
  const log = [];
  const apiB = { dial: async (r) => { log.push('bland'); if (bland?.dial) return bland.dial(r); return { callId: 'bland-call' }; }, details: async () => { log.push('bland-details'); return { completed: true, status: 'completed' }; }, stop: async () => log.push('bland-stop') };
  const apiT = { dial: async (r) => { log.push('twilio'); if (twilio?.dial) return twilio.dial(r); return { callId: CALL }; }, details: async () => { log.push('twilio-details'); return { completed: true, status: 'completed', summary: 'Twilio read it', concatenated_transcript: 'one-way' }; }, stop: async () => log.push('twilio-stop') };
  const calls = new Calls({ store, api: apiB, twilio: apiT, hasKey: () => hasKey, hasTwilio: () => hasTwilio, now: () => new Date(2026, 10, 2, 12).getTime() });
  return { calls, store, log };
}
const refused = (m) => Object.assign(Error(m), { fallbackOk: true });

test('settings: the provider, SID, Twilio number and voice are validated, and the token never appears in state', () => {
  const { calls, store } = service();
  calls.configure({ provider: 'twilio', twilioSid: SID, twilioFrom: '+1 (555) 555-0100', twilioVoice: 'Polly.Amy' });
  const cfg = calls.config(); assert.deepEqual([cfg.provider, cfg.twilioSid, cfg.twilioFrom, cfg.twilioVoice], ['twilio', SID, '+15555550100', 'Polly.Amy']);
  for (const bad of [{ provider: 'skype' }, { twilioSid: 'AC123' }, { twilioSid: 'XX' + 'a'.repeat(32) }, { twilioFrom: '12345' }, { twilioVoice: 'bad voice!' }]) assert.throws(() => calls.configure(bad));
  calls.configure({ twilioSid: '', twilioFrom: '' }); assert.equal(calls.config().twilioSid, '');
  store.data.settings.calls.twilioTokenEnc = 'ENCRYPTED';
  const st = calls.state(); assert.ok(!JSON.stringify(st).includes('ENCRYPTED') && !('twilioTokenEnc' in st.config) && !('keyEnc' in st.config));
  assert.equal(st.hasTwilio, true); assert.equal(typeof st.ready, 'boolean');
  assert.equal(DEFAULTS.provider, 'auto');
});

test('"ready" depends on the chosen provider, and a call cannot be approved when none is set up', async () => {
  assert.equal(service({ provider: 'auto', hasKey: false, hasTwilio: true }).calls.ready(), true);
  assert.equal(service({ provider: 'auto', hasKey: false, hasTwilio: false }).calls.ready(), false);
  assert.equal(service({ provider: 'bland', hasKey: false, hasTwilio: true }).calls.ready(), false);
  assert.equal(service({ provider: 'twilio', hasKey: true, hasTwilio: false }).calls.ready(), false);
  const s = service({ provider: 'twilio', hasTwilio: false }); const r = s.calls.prepare('Check in');
  await assert.rejects(s.calls.approve(r.id, async () => true), /Twilio account details/);
  assert.deepEqual(s.log, []);
});

test('Bland is used first; Twilio takes over only when Bland definitely refused (no balance or a rejected key)', async () => {
  const ok = service(); const r1 = ok.calls.prepare('Check in'); assert.deepEqual(await ok.calls.approve(r1.id, async () => true), { ok: true });
  assert.deepEqual(ok.log, ['bland']); assert.equal(r1.provider, 'bland'); assert.equal(r1.fellBack, undefined);
  const broke = service({ bland: { dial: async () => { throw refused('Bland billing or balance needs attention.'); } } });
  const r2 = broke.calls.prepare('Check in'); assert.deepEqual(await broke.calls.approve(r2.id, async () => true), { ok: true });
  assert.deepEqual(broke.log, ['bland', 'twilio']); assert.equal(r2.provider, 'twilio'); assert.equal(r2.callId, CALL); assert.equal(r2.state, 'queued');
  assert.match(r2.fellBack, /Bland billing or balance needs attention.*Twilio read the message instead/);
});

test('an unclear Bland failure never triggers a second call: the call is marked uncertain and Twilio is not used', async () => {
  const s = service({ bland: { dial: async () => { throw Error('Bland could not be reached. The call outcome may be uncertain.'); } } });
  const r = s.calls.prepare('Check in'); const out = await s.calls.approve(r.id, async () => true);
  assert.match(out.error, /uncertain/); assert.equal(r.state, 'uncertain'); assert.deepEqual(s.log, ['bland']);
  const retry = s.calls.prepare('Again'); await assert.rejects(s.calls.approve(retry.id, async () => true), /Another call is active or uncertain/);
});

test('provider modes: Bland only never uses Twilio, Twilio only never uses Bland, and Twilio alone works with no Bland key', async () => {
  const only = service({ provider: 'bland', bland: { dial: async () => { throw refused('Bland billing or balance needs attention.'); } } });
  const a = only.calls.prepare('x'); const out = await only.calls.approve(a.id, async () => true);
  assert.match(out.error, /balance/); assert.deepEqual(only.log, ['bland']); assert.equal(a.state, 'uncertain');
  const tw = service({ provider: 'twilio' }); const b = tw.calls.prepare('x'); await tw.calls.approve(b.id, async () => true);
  assert.deepEqual(tw.log, ['twilio']); assert.equal(b.provider, 'twilio');
  const nokey = service({ provider: 'auto', hasKey: false }); const c = nokey.calls.prepare('x'); await nokey.calls.approve(c.id, async () => true);
  assert.deepEqual(nokey.log, ['twilio']); assert.equal(c.provider, 'twilio');
});

test('status, stop and the report go to the provider that placed the call', async () => {
  const s = service({ bland: { dial: async () => { throw refused('Bland rejected the key or access.'); } } });
  const r = s.calls.prepare('Check in'); await s.calls.approve(r.id, async () => true);
  s.log.length = 0;
  await s.calls.refresh(r.id); assert.deepEqual(s.log, ['twilio-details']);
  assert.equal(r.state, 'completed');
  assert.deepEqual(await s.calls.report(r.id), { summary: 'Twilio read it', transcript: 'one-way' });
  r.state = 'active'; await s.calls.stop(r.id); assert.ok(s.log.includes('twilio-stop') && !s.log.includes('bland-stop'));
  const b = service(); const rb = b.calls.prepare('x'); await b.calls.approve(rb.id, async () => true); b.log.length = 0; await b.calls.refresh(rb.id); assert.deepEqual(b.log, ['bland-details']);
});

test('Bland marks only definite refusals as safe to fall back from', async () => {
  const run = async (status) => { const b = new Bland({ getKey: () => 'k', fetchFn: async () => ({ ok: false, status, json: async () => ({}) }) }); return b.dial({ id: 'x', number: '+15555550123', purpose: 'p', minutes: 1 }).catch((e) => e); };
  for (const [status, ok] of [[401, true], [402, true], [403, true], [400, false], [429, false], [500, false], [502, false]]) assert.equal((await run(status)).fallbackOk === true, ok, `HTTP ${status}`);
  const nokey = await new Bland({ getKey: () => '' }).dial({ number: '+15555550123' }).catch((e) => e); assert.equal(nokey.fallbackOk, true);
  const net = await new Bland({ getKey: () => 'k', fetchFn: async () => { throw Error('reset'); } }).dial({ number: '+15555550123' }).catch((e) => e); assert.notEqual(net.fallbackOk, true);
});
