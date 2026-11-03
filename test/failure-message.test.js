const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/main/failureMessage');

const why = (raw, brain = 'Claude') => f.explainBrainFailure(raw, { brain });

test('every failure names which brain had the problem and says why, in plain words', () => {
  const cases = [
    ['', 'empty', /Claude sent back an empty reply/], ['No answer.', 'empty', /empty reply/],
    ['spawn claude ENOENT', 'missing', /Claude is not installed.*Account/],
    ['Error: Not logged in · Please run /login', 'signin', /sign-in or key is not valid/], ['HTTP 401 Unauthorized', 'signin', /sign-in or key/], ['invalid x-api-key', 'signin', /sign-in or key/],
    ['429 Too Many Requests', 'busy', /overloaded or rate-limiting/], ['API Error: 529 overloaded_error', 'busy', /overloaded/], ['503 Service Unavailable', 'busy', /overloaded/],
    ['getaddrinfo ENOTFOUND api.anthropic.com', 'network', /could not reach Claude.*internet/], ['fetch failed', 'network', /could not reach/],
    ['Request timed out after 120000ms', 'timeout', /took too long/], ['ETIMEDOUT', 'timeout', /took too long/],
    ['prompt is too long: 250000 tokens > 200000 maximum', 'too-long', /too long for Claude/],
    ['model: claude-x-9 not found (404)', 'model', /does not offer the model/],
    ['Something odd happened inside', 'unknown', /^Claude had a problem: Something odd happened inside\.$/]
  ];
  for (const [raw, kind, re] of cases) { const r = why(raw); assert.equal(r.kind, kind, raw); assert.match(r.message, re, raw); assert.ok(/Claude/.test(r.message), raw); }
});

test('a usage limit says when it resets, a missing Ollama says to open it, and a missing host name is a network problem, not a missing program', () => {
  const limit = why('Claude usage limit reached|1761651600');
  assert.equal(limit.kind, 'limit'); assert.match(limit.message, /used up its usage limit; it resets around \d{1,2}:\d\d (AM|PM)\. Nothing was lost/);
  assert.equal(why('You have hit your limit').kind, 'limit'); assert.doesNotMatch(why('You have hit your limit').message, /resets around/);
  assert.match(why('connect ECONNREFUSED 127.0.0.1:11434', 'Ollama (the local model)').message, /Ollama is not running\. Open the Ollama app/);
  assert.equal(why('getaddrinfo ENOTFOUND example.com').kind, 'network');
});

test('secrets that end up in an error message never reach the screen, and long errors are cut', () => {
  const r = why('weird failure with key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV in it');
  assert.equal(r.kind, 'unknown'); assert.doesNotMatch(r.message, /ABCDEFGHIJKL/); assert.match(r.message, /\[key\]/);
  assert.ok(f.explainBrainFailure('x'.repeat(5000), { brain: 'Groq' }).message.length < 200);
});

test('brain names are the ones people know, and Codex is named when it took over from Claude', () => {
  assert.equal(f.brainName('claude'), 'Claude'); assert.equal(f.brainName('codex'), 'Codex'); assert.equal(f.brainName('ollama'), 'Ollama (the local model)');
  assert.equal(f.brainName('claude', true), 'Codex (while Claude is out of usage)'); assert.equal(f.brainName('something-new'), 'something-new'); assert.equal(f.brainName(''), 'The model');
});

test('voice failures say what is wrong with the voice and that the answer came as text or the system voice', () => {
  assert.match(f.explainVoiceFailure('quota_exceeded: You have insufficient credits', { engine: 'elevenlabs' }), /^ElevenLabs did not work because its credit is used up, so I answered in text or with the system voice\. See Settings > Voice\./);
  assert.match(f.explainVoiceFailure('401 Unauthorized', { engine: 'openai' }), /OpenAI voice did not work because its key was refused/);
  assert.match(f.explainVoiceFailure('microphone permission denied', { engine: 'omni' }), /a permission is missing/);
  assert.match(f.explainVoiceFailure('fetch failed', { engine: 'gemini' }), /could not be reached/);
  assert.match(f.explainVoiceFailure('spawn python ENOENT', { engine: 'kokoro' }), /not installed/);
  assert.match(f.explainVoiceFailure('weird', { engine: 'system' }), /^The system voice did not work because of an error \(weird\), so I answered in text\./);
});

test('the controller reports a failed request with the honest sentence instead of the raw error', () => {
  const Module = require('module'), orig = Module._load;
  Module._load = function (req, ...a) { return req === 'electron' ? { app: {}, BrowserWindow: class {}, screen: { getPrimaryDisplay: () => ({ size: {} }) }, clipboard: {}, desktopCapturer: {}, safeStorage: {}, systemPreferences: {}, nativeImage: {}, ipcMain: { handle() {} }, shell: {}, Notification: class {} } : orig.call(this, req, ...a); };
  let AskController;
  try { delete require.cache[require.resolve('../src/main/askController')]; ({ AskController } = require('../src/main/askController')); } finally { Module._load = orig; }
  const c = Object.create(AskController.prototype);
  c.store = { get: (k) => (k === 'settings.model.provider' ? 'groq' : undefined) }; c.failover = { active: false };
  const quiet = console.error; console.error = () => {};
  let r; try { r = c.failedReply(new Error('getaddrinfo ENOTFOUND api.groq.com')); } finally { console.error = quiet; }
  assert.deepEqual([r.status, r.actions], ['failed', 0]); assert.match(r.reply, /^I could not reach Groq\./);
});
