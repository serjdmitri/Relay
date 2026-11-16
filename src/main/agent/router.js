// Picks which Claude model answers a request. Short, single-step requests go to the fast model (Haiku).
// Anything that looks like writing, planning or several steps goes straight to the stronger one (Sonnet).
// A request that starts on Haiku can still move up to Sonnet while it runs (see claudeCli.runSmart).

const { normalize } = require('../commands');

const COMPLEX = /\b(summar\w*|draft|write|compose|rewrite|translate|explain|plan|compare|analy[sz]e|research|organi[sz]e|clean up|sort|every|each|all (?:of )?(?:my|the|these|those)|schedule|reschedule|book|e-?mail|reply|respond|negotiate|brainstorm|essay|report|spreadsheet|figure out|find out|debug|fix|refactor|then|after that|afterwards|step by step|multiple|several|compile|generate|decide|recommend|best way|pros and cons)\b/g;

function complexity(text) {
  const n = normalize(text);
  if (!n) return 0;
  const words = n.split(' ').length;
  let score = words / 7;
  const hits = n.match(COMPLEX) || [];
  if (hits.length) score += 2 + Math.min(1, hits.length - 1);
  score += (n.match(/ and /g) || []).length * 0.7;
  score += (String(text).match(/,/g) || []).length * 0.3;
  return score;
}

const SIMPLE_BELOW = 2.6;
const MODELS = ['haiku', 'sonnet', 'opus'];

// setting: auto | haiku | sonnet | opus. Returns the model to start on and whether it may move up.
function routeModel(text, setting = 'auto') {
  if (MODELS.includes(setting)) return { model: setting, escalate: false };
  const simple = complexity(text) < SIMPLE_BELOW;
  return { model: simple ? 'haiku' : 'sonnet', escalate: simple };
}

// The same idea for Codex, which has no "Haiku": the size of the step is how much it reasons before it acts. Simple requests run on low effort and may move up to high if they fail;
// harder ones start on medium; the hardest start on high. setting: the Claude choice (auto | haiku | sonnet | opus) maps onto it so one switch governs both.
const EFFORT_FOR = { haiku: 'low', sonnet: 'medium', opus: 'high' };
const HARD_ABOVE = 6;
function routeCodex(text, setting = 'auto') {
  if (EFFORT_FOR[setting]) return { effort: EFFORT_FOR[setting], escalate: false };
  const c = complexity(text);
  if (c < SIMPLE_BELOW) return { effort: 'low', escalate: true };
  return { effort: c >= HARD_ABOVE ? 'high' : 'medium', escalate: false };
}

module.exports = { routeModel, routeCodex, complexity, SIMPLE_BELOW, HARD_ABOVE };
