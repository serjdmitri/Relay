// "Go offline" / "go online": switch Jarvis's thinking between the cloud model (Claude and the rest) and a local model on this Mac (Ollama), by voice or text. The rest of the offline chain is already
// local: speech-to-text is Apple's on-device dictation (native/relay-speech) and the voice (OmniVoice) is made on this Mac. Only the thinking goes to the cloud, and this switches that.
//
// A local model keeps everything on the Mac (no internet, no bill, nothing sent anywhere) but is weaker than Claude at using tools and at long or tricky requests, so the reply says so.
// Pure apart from the store and the one HTTP GET passed in, so it is tested without Ollama.

const RECOMMENDED = { text: 'qwen2.5:7b', textSize: '4.7 GB', vision: 'qwen2.5vl:7b', visionSize: '6 GB' };

function parseLocalCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:go|switch|work|run)(?: to)? (?:offline|local|private)(?: mode)?$|^use (?:the |a )?(?:local|offline|private) (?:model|brain|mode)$|^(?:turn on|enable|start|switch on) (?:the )?(?:offline|local|private) (?:mode|model|brain)$|^think locally$|^go private$/.test(n)) return { type: 'local-on' };
  if (/^(?:go|come|switch|get)(?: back)? online$|^use (?:the |a )?(?:cloud|online) (?:model|brain|mode)$|^(?:turn off|disable|stop|switch off) (?:the )?(?:offline|local|private) (?:mode|model|brain)$|^stop thinking locally$/.test(n)) return { type: 'local-off' };
  if (/^(?:am i|are we|are you) (?:offline|local|private|online)(?: right now| now)?$|^which (?:model|brain) (?:are you|am i) (?:using|on)$|^(?:local|offline) (?:model|mode|brain) status$|^what(?:'s| is) (?:your|the) (?:model|brain)$/.test(n)) return { type: 'local-status' };
  return null;
}

// Is Ollama running, and does it have this model? -> { running, hasModel, models: [names] }
async function ollamaState({ get, url = 'http://127.0.0.1:11434', model = '' }) {
  try {
    const t = await get(url.replace(/\/+$/, '') + '/api/tags');
    const models = (t.models || []).map((m) => String(m.name || m.model || '')).filter(Boolean);
    const base = String(model).split(':')[0];
    const hasModel = !!model && models.some((m) => m === model || (!String(model).includes(':') && m.split(':')[0] === base));
    return { running: true, hasModel, models };
  } catch { return { running: false, hasModel: false, models: [] }; }
}

function readiness(st, model) {
  if (!st.running) return `Ollama is not running on this Mac. Install it from ollama.com and open it, then say "go offline" again. To get a model, run "ollama pull ${RECOMMENDED.text}" in Terminal (about ${RECOMMENDED.textSize}; I will not download it without your say-so).`;
  if (!st.hasModel) return `Ollama is running but does not have ${model || 'a model'} yet. Run "ollama pull ${model || RECOMMENDED.text}" in Terminal${st.models.length ? `, or I can use one you already have: ${st.models.slice(0, 3).join(', ')}` : ''}.`;
  return '';
}

// c: a parsed command. store: get/set. get: async url -> parsed JSON. apply(value): switch the provider with the side effects (stop cloud connections, drop the warm session).
async function run(c, { store, get, apply = (v) => store.set('settings.model.provider', v) }) {
  const m = store.get('settings.model') || {};
  const model = m.ollamaModel || RECOMMENDED.text;
  const local = m.provider === 'ollama';
  if (c.type === 'local-status') {
    if (!local) return { status: 'done', reply: `I am thinking in the cloud (${m.provider || 'Claude'}). Say "go offline" to think on this Mac instead.`, actions: 0 };
    const st = await ollamaState({ get, url: m.ollamaUrl, model });
    return { status: 'done', reply: `I am thinking locally with ${model}. ${readiness(st, model) || 'Ollama is running and has that model.'}`, actions: 0 };
  }
  if (c.type === 'local-off') {
    if (!local) return { status: 'done', reply: 'I am already thinking in the cloud, Sir.', actions: 0 };
    const back = m.cloudProvider && m.cloudProvider !== 'ollama' ? m.cloudProvider : 'claude';
    apply(back);
    return { status: 'done', reply: 'Back online, Sir. I am thinking in the cloud again.', actions: 1 };
  }
  // local-on
  const st = await ollamaState({ get, url: m.ollamaUrl, model });
  if (!local) { if (m.provider) store.set('settings.model.cloudProvider', m.provider); apply('ollama'); }
  const problem = readiness(st, model);
  const vision = /llava|vision|minicpm-v|qwen2\.5-?vl|qwen3-?vl|gemma3|bakllava|moondream/i.test(model);
  const tail = ` My ears and my voice were already on this Mac. A local model is weaker at tools and long requests, and ${vision ? 'it can look through the camera' : `to describe the camera it needs a vision model such as ${RECOMMENDED.vision} (${RECOMMENDED.visionSize})`}. Your phone's Jarvis still needs this Mac to be on. Say "go online" to switch back.`;
  if (problem) return { status: 'done', reply: `Local mode is on, but I cannot think yet. ${problem}`, actions: 1 };
  return { status: 'done', reply: `Local mode is on, Sir: I am thinking on this Mac with ${model}, and nothing leaves it.${tail}`, actions: 1 };
}

module.exports = { parseLocalCommand, ollamaState, readiness, run, RECOMMENDED };
