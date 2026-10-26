// Learning your words from the corrections you make after dictating. Pure functions.
//
// Relay types what you said, then (a few seconds later) looks at the same text in the field. A word it got wrong and you
// fixed ("cooper nettie's" -> "Kubernetes") is a correction; seen twice, it becomes a word fix like the ones in Vocabulary.

const norm = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const words = (t) => String(t).split(/\s+/).filter(Boolean);
const clean = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// The part of `after` that is the text we typed, found by the words at its two ends (the middle may have been edited).
// Returns the words of that part, or null when either end cannot be found.
function locate(typedWords, afterWords) {
  const n = typedWords.length;
  if (n < 2) return null;
  const t = typedWords.map(norm);
  const a = afterWords.map(norm);
  const find = (seq, from = 0) => {
    outer: for (let i = from; i + seq.length <= a.length; i++) {
      for (let k = 0; k < seq.length; k++) if (a[i + k] !== seq[k]) continue outer;
      return i;
    }
    return -1;
  };
  const heads = n >= 4 ? [2, 1] : [1];
  const tails = n >= 4 ? [2, 1] : [1];
  for (const h of heads) {
    const start = find(t.slice(0, h));
    if (start < 0) continue;
    for (const tl of tails) {
      const tailSeq = t.slice(n - tl);
      const e = find(tailSeq, start + h);
      if (e >= 0) return afterWords.slice(start, e + tl);
    }
  }
  return null;
}

// Word-level alignment (longest common subsequence), then the places where a few words were swapped for a few others.
function corrections(typed, after) {
  const tw = words(typed);
  const seg = locate(tw, words(after));
  if (!seg) return [];
  const a = tw.map(norm);
  const b = seg.map(norm);
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > 3) return []; // a rewrite, not a fix
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  if (L[0][0] / Math.max(n, m) < 0.75) return []; // most of it changed: a rewrite, not a fix
  const out = [];
  const caseFixes = [];
  let i = 0;
  let j = 0;
  let fromRun = [];
  let toRun = [];
  const flush = () => {
    if (fromRun.length || toRun.length) out.push({ from: fromRun, to: toRun });
    fromRun = [];
    toRun = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      const from = clean(tw[i]);
      const to = clean(seg[j]);
      // Same word, different capitals: only a name or brand spelled its own way counts (GitHub, iPhone, NASA), not a capital at the start of a sentence.
      if (from !== to && /\p{Lu}/u.test(to.slice(1)) && !/\p{Lu}/u.test(from.slice(1))) caseFixes.push({ from, to });
      i++; j++;
    }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { toRun.push(seg[j]); j++; }
    else { fromRun.push(tw[i]); i++; }
  }
  flush();
  const found = [];
  for (const h of out) {
    if (!h.from.length || !h.to.length) continue; // a word added or removed is editing, not correcting
    if (h.from.length > 3 || h.to.length > 3) continue;
    const from = h.from.map(clean).join(' ');
    const to = h.to.map(clean).join(' ');
    if (!from || !to || from === to) continue;
    if (from.length < 2 || /^\d+$/.test(from) || /^\d+$/.test(to)) continue;
    found.push({ from, to });
  }
  found.push(...caseFixes);
  return found.length > 3 ? [] : found; // many changes at once is a rewrite
}

// Counts a correction; returns the rule to add once it has been seen `need` times. `counts` is mutated: { "from>to": n }.
function noteCorrection(counts, { from, to }, need = 2) {
  const key = `${from.toLowerCase()}>${to}`;
  counts[key] = (counts[key] || 0) + 1;
  if (counts[key] < need) return null;
  delete counts[key];
  return { from: from.toLowerCase(), to };
}

module.exports = { corrections, noteCorrection, locate };
