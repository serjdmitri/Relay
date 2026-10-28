// The small, pure parts of "ask my notes": which files to read, how to cut text into passages, and how to rank passages for a question.

const path = require('path');

const TEXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.html', '.htm', '.log', '.rtf', '.tex', '.py', '.js', '.ts', '.c', '.cpp', '.h', '.java', '.swift', '.ino', '.xml']);
const CONVERT = new Set(['.docx', '.doc', '.odt', '.rtf']); // read by macOS's textutil
const SECRET_NAME = /(?:^|[._-])(?:env|secret|secrets|password|passwords|credentials?|token|tokens|apikey|api[-_]key|private|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keychain|kdbx|ovpn)$/i;
const SKIP_DIR = new Set(['node_modules', '.git', '.svn', 'Library', '.Trash', '__pycache__', 'venv', '.venv', 'build', 'dist']);

const kindOf = (file) => { const e = path.extname(file).toLowerCase(); return e === '.pdf' ? 'pdf' : CONVERT.has(e) && e !== '.rtf' ? 'convert' : TEXT.has(e) ? 'text' : null; };
const skipFile = (name) => name.startsWith('.') || SECRET_NAME.test(name) || !kindOf(name);
const skipDir = (name) => name.startsWith('.') || SKIP_DIR.has(name);

// Passages of about `size` characters, cut at paragraph or sentence ends, each remembering where it started in the file.
function chunkText(text, { size = 800, min = 40 } = {}) {
  const t = String(text || '').replace(/\r/g, '');
  const out = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + size);
    if (end < t.length) {
      const cut = Math.max(t.lastIndexOf('\n\n', end), t.lastIndexOf('. ', end), t.lastIndexOf('\n', end));
      if (cut > start + size * 0.5) end = cut + 1;
    }
    const piece = t.slice(start, end).replace(/\s+/g, ' ').trim();
    if (piece.length >= min) out.push({ text: piece, offset: start });
    start = end;
  }
  return out;
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'what', 'when', 'where', 'who', 'how', 'did', 'does', 'was', 'were', 'are', 'you', 'your', 'about', 'from', 'into', 'have', 'has', 'had', 'tell', 'find', 'notes', 'say', 'said', 'any']);
const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const words = (s) => (String(s).toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w)).map(stem);

// How many of the question's words a passage contains (0 to 1).
function keywordScore(query, text) {
  const q = [...new Set(words(query))];
  if (!q.length) return 0;
  const t = new Set(words(text));
  return q.filter((w) => t.has(w)).length / q.length;
}

function cosine(a, b, ao = 0, bo = 0, n = a.length) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { const x = a[ao + i]; const y = b[bo + i]; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Best passages for a question. With vectors a passage counts if it is close in meaning (cosine at least cosMin) or shares enough of the
// question's words; without vectors, words only. Nothing passing means no hits, so the answer can be "I did not find that in your notes"
// instead of a guess. cosMin is a starting guess for Apple's embeddings that has not been tuned on real notes.
function rank(query, chunks, { qvec = null, vectors = null, dim = 0, k = 5, cosMin = 0.55, wordMin = 0.34 } = {}) {
  const meaning = !!(qvec && qvec.length && vectors && dim);
  const scored = chunks.map((c, i) => {
    const kw = keywordScore(query, c.text);
    const cos = meaning ? Math.max(0, cosine(qvec, vectors, 0, i * dim, dim)) : 0;
    return { ...c, score: meaning ? 0.75 * cos + 0.25 * kw : kw, pass: cos >= cosMin || kw >= wordMin };
  }).filter((c) => c.pass).sort((a, b) => b.score - a.score);
  // at most two passages from one file, so one long file does not crowd out the rest
  const per = new Map(); const out = [];
  for (const { pass, ...c } of scored) { const n = per.get(c.file) || 0; if (n >= 2) continue; per.set(c.file, n + 1); out.push(c); if (out.length >= k) break; }
  return { hits: out, mode: meaning ? 'meaning' : 'words' };
}

module.exports = { kindOf, skipFile, skipDir, chunkText, keywordScore, cosine, rank, words };
