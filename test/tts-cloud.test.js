const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../src/main/tts/cloud');
const { sentences, openaiRequest, elevenRequest, synthesize } = cloud;

test('sentences splits a reply into short pieces and keeps all the words', () => {
  const t = 'I opened Notes. Then I made a note called Plan! Did that work? Yes, it did.';
  const parts = sentences(t, 30);
  assert.ok(parts.length >= 3);
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), t);
  assert.deepEqual(sentences('Just one sentence'), ['Just one sentence']);
  assert.deepEqual(sentences('   '), []);
  const long = 'word '.repeat(200).trim() + '.';
  const cut = sentences(long, 100);
  assert.ok(cut.every((p) => p.length <= 170), 'a very long sentence is cut up');
  assert.equal(cut.join(' ').split(/\s+/).length, 200 + 0, 'no words lost');
});

test('OpenAI request carries the model, voice, speed and the key, and only gpt-4o models get instructions', () => {
  const r = openaiRequest({ key: 'sk-x', model: 'gpt-4o-mini-tts', voice: 'marin', instructions: 'Be warm.' }, 'Hello', 'faster');
  const body = JSON.parse(r.init.body);
  assert.equal(r.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(r.init.headers.Authorization, 'Bearer sk-x');
  assert.deepEqual([body.model, body.voice, body.input, body.response_format, body.speed, body.instructions], ['gpt-4o-mini-tts', 'marin', 'Hello', 'mp3', 1.15, 'Be warm.']);
  assert.equal(JSON.parse(openaiRequest({ key: 'k', model: 'tts-1', instructions: 'x' }, 'Hi').init.body).instructions, undefined);
});

test('ElevenLabs request puts the voice in the URL and needs a voice id', () => {
  const r = elevenRequest({ key: 'xi', voiceId: 'abc 123', model: 'eleven_flash_v2_5' }, 'Hi');
  assert.equal(r.url, 'https://api.elevenlabs.io/v1/text-to-speech/abc%20123?output_format=mp3_44100_128');
  assert.equal(r.init.headers['xi-api-key'], 'xi');
  assert.deepEqual(JSON.parse(r.init.body), { text: 'Hi', model_id: 'eleven_flash_v2_5' });
  assert.throws(() => elevenRequest({ key: 'xi' }, 'Hi'), /voice ID/);
});

test('synthesize returns audio bytes and turns failures into advice', async () => {
  const ok = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  assert.deepEqual([...(await synthesize('openai', { key: 'k' }, 'Hi', { fetchFn: ok }))], [1, 2, 3]);
  const bad = (status, body) => async () => ({ ok: false, status, text: async () => JSON.stringify(body) });
  await assert.rejects(() => synthesize('openai', { key: 'k' }, 'Hi', { fetchFn: bad(401, { error: { message: 'Incorrect API key' } }) }), /OpenAI rejected the key.*Incorrect API key/);
  await assert.rejects(() => synthesize('elevenlabs', { key: 'k', voiceId: 'v' }, 'Hi', { fetchFn: bad(429, { detail: { message: 'quota_exceeded' } }) }), /ElevenLabs says you are out of quota.*quota_exceeded/);
  await assert.rejects(() => synthesize('elevenlabs', { key: 'k', voiceId: 'v' }, 'Hi', { fetchFn: bad(404, {}) }), /did not accept the voice or model/);
  await assert.rejects(() => synthesize('openai', { key: 'k' }, 'Hi', { fetchFn: async () => { throw new Error('ENOTFOUND'); } }), /Could not reach OpenAI/);
  await assert.rejects(() => synthesize('openai', {}, 'Hi', { fetchFn: ok }), /Add your OpenAI key/);
  await assert.rejects(() => synthesize('nope', { key: 'k' }, 'Hi'), /Unknown voice engine/);
});

test('gemini: asks for one voice with a style note and decodes the last audio part', async () => {
  const wav = Buffer.from('RIFFdata');
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text' }, { type: 'audio', data: wav.toString('base64') }] }] }) }; };
  const out = await cloud.synthesize('gemini', { key: 'k', voice: 'Puck', style: 'dry' }, 'Hello.', { fetchFn });
  assert.deepEqual(out, wav);
  assert.match(seen.url, /v1beta\/interactions$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'k');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.generation_config.speech_config[0].voice, 'Puck');
  assert.equal(body.input[0].content[0].annotations[0].style, 'dry');
  assert.equal(cloud.EXT.gemini, 'wav');
});

test('gemini: a reply with no audio says what to check', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ steps: [] }) });
  await assert.rejects(cloud.synthesize('gemini', { key: 'k' }, 'Hi.', { fetchFn }), /no audio/);
  await assert.rejects(cloud.synthesize('gemini', {}, 'Hi.', { fetchFn }), /Gemini key/);
});

test('gemini voices include the ones the other Jarvis projects use', () => {
  for (const v of ['Charon', 'Puck', 'Kore']) assert.ok(cloud.GEMINI_VOICES.includes(v));
});
