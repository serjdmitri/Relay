// Quick maths and unit conversions, answered on the spot with no model call: "what's 15 percent of 80", "twelve times seven",
// "convert 5 miles to kilometers", "72 fahrenheit in celsius", "20 percent tip on 64". Pure; the parser never uses eval.

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 };

// "twenty five" -> 25, "two hundred and six" -> 206. Returns { value, used } for the longest number-word run at the start of words, or null.
function wordsToNumber(words) {
  let total = 0, cur = 0, used = 0, seen = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'and' && seen && i + 1 < words.length && (w2n(words[i + 1]) !== null)) { used = i + 1; continue; }
    if (w in ONES) { cur += ONES[w]; seen = true; used = i + 1; }
    else if (w in TENS) { cur += TENS[w]; seen = true; used = i + 1; }
    else if (w === 'hundred' && seen) { cur = (cur || 1) * 100; used = i + 1; }
    else if (w in SCALE && seen) { total += (cur || 1) * SCALE[w]; cur = 0; used = i + 1; }
    else break;
  }
  return seen ? { value: total + cur, used } : null;
}
const w2n = (w) => (w in ONES ? ONES[w] : w in TENS ? TENS[w] : w in SCALE ? SCALE[w] : null);

const WORD_OPS = [
  [/\bto the power of\b|\braised to\b/g, ' ^ '], [/\bmultiplied by\b|\btimes\b/g, ' * '], [/\bdivided by\b|\bover\b/g, ' / '],
  [/\bplus\b|\band\b(?=\s*\d)/g, ' + '], [/\bminus\b|\btake away\b|\bless\b/g, ' - '], [/\bsquared\b/g, ' ^ 2 '], [/\bcubed\b/g, ' ^ 3 '],
  [/\bmod\b|\bmodulo\b|\bremainder\b/g, ' % ']
];

// Turns what was said into tokens a parser can read: numbers, operators, parentheses, and function names. Returns null if anything is not maths.
function tokenize(text) {
  let s = String(text).toLowerCase().replace(/,(?=\d{3}\b)/g, '').replace(/[?!]+$/g, '').replace(/\$/g, '').replace(/×|\bx\b(?=\s*\d)/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  s = s.replace(/(\d)\s*%\s*of\b/g, '$1 percent of').replace(/(\d)\s*%/g, '$1 percent');
  const words = s.replace(/[^a-z0-9.+\-*/^%()\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length;) {
    const nw = wordsToNumber(words.slice(i));
    if (nw) { out.push({ n: nw.value }); i += nw.used; continue; }
    out.push(words[i]); i++;
  }
  return out;
}

function expand(tokens) {
  // split glued symbols like "3*4" or "(2+3)" into separate tokens, join word operators
  let s = ` ${tokens.map((t) => (typeof t === 'object' ? t.n : t)).join(' ')} `;
  for (const [re, rep] of WORD_OPS) s = s.replace(re, rep);
  s = s.replace(/square root of/g, ' sqrt ').replace(/\bsquare root\b/g, ' sqrt ').replace(/\bcube root of\b/g, ' cbrt ').replace(/\bsqrt\b(?!\s*\()/g, ' sqrt ');
  s = s.replace(/([0-9.])([+\-*/^%()])/g, '$1 $2').replace(/([+\-*/^%()])([0-9.])/g, '$1 $2').replace(/([+\-*/^%()])([+\-*/^%()])/g, '$1 $2');
  return s.split(/\s+/).filter(Boolean);
}

// Recursive descent: + - then * / % then ^ then unary then atoms (numbers, parentheses, sqrt/cbrt/abs). "N percent of M" is handled before this.
function evaluate(parts) {
  let i = 0;
  const peek = () => parts[i];
  const fail = () => { throw new SyntaxError('not maths'); };
  const atom = () => {
    const t = parts[i++];
    if (t === undefined) fail();
    if (t === '(') { const v = sum(); if (parts[i++] !== ')') fail(); return v; }
    if (t === 'sqrt' || t === 'cbrt' || t === 'abs') { const v = unary(); return t === 'sqrt' ? Math.sqrt(v) : t === 'cbrt' ? Math.cbrt(v) : Math.abs(v); }
    if (/^\d*\.?\d+$/.test(t) || /^\d+\.?$/.test(t)) { let v = parseFloat(t); if (peek() === 'percent') { i++; v /= 100; } return v; }
    return fail();
  };
  const unary = () => { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); };
  const power = () => { const b = atom(); if (peek() === '^') { i++; return Math.pow(b, unary()); } return b; };
  const product = () => { let v = unary(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = parts[i++]; const r = unary(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; };
  const sum = () => { let v = product(); while (peek() === '+' || peek() === '-') { const op = parts[i++]; const r = product(); v = op === '+' ? v + r : v - r; } return v; };
  const v = sum();
  if (i !== parts.length) fail();
  return v;
}

// 3 decimals at most, no trailing zeros, thousands separators for big numbers, scientific only for the very large or small.
function fmt(v) {
  if (!Number.isFinite(v)) return null;
  if (v !== 0 && (Math.abs(v) >= 1e15 || Math.abs(v) < 1e-6)) return v.toExponential(4).replace(/\.?0+e/, 'e');
  const r = Math.abs(v) >= 1000 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000;
  return r.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 2 : 3 });
}

// ---- units ----
// factor: how many of the base unit one of these is (length in metres, mass in grams, volume in litres, time in seconds, bytes, m/s). Temperature is special.
const UNITS = {
  length: { base: 'm', list: { mm: [1e-3, 'millimeter|millimeters|millimetre|millimetres|mm'], cm: [1e-2, 'centimeter|centimeters|centimetre|centimetres|cm'], m: [1, 'meter|meters|metre|metres|m'], km: [1e3, 'kilometer|kilometers|kilometre|kilometres|km|kilometers per'], in: [0.0254, 'inch|inches|in|"'], ft: [0.3048, 'foot|feet|ft|\''], yd: [0.9144, 'yard|yards|yd|yds'], mi: [1609.344, 'mile|miles|mi'] } },
  mass: { base: 'g', list: { mg: [1e-3, 'milligram|milligrams|mg'], g: [1, 'gram|grams|g'], kg: [1e3, 'kilogram|kilograms|kilo|kilos|kg|kgs'], oz: [28.349523125, 'ounce|ounces|oz'], lb: [453.59237, 'pound|pounds|lb|lbs'], st: [6350.29318, 'stone|stones'], t: [1e6, 'tonne|tonnes|metric ton|metric tons'] } },
  volume: { base: 'l', list: { ml: [1e-3, 'milliliter|milliliters|millilitre|millilitres|ml'], l: [1, 'liter|liters|litre|litres|l'], tsp: [0.00492892, 'teaspoon|teaspoons|tsp'], tbsp: [0.0147868, 'tablespoon|tablespoons|tbsp'], floz: [0.0295735, 'fluid ounce|fluid ounces|fl oz|floz'], cup: [0.236588, 'cup|cups'], pt: [0.473176, 'pint|pints'], qt: [0.946353, 'quart|quarts'], gal: [3.785411784, 'gallon|gallons|gal'] } },
  time: { base: 's', list: { s: [1, 'second|seconds|sec|secs'], min: [60, 'minute|minutes|min|mins'], h: [3600, 'hour|hours|hr|hrs'], d: [86400, 'day|days'], wk: [604800, 'week|weeks'] } },
  data: { base: 'B', list: { B: [1, 'byte|bytes'], KB: [1e3, 'kilobyte|kilobytes|kb'], MB: [1e6, 'megabyte|megabytes|mb'], GB: [1e9, 'gigabyte|gigabytes|gb|gig|gigs'], TB: [1e12, 'terabyte|terabytes|tb'] } },
  speed: { base: 'm/s', list: { 'm/s': [1, 'meters per second|metres per second|m/s'], kph: [1 / 3.6, 'kilometers per hour|kilometres per hour|kph|km/h|kmh'], mph: [0.44704, 'miles per hour|mph'], kn: [0.514444, 'knots|knot'] } },
  area: { base: 'm2', list: { cm2: [1e-4, 'square centimeters|square centimetres|sq cm'], m2: [1, 'square meters|square metres|sq m'], km2: [1e6, 'square kilometers|square kilometres|sq km'], ft2: [0.09290304, 'square feet|square foot|sq ft'], ac: [4046.8564224, 'acre|acres'], ha: [1e4, 'hectare|hectares'] } }
};
const NAMES = { mm: 'millimeters', cm: 'centimeters', m: 'meters', km: 'kilometers', in: 'inches', ft: 'feet', yd: 'yards', mi: 'miles', mg: 'milligrams', g: 'grams', kg: 'kilograms', oz: 'ounces', lb: 'pounds', st: 'stone', t: 'tonnes', ml: 'milliliters', l: 'liters', tsp: 'teaspoons', tbsp: 'tablespoons', floz: 'fluid ounces', cup: 'cups', pt: 'pints', qt: 'quarts', gal: 'gallons', s: 'seconds', min: 'minutes', h: 'hours', d: 'days', wk: 'weeks', B: 'bytes', KB: 'kilobytes', MB: 'megabytes', GB: 'gigabytes', TB: 'terabytes', 'm/s': 'meters per second', kph: 'kilometers per hour', mph: 'miles per hour', kn: 'knots', cm2: 'square centimeters', m2: 'square meters', km2: 'square kilometers', ft2: 'square feet', ac: 'acres', ha: 'hectares', C: 'degrees Celsius', F: 'degrees Fahrenheit', K: 'kelvin' };
const SINGULAR = { in: 'inch', ft: 'foot', st: 'stone', C: 'degree Celsius', F: 'degree Fahrenheit', K: 'kelvin', kn: 'knot', 'm/s': 'meter per second', kph: 'kilometer per hour', mph: 'mile per hour', floz: 'fluid ounce', ft2: 'square foot' };
const TEMPS = { C: 'celsius|centigrade|degrees celsius|degrees c|c', F: 'fahrenheit|degrees fahrenheit|degrees f|f', K: 'kelvin|kelvins|k' };

const lookup = new Map();
for (const [kind, { list }] of Object.entries(UNITS)) for (const [key, [factor, names]] of Object.entries(list)) for (const n of names.split('|')) lookup.set(n.trim(), { kind, key, factor });
for (const [key, names] of Object.entries(TEMPS)) for (const n of names.split('|')) lookup.set(n, { kind: 'temp', key });
const unitFor = (s) => lookup.get(String(s).trim().toLowerCase().replace(/^degrees? /, (m) => (lookup.has(String(s).trim().toLowerCase()) ? m : '')));

const toC = (v, u) => (u === 'C' ? v : u === 'F' ? ((v - 32) * 5) / 9 : v - 273.15);
const fromC = (c, u) => (u === 'C' ? c : u === 'F' ? (c * 9) / 5 + 32 : c + 273.15);

function convert(value, from, to) {
  if (from.kind !== to.kind) return null;
  if (from.kind === 'temp') return fromC(toC(value, from.key), to.key);
  return (value * from.factor) / to.factor;
}

// The unit alternation, longest names first so "fluid ounces" wins over "ounces".
const UNIT_RE = [...lookup.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\/"']/g, '\\$&')).join('|');

function numberText(s) {
  const t = tokenize(s);
  if (t.length === 1 && typeof t[0] === 'object') return t[0].n;
  if (t.length === 1 && /^\d*\.?\d+$/.test(t[0])) return parseFloat(t[0]);
  return null;
}

// Returns { reply } or null when the text is not a maths or conversion question.
function calc(text) {
  const raw = String(text || '').trim().replace(/^(?:hey |ok |okay )?relay[, ]*/i, '').replace(/^please /i, '').replace(/ please$/i, '').replace(/[.]+$/, '');
  if (!raw || raw.split(/\s+/).length > 24) return null;
  const q = raw.toLowerCase().replace(/^(?:what(?:'s| is| are)|whats|how much is|how many is|calculate|compute|work out|figure out|tell me|solve|give me)\s+/, '').replace(/^(?:the )?(?:answer to|result of)\s+/, '').replace(/^the (?=square root|cube root)/, '').replace(/(\d)\s*%(?=\s|$)/g, '$1 percent').trim();

  // tip: "20 percent tip on 64", "tip on 45 at 18 percent", "what's an 18% tip on 52.50"
  let m = q.match(/^(?:an? )?(\d+(?:\.\d+)?|[a-z ]+?)\s*(?:percent|%)\s+tip\s+(?:on|for)\s+\$?(\d+(?:\.\d+)?)$/) || q.match(/^(?:the )?tip\s+(?:on|for)\s+\$?(\d+(?:\.\d+)?)\s+(?:at|with)\s+(\d+(?:\.\d+)?)\s*(?:percent|%)$/);
  if (m) {
    const [p, bill] = /tip\s+(?:on|for)/.test(q) && /^(?:the )?tip/.test(q) ? [parseFloat(m[2]), parseFloat(m[1])] : [numberText(m[1]), parseFloat(m[2])];
    if (p !== null && Number.isFinite(p) && Number.isFinite(bill)) {
      const tip = (bill * p) / 100;
      return { reply: `Tip at ${fmt(p)}% on $${fmt(bill)} is $${tip.toFixed(2)}, so $${(bill + tip).toFixed(2)} in all.`, kind: 'tip' };
    }
  }

  // conversions: "convert 5 miles to km", "5 miles in km", "how many feet in 2 meters", "72 f to c"
  const U = UNIT_RE;
  let value = null, a = null, b = null;
  const tries = [
    [new RegExp(`^(?:convert\\s+)?(.+?)\\s*(${U})\\s+(?:to|in|into|as)\\s+(${U})$`), (r) => [numberText(r[1]), r[2], r[3]]],
    [new RegExp(`^how many\\s+(${U})\\s+(?:are |is )?(?:there )?(?:in|are in)\\s+(.+?)\\s*(${U})$`), (r) => [numberText(r[2]), r[3], r[1]]],
    [new RegExp(`^how many\\s+(${U})\\s+(?:in|is)\\s+(?:an? |one )(${U})$`), (r) => [1, r[2], r[1]]],
    [new RegExp(`^(?:an? |one )(${U})\\s+(?:to|in|into|is how many)\\s+(${U})$`), (r) => [1, r[1], r[2]]]
  ];
  for (const [re, pick] of tries) {
    const r = q.match(re);
    if (!r) continue;
    const [v, x, y] = pick(r);
    if (v !== null) { value = v; a = x; b = y; break; }
  }
  if (value !== null && a && b) {
    const from = lookup.get(a.trim()), to = lookup.get(b.trim());
    if (from && to) {
      const out = convert(value, from, to);
      if (out === null) return { reply: `${NAMES[from.key]} and ${NAMES[to.key]} measure different things, so I can't convert one to the other.`, kind: 'convert' };
      const unit = (k, v) => (v === 1 ? SINGULAR[k] || NAMES[k].replace(/s$/, '') : NAMES[k]);
      return { reply: `${fmt(value)} ${unit(from.key, value)} is ${fmt(out)} ${unit(to.key, out)}.`, kind: 'convert' };
    }
  }

  // "15 percent of 80", "what percent of 80 is 20", "20 is what percent of 80"
  if ((m = q.match(/^(.+?)\s+percent\s+of\s+(.+)$/))) {
    const p = numberText(m[1]), of = numberText(m[2]);
    if (p !== null && of !== null) return { reply: `${fmt(p)}% of ${fmt(of)} is ${fmt((p * of) / 100)}.`, kind: 'percent' };
  }
  if ((m = q.match(/^(?:what percent of|what percentage of)\s+(.+?)\s+is\s+(.+)$/)) || (m = q.match(/^(.+?)\s+is\s+what\s+(?:percent|percentage)\s+of\s+(.+)$/))) {
    const [x, y] = /^what/.test(q) ? [numberText(m[2]), numberText(m[1])] : [numberText(m[1]), numberText(m[2])];
    if (x !== null && y !== null && y !== 0) return { reply: `${fmt(x)} is ${fmt((x / y) * 100)}% of ${fmt(y)}.`, kind: 'percent' };
  }

  // plain arithmetic: needs a digit or number word, and at least one operator/function; everything said must be maths
  const hasMath = /[+\-*/^%×÷]|\b(?:plus|minus|times|multiplied|divided|over|squared|cubed|power|root|mod|percent)\b/.test(q);
  if (!hasMath || !/\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/.test(q)) return null;
  // a lone date, phone number or version ("3-4-2026", "1.2.3") is not a sum
  if (/\d+\s*-\s*\d+\s*-\s*\d+|\d+\.\d+\.\d+/.test(q) && !/[+*/^]|\b(?:plus|times|divided|over)\b/.test(q)) return null;
  try {
    const parts = expand(tokenize(q));
    if (!parts.length) return null;
    // a trailing "= ?" or "equals" is dropped
    while (parts.length && (parts[parts.length - 1] === '=' || parts[parts.length - 1] === 'equals')) parts.pop();
    const v = evaluate(parts);
    const out = fmt(v);
    if (out === null) return { reply: 'That does not come out as a number (it divides by zero).', kind: 'math' };
    return { reply: out, kind: 'math', value: v };
  } catch {
    return null;
  }
}

module.exports = { calc, fmt, convert, wordsToNumber, tokenize, UNITS };
