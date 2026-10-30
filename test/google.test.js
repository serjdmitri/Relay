const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { GoogleApi, googleTools, connectAccount, authUrl, pkce, bodyText, rfc822 } = require('../src/main/connectors/google');

const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (o, ok = true, status = 200) => ({ ok, status, json: async () => o, text: async () => JSON.stringify(o) });

function api(routes, accounts = [{ email: 'me@gmail.com', refreshToken: 'r1' }]) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? (String(init.headers?.['content-type']).includes('json') ? JSON.parse(init.body) : init.body) : null, auth: init.headers?.authorization });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'at', expires_in: 3600 });
    for (const [k, v] of Object.entries(routes)) if (String(url).includes(k)) return typeof v === 'function' ? v(url, init) : json(v);
    return json({}, false, 404);
  };
  const g = new GoogleApi({ accounts: () => accounts, client: () => ({ clientId: 'cid', clientSecret: 'cs' }), fetchImpl: f, now: () => new Date(2026, 9, 26, 10, 0).getTime(), timeZone: 'America/New_York' });
  return { g, calls };
}

test('the sign-in URL carries PKCE, offline access and the scopes', () => {
  const { challenge } = pkce();
  const u = new URL(authUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:1/cb', challenge, state: 's' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.match(u.searchParams.get('scope'), /gmail\.readonly.*gmail\.compose.*calendar\.events/);
});

test('the whole sign-in works against a pretend browser and a pretend Google', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push(String(url));
    if (String(url).includes('oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('grant_type'), 'authorization_code');
      assert.equal(p.get('code'), 'the-code');
      assert.ok(p.get('code_verifier'));
      return json({ access_token: 'at', refresh_token: 'rt' });
    }
    return json({ email: 'new@gmail.com' }); // userinfo
  };
  const r = await connectAccount({
    clientId: 'cid', clientSecret: 'cs', fetchImpl,
    openUrl: async (u) => { // the "browser": Google redirects back to the loopback address
      const q = new URL(u).searchParams;
      await new Promise((resolve) => http.get(`${q.get('redirect_uri')}?code=the-code&state=${q.get('state')}`, (res) => { res.resume(); res.on('end', resolve); }));
    }
  });
  assert.deepEqual(r, { email: 'new@gmail.com', refreshToken: 'rt' });
});

test('a wrong state is refused', async () => {
  await assert.rejects(connectAccount({ clientId: 'c', clientSecret: 's', fetchImpl: async () => json({}), openUrl: async (u) => { const q = new URL(u).searchParams; await new Promise((res) => http.get(`${q.get('redirect_uri')}?code=x&state=WRONG`, (r) => { r.resume(); r.on('end', res); })); } }), /did not match/);
});

test('Gmail search lists headers, read decodes the body, and the token is reused', async () => {
  const { g, calls } = api({
    '/messages?': { messages: [{ id: 'm1' }] },
    '/messages/m1?format=metadata': { snippet: 'Hi there', labelIds: ['UNREAD'], payload: { headers: [{ name: 'From', value: 'Anna <a@x.com>' }, { name: 'Subject', value: 'Dinner' }, { name: 'Date', value: 'Mon, 26 Oct 2026' }] } },
    '/messages/m1?format=full': { payload: { headers: [{ name: 'Subject', value: 'Dinner' }], mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('See you at 7!') } }, { mimeType: 'text/html', body: { data: b64('<p>See you at 7!</p>') } }] } }
  });
  const found = await g.gmailSearch(null, 'is:unread');
  assert.deepEqual(found, [{ account: 'me@gmail.com', id: 'm1', from: 'Anna <a@x.com>', subject: 'Dinner', date: 'Mon, 26 Oct 2026', snippet: 'Hi there', unread: true }]);
  assert.equal((await g.gmailRead(null, 'm1')).body, 'See you at 7!');
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1); // one refresh for all those calls
  assert.ok(calls.filter((c) => !c.url.includes('oauth2')).every((c) => c.auth === 'Bearer at'));
});

test('HTML-only mail is turned into text', () => {
  assert.equal(bodyText({ mimeType: 'text/html', body: { data: b64('<style>x{}</style><div>Hello&nbsp;<b>world</b></div><p>Bye</p>') } }), 'Hello world\nBye');
});

test('drafts and sends build a proper message, and several accounts need a choice for writing', async () => {
  const two = [{ email: 'a@gmail.com', refreshToken: 'r' }, { email: 'b@gmail.com', refreshToken: 'r2' }];
  const { g, calls } = api({ '/drafts': { id: 'd1' }, '/messages/send': { id: 's1' } }, two);
  await assert.rejects(g.gmailDraft(null, { to: 'x@y.com', subject: 'Hi', body: 'b' }), /Which account/);
  const d = await g.gmailDraft('b@', { to: 'x@y.com', subject: 'Héllo', body: 'Body' });
  assert.equal(d.account, 'b@gmail.com');
  const raw = Buffer.from(calls.at(-1).body.message.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  assert.match(raw, /^To: x@y\.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(rfc822({ to: 'a@b.c', subject: 'Plain', body: 'x' }), /Subject: Plain\r\n/);
  assert.equal((await g.gmailSend('a@', { to: 'x@y.com', subject: 'Hi', body: 'b' })).id, 's1');
  await assert.rejects(g.gmailSend('zzz', { to: 'x', subject: 's', body: 'b' }), /No connected account matches/);
});

test('calendar lists across accounts in time order and creates events in your time zone', async () => {
  const two = [{ email: 'a@gmail.com', refreshToken: 'r' }, { email: 'b@gmail.com', refreshToken: 'r2' }];
  let n = 0;
  const { g, calls } = api({ '/events?': () => json({ items: [n++ === 0 ? { id: 'e1', summary: 'Lunch', start: { dateTime: '2026-10-26T12:00:00-04:00' }, end: { dateTime: '2026-10-26T13:00:00-04:00' } } : { id: 'e2', summary: 'Standup', start: { dateTime: '2026-10-26T09:00:00-04:00' }, end: { dateTime: '2026-10-26T09:15:00-04:00' } }] }), '/calendars/primary/events': { id: 'new', htmlLink: 'L' } }, two);
  const ev = await g.calEvents(null, 1);
  assert.deepEqual(ev.map((e) => e.title), ['Standup', 'Lunch']);
  const made = await g.calCreate('a@', { title: 'Dentist', start: '2026-10-28T15:00' });
  assert.equal(made.link, 'L');
  const body = calls.at(-1).body;
  assert.deepEqual(body.start, { dateTime: '2026-10-28T15:00:00', timeZone: 'America/New_York' });
  assert.deepEqual(body.end, { dateTime: '2026-10-28T16:00:00', timeZone: 'America/New_York' });
});

test('calendar query includes the whole local day across daylight-saving transitions', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const { g, calls } = api({ '/events?': { items: [] } });
    g.now = () => new Date(2026, 10, 1, 12).getTime();
    await g.calEvents(null, 1);
    const url = new URL(calls.find((call) => call.url.includes('/events?')).url);
    assert.equal(url.searchParams.get('timeMin'), '2026-11-01T04:00:00.000Z');
    assert.equal(url.searchParams.get('timeMax'), '2026-11-02T05:00:00.000Z');
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('sending asks first; reading does not', () => {
  const t = Object.fromEntries(googleTools({}).map((x) => [x.name, x]));
  assert.match(t.gmail_send.confirm({ to: 'a@b.c', subject: 'Hello', account: 'me@gmail.com' }), /Send "Hello" to a@b\.c from me@gmail\.com/);
  for (const n of ['gmail_search', 'gmail_read', 'gmail_draft', 'gcal_events', 'gcal_create']) assert.equal(t[n].confirm, undefined, n);
});

test('Drive search, reading a Doc and a Sheet, and adding rows', async () => {
  const { g, calls } = api({
    '/drive/v3/files?': { files: [{ id: 'f1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: 't', webViewLink: 'L' }] },
    '/export?': () => ({ ok: true, status: 200, text: async () => 'a,b\n1,2' }),
    'fields=name,mimeType': { name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' },
    '/values/Sheet1:append': { updates: { updatedRows: 2, updatedRange: 'Sheet1!A5:B6' } },
    '/values/': { range: 'A1:B2', values: [['a', 'b'], ['1', '2']] }
  });
  const found = await g.driveSearch(null, "it's budget", 5);
  assert.equal(found[0].id, 'f1');
  const q = new URL(calls.at(-1).url).searchParams.get('q');
  assert.equal(q, "fullText contains 'it s budget' and trashed = false", 'a quote in the words cannot break out of the query');
  const f = await g.driveRead(null, 'f1');
  assert.equal(f.text, 'a,b\n1,2');
  assert.match(calls.at(-1).url, /export\?mimeType=text%2Fcsv/);
  assert.deepEqual((await g.sheetRead(null, 's1', 'A1:B2')).rows, [['a', 'b'], ['1', '2']]);
  const r = await g.sheetAppend(null, 's1', 'Sheet1', [['x', 1], ['y', 2]]);
  assert.equal(r.updated, 2);
  assert.deepEqual(calls.at(-1).body, { values: [['x', 1], ['y', '2'].map(String)].map((row, i) => (i ? ['y', 2] : row)) });
  await assert.rejects(() => g.sheetAppend(null, 's1', 'Sheet1', []), /no rows/);
  const tools = googleTools(g);
  const add = tools.find((t) => t.name === 'sheet_append');
  assert.match(add.confirm({ rows: [['a']] }), /Add 1 row/);
  assert.ok(['drive_search', 'drive_read', 'sheet_read'].every((n) => tools.some((t) => t.name === n)));
});

test('a file that is not text is refused, not downloaded', async () => {
  const { g } = api({ 'fields=name,mimeType': { name: 'pic.png', mimeType: 'image/png' } });
  await assert.rejects(() => g.driveRead(null, 'x'), /cannot read as text/);
});
