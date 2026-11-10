// A simple food log, by voice: "log two eggs and toast", "I ate a chicken salad, 450 calories", "how many calories today", "what have I eaten today".
// OFF until you turn it on ("turn on nutrition tracking"); while it is off, nothing here listens for food phrases at all, so ordinary requests are never taken for food.
// If you say the calories, those are used; otherwise the model gives a rough estimate (it is an estimate, and said so). Kept on this Mac only.
//   settings.nutrition: { enabled };  store 'nutritionLog': [{ id, ts, text, kcal, protein }]

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

const NOT_FOOD = /\b(?:lights?|music|tv|alarm|call|calls|meeting|reminder|timer|note|task|event|appointment|email|message|idea|problem|day|time|fun|trouble|feeling|conversation|chat)\b/i;
const FOOD = /\b(?:eggs?|toast|salad|chicken|beef|pork|steak|fish|salmon|tuna|rice|pasta|noodles|pizza|burgers?|sandwich(?:es)?|wraps?|tacos?|burritos?|sushi|soup|coffee|tea|latte|milk|juice|smoothie|shake|water|soda|beer|wine|apples?|bananas?|oranges?|berries|fruit|veggies|vegetables|cereal|oatmeal|yogurt|bagels?|pancakes?|waffles?|bacon|sausage|beans|fries|chips|cake|cookies?|brownies?|donuts?|ice cream|chocolate|candy|bars?|protein|nuts|peanut|breakfast|lunch|dinner|snack|meal|bread|cheese|potato(?:es)?|curry|ramen|oats|avocado)\b/i;

// While off, only the switch-on phrase is understood.
function parseNutritionCommand(text, { enabled = false } = {}) {
  const n = clean(String(text || '').replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, ''));
  const l = n.toLowerCase();
  if (/^(?:turn on|enable|start) (?:my )?(?:the )?(?:nutrition|food|calorie|meal) (?:tracking|log|logging|tracker)$/.test(l)) return { type: 'nutrition-on' };
  if (!enabled) return null;
  if (/^(?:turn off|disable|stop) (?:my )?(?:the )?(?:nutrition|food|calorie|meal) (?:tracking|log|logging|tracker)$/.test(l)) return { type: 'nutrition-off' };
  if (/^(?:how many calories (?:have i (?:had|eaten)|did i (?:have|eat))(?: today)?|what(?:'s| is) my calorie (?:count|total)(?: today)?|calories (?:so far )?today)$/.test(l)) return { type: 'nutrition-total' };
  if (/^(?:what (?:have i|did i) (?:eaten|eat|had|have)(?: today)?|what(?:'s| is) in my food log|show my food log)$/.test(l)) return { type: 'nutrition-list' };
  if (/^(?:clear|reset|delete) (?:today'?s|my) (?:food|meal|nutrition) log$|^clear (?:my )?food log(?: for today)?$/.test(l)) return { type: 'nutrition-clear' };
  const explicit = /^(?:log|add|track|record) (?:my |a |an |the )?(?:(?:meal|food|snack|breakfast|lunch|dinner)[: ]+)?(.{3,160})$/i.exec(n);
  const ate = /^i (?:just )?(ate|drank|finished|had) (.{3,160})$/i.exec(n);
  const m = explicit ? { food: explicit[1], via: 'log' } : ate ? { food: ate[2], via: ate[1].toLowerCase() } : null;
  if (m) {
    const food = clean(m.food).replace(/^(?:for (?:breakfast|lunch|dinner)[, ]+)/i, '');
    const cal = /(\d{2,4})\s*(?:k?cal(?:ories)?)\b/i.exec(food);
    if (NOT_FOOD.test(food)) return null;
    if (m.via === 'had' && !cal && !FOOD.test(food)) return null; // "I had an idea", "I had a meeting": only food words count for "had"
    return { type: 'nutrition-log', food: clean(food.replace(/[,;]?\s*(?:about |around |roughly )?\d{2,4}\s*(?:k?cal(?:ories)?)\b/i, '')), kcal: cal ? Math.min(5000, +cal[1]) : null };
  }
  return null;
}

// provider.step({ system, messages, tools, signal }) -> { text }. -> { kcal, protein } (rough), or null.
async function estimate({ provider, food, signal }) {
  const res = await provider.step({ system: 'Estimate the calories and grams of protein of the food described, for one typical serving unless a quantity is given. Reply with only JSON like {"kcal":450,"protein":30}. If it is not food, reply {"kcal":0,"protein":0}.', messages: [{ role: 'user', content: [{ type: 'text', text: clean(food) }] }], tools: [], signal });
  const m = /\{[^{}]*\}/.exec(String(res && res.text || ''));
  if (!m) return null;
  try { const j = JSON.parse(m[0]); const kcal = Math.round(Number(j.kcal)), protein = Math.round(Number(j.protein) || 0); return Number.isFinite(kcal) && kcal > 0 && kcal <= 5000 ? { kcal, protein: Math.max(0, Math.min(400, protein)) } : null; } catch { return null; }
}

function todayEntries(log, now = Date.now()) { const d = dayOf(now); return (Array.isArray(log) ? log : []).filter((e) => dayOf(e.ts) === d); }
const totals = (entries) => ({ kcal: entries.reduce((n, e) => n + (e.kcal || 0), 0), protein: entries.reduce((n, e) => n + (e.protein || 0), 0) });

module.exports = { parseNutritionCommand, estimate, todayEntries, totals, dayOf };
