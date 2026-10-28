const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { detectLanguage, parseLanguageCommand, switchedReply, languageInstruction, LANGS } = require('../src/main/lang');
const { translateCommand, localizeReply } = require('../src/main/i18n');
const { parseQuick } = require('../src/main/quick');
const { buildContext } = require('../src/main/agent/system-prompt');
const { Speaker } = require('../src/main/voice');

const real = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: {}, screen: {}, BrowserWindow: class {}, ipcMain: {}, Notification: class {}, systemPreferences: {}, desktopCapturer: {}, clipboard: {}, shell: {} } : real.call(this, req, ...rest); };
let AskController;
try { ({ AskController } = require('../src/main/askController')); } finally { Module._load = real; }

test('the language of a sentence is told from its script or its everyday words, and a word or two is never guessed', () => {
  const L = (t) => detectLanguage(t)?.lang ?? null;
  assert.equal(L('Hola, puedes abrir las notas por favor'), 'es');
  assert.equal(L('Quelle heure est-il et peux-tu ouvrir Safari'), 'fr');
  assert.equal(L('Kannst du bitte die Notizen öffnen'), 'de');
  assert.equal(L('Apri le note per favore, grazie'), 'it');
  assert.equal(L('Abra o Safari por favor'), 'pt');
  assert.equal(L('Wat is het weer vandaag en kun je een timer zetten'), 'nl');
  assert.equal(L('What time is it and can you open my calendar'), 'en');
  assert.equal(L('こんにちは、時間を教えて'), 'ja');
  assert.equal(L('你好，现在几点'), 'zh');
  assert.equal(L('Привет, который час'), 'ru');
  assert.equal(L('안녕하세요 지금 몇 시예요'), 'ko');
  assert.equal(L('open Safari'), null);
  assert.equal(L('ok'), null);
  assert.equal(L(''), null);
});

test('"speak Spanish" and its equivalents in other languages change the language; a bare name or other talk does not', () => {
  const P = parseLanguageCommand;
  for (const [t, lang] of [['speak Spanish', 'es'], ['Switch to French', 'fr'], ['listen in German', 'de'], ['habla español', 'es'], ['parle français', 'fr'], ['sprich Deutsch', 'de'], ['parla italiano', 'it'], ['fala português', 'pt'], ['switch to Japanese', 'ja'], ['let us speak Korean', 'ko'], ['speak to me in Italian', 'it']]) assert.equal(P(t)?.lang, lang, t);
  assert.equal(P('what languages do you speak').type, 'languages');
  for (const t of ['español', 'open spanish notes', 'translate this into French', 'speak to me', 'what is Spanish for hello']) assert.equal(P(t), null, t);
  assert.equal(switchedReply('es'), 'Ahora te escucho en español.');
  assert.equal(switchedReply('de'), 'Ich höre jetzt auf Deutsch zu.');
  assert.equal(switchedReply('ar'), 'Now listening in Arabic.');
});

test('everyday commands in five languages become the instant commands, and answer in the same language', () => {
  const via = (lang, text) => { const f = translateCommand(text, lang); const q = f && parseQuick(f.english); return q && { type: q.type, op: q.op, seconds: q.seconds, name: q.name, reply: localizeReply(lang, q, 'x', new Date(2026, 9, 27, 15, 5)) }; };
  assert.deepEqual(via('es', 'Pausa, por favor'), { type: 'media', op: 'pause', seconds: undefined, name: undefined, reply: 'Pausado.' });
  assert.equal(via('es', 'sube el volumen').reply, 'Volumen subido.');
  assert.match(via('es', '¿Qué hora es?').reply, /^Son las 15:05\.$/);
  assert.deepEqual([via('es', 'pon un temporizador de 5 minutos').seconds, via('es', 'pon un temporizador de 5 minutos').reply], [300, 'Temporizador de 5 minutos.']);
  assert.equal(via('es', 'abre Safari').name, 'Safari');
  assert.equal(via('fr', 'Baisse le volume').reply, 'Volume baissé.');
  assert.equal(via('fr', 'Mets un minuteur de 10 minutes').seconds, 600);
  assert.equal(via('de', 'Stell einen Timer auf 3 Minuten').reply, 'Timer auf 3 Minuten gestellt.');
  assert.equal(via('de', 'Mach leiser').reply, 'Leiser.');
  assert.equal(via('de', 'Öffne Notizen').name, 'Notizen');
  assert.equal(via('it', 'Imposta un timer di 2 ore').seconds, 7200);
  assert.equal(via('it', 'Che ore sono?').reply, 'Sono le 15:05.');
  assert.equal(via('pt', 'Abre o Safari').name, 'Safari');
  assert.equal(via('pt', 'Que horas são?').reply, 'São 15:05.');
  assert.equal(translateCommand('cuéntame un chiste', 'es'), null, 'anything else goes to the model');
  assert.equal(translateCommand('pausa', 'ja'), null);
  assert.equal(translateCommand('pon un temporizador de 5 vacas', 'es'), null, 'a unit it does not know is not a timer');
});

test('the model is told which language to answer in', () => {
  assert.match(languageInstruction('auto'), /language the request was written or spoken in/);
  assert.match(languageInstruction('es'), /answer in Spanish, whatever language/);
  assert.match(buildContext({ language: languageInstruction('fr') }), /answer in French/);
  assert.doesNotMatch(buildContext({}), /Language:/);
});

function controller({ locales = [{ id: 'en-US' }, { id: 'es-ES' }, { id: 'fr-FR' }], locale = 'en-US' } = {}) {
  const data = { 'settings.speech.locale': locale };
  const c = Object.create(AskController.prototype);
  const seen = [];
  Object.assign(c, { store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, speech: { locales: async () => locales }, onChange() {}, onLanguage: (id) => seen.push(id) });
  return { c, data, seen };
}

test('saying "speak Spanish" changes the microphone language, tells the app, and answers in Spanish; an unsupported language says so', async () => {
  const { c, data, seen } = controller();
  const r = await c.runLanguage({ type: 'language', lang: 'es' });
  assert.equal(r.status, 'done');
  assert.equal(r.reply, 'Ahora te escucho en español.');
  assert.equal(data['settings.speech.locale'], 'es-ES');
  assert.deepEqual(seen, ['es-ES']);
  const no = await c.runLanguage({ type: 'language', lang: 'ja' });
  assert.equal(no.status, 'failed');
  assert.match(no.reply, /cannot listen in Japanese/);
  assert.equal(data['settings.speech.locale'], 'es-ES', 'unchanged');
  assert.match((await c.runLanguage({ type: 'languages' })).reply, /any language.*Spanish/);
  // when the list cannot be read it tries anyway
  const blind = controller({ locales: [] });
  assert.equal((await blind.c.runLanguage({ type: 'language', lang: 'de' })).status, 'done');
  assert.equal(blind.data['settings.speech.locale'], 'de-DE');
});

test('what language a request is in: its words, else the language the microphone is set to', () => {
  const { c } = controller({ locale: 'es-ES' });
  assert.equal(c.requestLanguage('Hola, puedes abrir las notas por favor'), 'es');
  assert.equal(c.requestLanguage('What time is it and can you open my calendar'), 'en');
  assert.equal(c.requestLanguage('pausa'), 'es', 'one word: the language you are listening in');
  assert.equal(controller({ locale: 'xx-XX' }).c.requestLanguage('pausa'), 'en');
});

test('an instant command in another language is understood and answered in it; the English ones are untouched', async () => {
  const { c } = controller({ locale: 'es-ES' });
  const added = [];
  Object.assign(c, { store: { get: () => 'es-ES', addAction: (a) => added.push(a) }, undos: { register() {} }, quickContext: () => ({}) });
  const r = await c.quick('¿Qué hora es?', 'r1');
  assert.match(r.reply, /^Son las \d{1,2}:\d{2}/);
  assert.equal(added.at(-1).tool, 'clock');
  const en = await c.quick('what time is it', 'r2');
  assert.match(en.reply, /^It's /);
  assert.equal(await c.quick('cuéntame un chiste', 'r3'), null, 'not an instant command: the model answers it');
});

test('a reply is spoken with a voice for its language, and the on-device English voice is not used for it', async () => {
  const calls = [];
  const spawnFn = (cmd, args) => { const ch = new EventEmitter(); ch.stdin = Object.assign(new EventEmitter(), { end: () => {} }); setImmediate(() => ch.emit('exit')); calls.push({ cmd, args }); return ch; };
  const exec = (cmd, args, o, cb) => cb(null, 'Samantha   en_US    # Hi\nDaniel   en_GB    # Hello\nMónica   es_ES    # Hola\nThomas   fr_FR    # Bonjour\nAnna   de_DE    # Hallo\n');
  const made = [];
  const kokoro = { installed: () => true, synthesize: async (p, o) => { made.push(o); return '/tmp/x.wav'; } };
  const s = new Speaker({ spawnFn, exec, log: { error() {} }, getTts: () => ({ engine: 'kokoro', kokoro: { voice: 'af_heart' } }), kokoro });
  await s.speak('Son las tres y cinco.', { lang: 'es', voice: 'jarvis' });
  assert.deepEqual(calls.find((c) => c.cmd === 'say').args.slice(0, 2), ['-v', 'Mónica']);
  assert.equal(made.length, 0, 'Kokoro is English only here');
  await s.speak('Il est trois heures cinq.', { lang: 'fr' });
  assert.equal(calls.filter((c) => c.cmd === 'say').at(-1).args[1], 'Thomas');
  await s.speak('It is five past three.', { lang: 'en' });
  assert.equal(made.length, 1, 'English still uses the on-device voice');
  assert.equal(Object.keys(LANGS).length, 15);
});
