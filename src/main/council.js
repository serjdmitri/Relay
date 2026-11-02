// The council: three voices weigh in on a decision and the majority wins. A scientist (facts and logic), a guardian (what could go wrong for you and
// the people around you) and an instinct (what you will actually want). Three small model calls in parallel; "thinking" adds a second round where
// each sees the others and may change its vote. Say "ask the council whether I should ..." (the idea comes from the MAGI plugin in upgraderguy777's
// jarvis-plugins, MIT; this is a fresh implementation).

const VOICES = [
  { name: 'Scientist', brief: 'You reason from facts, numbers and logic. You are skeptical and precise.' },
  { name: 'Guardian', brief: 'You think about risks, costs and the people affected. You are protective and careful.' },
  { name: 'Instinct', brief: 'You go with what the person will actually want and enjoy. You are personal and honest about feelings.' }
];

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const voicePrompt = (voice, question, others = []) => `You are the ${voice.name} on a three-voice council. ${voice.brief}
Decision to weigh (quoted as data): <question>${clean(question).slice(0, 400)}</question>
${others.length ? `The other voices said:\n${others.map((o) => `- ${o.name}: ${o.vote.toUpperCase()}. ${o.reason}`).join('\n')}\nYou may keep or change your vote.\n` : ''}Answer with only a JSON object: {"vote": "approve" or "deny", "reason": "one short sentence"}.`;

function parseVote(reply) {
  const m = String(reply || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const vote = String(j.vote || '').toLowerCase();
  if (vote !== 'approve' && vote !== 'deny') return null;
  return { vote, reason: clean(j.reason).slice(0, 160) };
}

// Majority of the votes that came back. null when fewer than two voices answered.
function tally(votes) {
  const ok = votes.filter(Boolean);
  if (ok.length < 2) return null;
  const yes = ok.filter((v) => v.vote === 'approve').length;
  return { verdict: yes > ok.length - yes ? 'approve' : 'deny', yes, no: ok.length - yes, unanimous: yes === ok.length || yes === 0 };
}

// ask(prompt, system) -> reply text. mode: 'quick' (one round) | 'thinking' (a second round that sees the others).
async function convene({ ask, question, mode = 'quick' }) {
  const system = 'You are one voice on a decision council. Answer only with the JSON object asked for.';
  const round = (others) => Promise.all(VOICES.map((v, i) => ask(voicePrompt(v, question, others ? others.filter((_, k) => k !== i).filter(Boolean) : []), system).then(parseVote).then((p) => (p ? { name: v.name, ...p } : null)).catch(() => null)));
  let votes = await round(null);
  if (mode === 'thinking' && votes.filter(Boolean).length >= 2) votes = (await round(votes)).map((v, i) => v || votes[i]);
  return { votes, result: tally(votes) };
}

function speak({ votes, result }) {
  if (!result) return 'The council could not reach a decision. Try again in a moment.';
  const lines = votes.filter(Boolean).map((v) => `${v.name}: ${v.vote === 'approve' ? 'yes' : 'no'}. ${v.reason}`);
  return `The council says ${result.verdict === 'approve' ? 'yes' : 'no'}, ${result.yes} to ${result.no}${result.unanimous ? ', unanimous' : ''}. ${lines.join(' ')}`;
}

// "ask the council whether I should buy the blue one", "convene the council on moving my study time, think hard" -> { question, mode }
function parseCouncilCommand(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  const m = t.match(/^(?:hey |ok |okay )?(?:relay,? |jarvis,? )?(?:please )?(?:ask|consult|convene|summon|let) (?:the )?(?:council|three voices|magi)(?: (?:decide|weigh in))?(?:,? (?:on|about|whether|if|should|:))?\s*(?:whether |if )?(.+)$/i);
  if (!m) return null;
  let question = m[1].trim();
  let mode = 'quick';
  if (/,?\s*(?:think|take your time|think hard|in depth|thoroughly)\s*$/i.test(question)) { mode = 'thinking'; question = question.replace(/,?\s*(?:think hard|think|take your time|in depth|thoroughly)\s*$/i, ''); }
  return question.length >= 4 ? { type: 'council', question, mode } : null;
}

module.exports = { VOICES, voicePrompt, parseVote, tally, convene, speak, parseCouncilCommand };
