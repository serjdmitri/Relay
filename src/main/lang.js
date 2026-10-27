// Languages: which one a piece of text is in, the spoken command to change language ("speak Spanish", "habla español"), and the words Relay needs to
// answer in that language for the few things it says itself. Pure. The model itself understands and answers in any language; this is what the rest of
// Relay (the voice that reads the answer, the microphone, the instant commands) needs to follow along.

// code: ISO 639-1. locale: the recognizer's locale (BCP 47). say: the system voices' locale. names: what a person calls it, in English and in itself.
const LANGS = {
  en: { name: 'English', locale: 'en-US', say: 'en_US', names: ['english', 'inglés', 'ingles', 'anglais', 'englisch', 'inglese'] },
  es: { name: 'Spanish', locale: 'es-ES', say: 'es_ES', names: ['spanish', 'español', 'espanol', 'castellano', 'espagnol', 'spanisch', 'spagnolo', 'espanhol'] },
  fr: { name: 'French', locale: 'fr-FR', say: 'fr_FR', names: ['french', 'français', 'francais', 'francés', 'frances', 'französisch', 'francese', 'francês'] },
  de: { name: 'German', locale: 'de-DE', say: 'de_DE', names: ['german', 'deutsch', 'alemán', 'aleman', 'allemand', 'tedesco', 'alemão', 'alemao'] },
  it: { name: 'Italian', locale: 'it-IT', say: 'it_IT', names: ['italian', 'italiano', 'italien', 'italienisch', 'italiana'] },
  pt: { name: 'Portuguese', locale: 'pt-BR', say: 'pt_BR', names: ['portuguese', 'português', 'portugues', 'portugués', 'portugais', 'portugiesisch', 'portoghese'] },
  nl: { name: 'Dutch', locale: 'nl-NL', say: 'nl_NL', names: ['dutch', 'nederlands', 'holandés', 'néerlandais', 'niederländisch', 'olandese'] },
  ja: { name: 'Japanese', locale: 'ja-JP', say: 'ja_JP', names: ['japanese', '日本語', 'japonés', 'japonais', 'japanisch', 'giapponese', 'nihongo'] },
  zh: { name: 'Chinese', locale: 'zh-CN', say: 'zh_CN', names: ['chinese', 'mandarin', '中文', '普通话', 'chino', 'chinois', 'chinesisch', 'cinese'] },
  ko: { name: 'Korean', locale: 'ko-KR', say: 'ko_KR', names: ['korean', '한국어', 'coreano', 'coréen', 'koreanisch'] },
  ru: { name: 'Russian', locale: 'ru-RU', say: 'ru_RU', names: ['russian', 'русский', 'ruso', 'russe', 'russisch', 'russo'] },
  ar: { name: 'Arabic', locale: 'ar-SA', say: 'ar_SA', names: ['arabic', 'العربية', 'árabe', 'arabe', 'arabisch', 'arabo'] },
  hi: { name: 'Hindi', locale: 'hi-IN', say: 'hi_IN', names: ['hindi', 'हिन्दी', 'हिंदी'] },
  tr: { name: 'Turkish', locale: 'tr-TR', say: 'tr_TR', names: ['turkish', 'türkçe', 'turkce', 'turco', 'turc'] },
  pl: { name: 'Polish', locale: 'pl-PL', say: 'pl_PL', names: ['polish', 'polski', 'polaco', 'polonais', 'polnisch', 'polacco'] }
};

// ---- which language is this text in ----
const SCRIPTS = [
  ['ja', /[぀-ヿ]/], ['ko', /[가-힯]/], ['zh', /[一-鿿]/], ['ru', /[Ѐ-ӿ]/], ['ar', /[؀-ۿ]/], ['hi', /[ऀ-ॿ]/], ['he', /[֐-׿]/], ['el', /[Ͱ-Ͽ]/], ['th', /[฀-๿]/]
];
const STOP = {
  en: 'the of and to a in is it you that he was for on are with as i his they be at one have this from or had by not but what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part'.split(' '),
  es: 'el la los las de que y en un una es se no te lo le da su por son con para al del más pero sus como está fue muy este esta eso hay qué cómo cuándo dónde por favor puedes puedo quiero necesito abre pon hola gracias también ya yo tú usted'.split(' '),
  fr: 'le la les de des du un une et est en que qui dans pour pas sur au avec ce se son sa ses mais ou où plus par je tu il nous vous ils elle être avoir fait très comment quand pourquoi ouvre mets bonjour merci aussi ça cette'.split(' '),
  de: 'der die das und ist in zu den dem nicht von sie es ein eine mit auf für als auch an er hat dass sich ich du wir ihr aber noch wie was wann warum bitte öffne mach hallo danke kann können möchte brauche schon nur oder'.split(' '),
  it: 'il lo la i gli le di che e è un una in per con non sono si da come più ma anche questo questa al del della ho hai ha io tu noi voi cosa quando dove perché apri metti ciao grazie puoi posso voglio devo già solo'.split(' '),
  pt: 'o a os as de que e é um uma em para com não se por mais do da dos das no na eu tu você nós como mas também isso este esta ao foi são tem estou abra coloca olá obrigado obrigada pode posso quero preciso já só ou quando onde porque'.split(' '),
  nl: 'de het een en van is in dat op te zijn met voor niet aan er maar om ook als dan ik je jij we ze hij zij wat hoe wanneer waarom alsjeblieft open zet hallo dank kan kun wil heb nodig nog wel naar bij'.split(' ')
};
const STOPSET = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v)]));
// letters that pin a Latin-script language down
const MARKS = { es: /[ñ¿¡]/i, fr: /[çœ]|\b(?:qu'|l'|d'|j'|c'|n'|s')/i, de: /[ß]|\b\w*(?:ung|keit|chen|lich)\b/i, pt: /[ãõ]|ção|ções/i, tr: /[ğış]/i, pl: /[ąęłńśźż]/i };

// Returns { lang, confidence } or null when it cannot tell (too short, or no clear winner). Never guesses on a word or two.
function detectLanguage(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return null;
  for (const [lang, re] of SCRIPTS) {
    const hits = (t.match(new RegExp(re.source, 'g')) || []).length;
    if (hits >= 1 && hits / t.replace(/\s/g, '').length > 0.3) return { lang, confidence: 0.95 };
  }
  const words = t.toLowerCase().replace(/[^\p{L}'\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const score = {};
  for (const [lang, set] of Object.entries(STOPSET)) score[lang] = words.filter((w) => set.has(w)).length;
  for (const [lang, re] of Object.entries(MARKS)) if (re.test(t)) score[lang] = (score[lang] || 0) + 2;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [best, bestN] = ranked[0];
  const second = ranked[1]?.[1] || 0;
  if (bestN < 2 || bestN - second < 1 || bestN / words.length < 0.2) return null;
  return { lang: best, confidence: Math.min(0.98, 0.5 + (bestN - second) / words.length) };
}

// ---- "speak Spanish" ----
const NAME_TO_LANG = new Map();
for (const [code, l] of Object.entries(LANGS)) for (const n of l.names) NAME_TO_LANG.set(n, code);
const NAMES_RE = [...NAME_TO_LANG.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// Returns { type: 'language', lang } or { type: 'languages' } or null. Works in the languages' own words as well: "habla español", "parle français", "sprich deutsch".
function parseLanguageCommand(text) {
  const n = String(text || '').toLowerCase().replace(/[.!?¡¿,]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^(?:please|por favor|s'il te plaît|bitte|per favore) /, '').replace(/ (?:please|por favor|bitte)$/, '');
  if (/^(?:what|which) languages? (?:do you|can you|will you) (?:speak|understand|know)$|^(?:list|show) (?:the )?languages$|^(?:qué|que) idiomas hablas$|^quelles langues parles-tu$|^welche sprachen sprichst du$/.test(n)) return { type: 'languages' };
  const forms = [
    `(?:speak|talk|listen|reply|answer|respond|switch|change|go|use|let'?s speak|let us speak|let'?s talk|can you speak|please speak)(?: to me)?(?: in| to| into)? (${NAMES_RE})`,
    `(?:habla|hablemos|háblame|responde|contesta|escúchame|cambia a|cambia al|pasa a|usa|escucha)(?: me)?(?: en| al)? (${NAMES_RE})`,
    `(?:parle|parlons|réponds|réponds-moi|écoute|passe en|passe au|utilise)(?:-moi)?(?: en| au)? (${NAMES_RE})`,
    `(?:sprich|sprechen wir|antworte|höre|wechsle zu|wechsle auf|benutze)(?: mit mir)?(?: auf| in)? (${NAMES_RE})`,
    `(?:parla|parliamo|rispondi|ascolta|passa a|passa all'|usa)(?: in| con)? (${NAMES_RE})`,
    `(?:fala|falemos|responde|escuta|muda para|passa para|usa)(?: em| com| para)? (${NAMES_RE})`
  ];
  for (const f of forms) {
    const m = n.match(new RegExp(`^${f}(?: with me| con yo| mit mir)?$`));
    if (m) return { type: 'language', lang: NAME_TO_LANG.get(m[1]) };
  }
  if (new RegExp(`^(${NAMES_RE})$`).test(n) && NAME_TO_LANG.get(n) !== 'en') return null; // a bare language name could be anything: not a command
  return null;
}

// What Relay says itself when the language changes, in that language (the language's own name for itself, in the form that reads naturally).
const NATIVE = { en: 'English', es: 'español', fr: 'français', de: 'Deutsch', it: 'italiano', pt: 'português', nl: 'Nederlands', ja: '日本語', zh: '中文', ko: '한국어', ru: 'русский', ar: 'العربية', hi: 'हिन्दी', tr: 'Türkçe', pl: 'polski' };
const SWITCHED = {
  en: (l) => `Now listening in ${l}.`, es: (l) => `Ahora te escucho en ${l}.`, fr: (l) => `Je vous écoute maintenant en ${l}.`, de: (l) => `Ich höre jetzt auf ${l} zu.`,
  it: (l) => `Ora ti ascolto in ${l}.`, pt: (l) => `Agora estou ouvindo em ${l}.`, nl: (l) => `Ik luister nu in het ${l}.`, ja: (l) => `${l}で聞き取ります。`,
  zh: (l) => `现在用${l}听你说话。`, ko: (l) => `이제 ${l}로 듣겠습니다.`, ru: (l) => `Теперь слушаю на языке: ${l}.`
};
const nativeName = (code) => NATIVE[code] || LANGS[code].name;
const switchedReply = (code) => (SWITCHED[code] || SWITCHED.en)(SWITCHED[code] ? nativeName(code) : LANGS[code].name);

// The line added to a request's context so the answer comes back in the right language. reply: 'auto' (the language it was asked in) or a code.
function languageInstruction(reply = 'auto') {
  if (reply && reply !== 'auto' && LANGS[reply]) return `Language: answer in ${LANGS[reply].name}, whatever language the request is in. Tool names and arguments stay in English.`;
  return 'Language: answer in the language the request was written or spoken in (the request may be in any language). Tool names and arguments stay in English. Keep the final answer short, as always.';
}

module.exports = { LANGS, detectLanguage, parseLanguageCommand, switchedReply, languageInstruction, nativeName };
