// Requests about the last request: "undo that", "do it again".
const { normalize } = require('./commands');

const UNDO = /^(?:undo|undo (?:that|it|this)|undo the last (?:thing|action|request|one)|take (?:that|it) back|revert (?:that|it)|reverse (?:that|it)|put (?:that|it) back|cancel that|undo what you just did)$/;
const AGAIN = /^(?:again|do (?:it|that|this) again|repeat (?:that|it|this)|one more time|same again|same thing again|run (?:it|that) again)$/;
// "Try again": the same request once more, on a stronger model when there is one.
const RETRY = /^(?:try (?:it |that )?again(?: with (?:a |the )?(?:smarter|better|stronger|bigger|different|deeper) (?:model|one))?|try (?:it |that )?(?:again )?(?:harder|better)|think harder|that(?:s| is| was) (?:wrong|not right|not what i (?:asked|wanted)|bad)(?: try again)?|that did not work(?: try again)?|that didnt work(?: try again)?|use a smarter model(?: and (?:try|do) (?:it|that) again)?)$/;
const TIERS = [['haiku', /^(?:fast|faster|fastest|quick|quicker|haiku)$/], ['auto', /^(?:auto|automatic|balanced|normal|default)$/], ['sonnet', /^(?:smart|smarter|sonnet)$/], ['opus', /^(?:deep|deeper|deepest|best|smartest|opus|max)$/]];
const MODEL_CMD = /^(?:use|switch to|go to|set(?: it)? to|change to|turn on)(?: the)? (\w+)(?: model| mode| speed)?$/;

const isUndo = (text) => UNDO.test(normalize(text));
const isAgain = (text) => AGAIN.test(normalize(text));

const isRetry = (text) => RETRY.test(normalize(text));
// "Use the fast model" -> 'haiku', "smarter" -> 'sonnet', "deep" -> 'opus', "auto" -> 'auto'; null for anything else.
function parseModelCommand(text) {
  const m = normalize(text).match(MODEL_CMD);
  if (!m) return null;
  const hit = TIERS.find(([, re]) => re.test(m[1]));
  return hit ? hit[0] : null;
}

module.exports = { isUndo, isAgain, isRetry, parseModelCommand };
