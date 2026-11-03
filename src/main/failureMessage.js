// Honest failures (idea from Darwin's changelog: "when a brain is briefly unavailable, Darwin tells you the truth, which brain and why, instead of failing silently").
// A raw error such as "spawn claude ENOENT" or "HTTP 401" becomes a plain sentence that names WHICH brain (or voice) had the problem and WHY, and says what to do.
// Pure: the error text goes in, a sentence comes out.

const { isLimitText, parseResetAt } = require('./failover');

const NAMES = { claude: 'Claude', codex: 'Codex', ollama: 'Ollama (the local model)', groq: 'Groq', openai: 'OpenAI', anthropic: 'Claude (API)', gemini: 'Gemini', deepseek: 'DeepSeek' };
const brainName = (provider, failoverActive = false) => (failoverActive && provider === 'claude' ? 'Codex (while Claude is out of usage)' : NAMES[String(provider || '').toLowerCase()] || (provider ? String(provider) : 'The model'));
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').replace(/(?:sk|key|token)[-_][A-Za-z0-9_-]{12,}/gi, '[key]').trim().slice(0, n);

// raw: the error text; brain: a name from brainName(). -> { kind, message }
function explainBrainFailure(raw, { brain = 'The model', now = Date.now() } = {}) {
  const t = String(raw ?? '');
  const say = (kind, message) => ({ kind, message });
  if (!t.trim() || /no answer|empty (?:reply|response)|returned nothing|did not (?:answer|reply)/i.test(t)) return say('empty', `${brain} sent back an empty reply, so there is nothing to show. Ask again; if it keeps happening, check ${brain}'s status.`);
  // a USAGE limit (it ends at a time) is not the same as being rate-limited for a moment (429), which says "busy" below
  if (/usage limit|hit your (?:\w+ ){0,3}limit|limit (?:reached|exceeded)|out of (?:usage|messages|credits)|resets? (?:at|in)\b|\|\s*\d{10}/i.test(t) && isLimitText(t)) { const at = parseResetAt(t, now); return say('limit', `${brain} has used up its usage limit${at ? `; it resets around ${new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}. Nothing was lost.`); }
  if (/not installed|ENOENT|command not found|no such file or directory/i.test(t) && !/ENOTFOUND/.test(t)) return say('missing', `${brain} is not installed on this Mac (or Relay cannot find it), so I could not run it. Open Account in Relay for the install steps.`);
  if (/not logged in|please run .{0,20}login|authentication[_ ]error|unauthori[sz]ed|\b401\b|\b403\b|invalid (?:x-)?api[ _-]?key|incorrect api key|api key.{0,20}(?:invalid|rejected|revoked)|sign.?in.{0,20}expired|token.{0,20}(?:invalid|expired)|expired.{0,20}token|oauth/i.test(t)) return say('signin', `${brain} refused the request because the sign-in or key is not valid (it may have expired). Sign in again in Account in Relay.`);
  if (/ECONNREFUSED/.test(t) && /11434|ollama/i.test(`${t} ${brain}`)) return say('network', 'Ollama is not running. Open the Ollama app and try again.');
  if (/\b429\b|rate.?limit|too many requests|overloaded|\b529\b|\b503\b|\b502\b|temporarily unavailable|at capacity|service unavailable/i.test(t)) return say('busy', `${brain} is overloaded or rate-limiting right now. Give it a minute and ask again.`);
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|network (?:error|is)|socket hang up|offline|getaddrinfo/i.test(t)) return say('network', `I could not reach ${brain}. Check the internet connection and try again.`);
  if (/timed? ?out|ETIMEDOUT|timeout|took too long/i.test(t)) return say('timeout', `${brain} took too long and I stopped waiting. Nothing was lost; ask again, or try a shorter request.`);
  if (/context.{0,30}(?:length|window|limit)|prompt is too long|too many tokens|maximum.{0,20}tokens|request too large|\b413\b/i.test(t)) return say('too-long', `That request was too long for ${brain}. Try a shorter one, or start a fresh conversation.`);
  if (/model.{0,30}(?:not found|does not exist|unavailable|deprecated)|\b404\b/i.test(t)) return say('model', `${brain} does not offer the model Relay asked for. Choose another model in Settings.`);
  return say('unknown', `${brain} had a problem: ${clean(t, 140)}.`);
}

// The voice: a better voice failed and the system voice took over (or nothing could speak). -> a sentence
function explainVoiceFailure(raw, { engine = 'The voice' } = {}) {
  const t = String(raw ?? '');
  const name = { elevenlabs: 'ElevenLabs', openai: 'OpenAI voice', gemini: 'Gemini voice', kokoro: 'The local voice (Kokoro)', omni: 'The local voice', system: 'The system voice' }[String(engine).toLowerCase()] || engine;
  let why;
  if (/quota|credit|insufficient|exceeded|payment|billing|\b402\b/i.test(t)) why = 'its credit is used up';
  else if (/\b401\b|\b403\b|unauthori[sz]ed|invalid.{0,20}key|api key|forbidden/i.test(t)) why = 'its key was refused';
  else if (/permission|not allowed|denied|microphone|audio device/i.test(t)) why = 'a permission is missing';
  else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|offline/i.test(t)) why = 'it could not be reached';
  else if (/ENOENT|not installed|not found|no such file/i.test(t)) why = 'it is not installed';
  else if (/timed? ?out|timeout/i.test(t)) why = 'it took too long';
  else why = `of an error (${clean(t, 80) || 'unknown'})`;
  return `${name} did not work because ${why}, so I answered in text${/system/i.test(name) ? '' : ' or with the system voice'}. See Settings > Voice.`;
}

module.exports = { explainBrainFailure, explainVoiceFailure, brainName };
