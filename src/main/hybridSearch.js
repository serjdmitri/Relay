// Hybrid local search over what Relay knows (idea from OpenJarvis's hybrid retrieval): your remembered facts, your session notes and your Obsidian notes.
// KEYWORD search (BM25: rare words count more, short matching notes beat long ones, titles count extra) always works. MEANING search (finding "car trouble" when a note
// says "my vehicle broke down") is added when a local embedding model is available through Ollama on this Mac; the two rankings are then fused (reciprocal rank fusion).
// Nothing leaves the Mac: the embedding model runs locally, and the saved index is a private file next to Relay's data. Pure logic, with the embedder passed in.

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'from', 'into', 'about', 'what', 'was', 'were', 'are', 'is', 'my', 'me', 'have', 'has', 'had', 'did', 'does', 'how', 'when', 'where', 'which', 'who', 'whom', 'any', 'all', 'can', 'could', 'would', 'should', 'there', 'their', 'them', 'then', 'than', 'but', 'not', 'our', 'out', 'say', 'said', 'tell', 'find', 'search', 'notes', 'note']);
const WORD = /[\p{L}\p{N}]{2,}/gu;
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (s) => (String(s || '').toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w)).map(stem);
const hash = (s) => { let h = 5381; const t = String(s); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x) * Math.sqrt(y) || 1);
}

// A short passage around the best-matching part of the text.
function snippet(text, qTokens, len = 150) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= len) return t;
  const low = t.toLowerCase(); let at = -1;
  for (const q of qTokens) { const i = low.indexOf(q); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, (at < 0 ? 0 : at) - 40);
  return `${start > 0 ? '…' : ''}${t.slice(start, start + len).trim()}${start + len < t.length ? '…' : ''}`;
}

class HybridIndex {
  constructor() { this.docs = []; this.vectors = new Map(); this.changed = false; }

  // docs: [{ id, source, title, text, ts }]. Saved vectors are kept for notes whose text did not change.
  set(docs) {
    this.docs = docs.map((d) => ({ ...d, title: String(d.title || ''), text: String(d.text || ''), h: hash(`${d.title}\n${d.text}`) }));
    const live = new Map(this.docs.map((d) => [d.id, d.h]));
    for (const [id, v] of this.vectors) if (live.get(id) !== v.h) { this.vectors.delete(id); this.changed = true; }
  }

  bm25(query, k = 10) {
    const q = [...new Set(tokens(query))]; if (!q.length || !this.docs.length) return [];
    const tf = this.docs.map((d) => { const m = new Map(); for (const w of tokens(d.title)) m.set(w, (m.get(w) || 0) + 3); const body = tokens(d.text); for (const w of body) m.set(w, (m.get(w) || 0) + 1); return { m, len: body.length + 1 }; });
    const avg = tf.reduce((s, x) => s + x.len, 0) / tf.length || 1, N = this.docs.length;
    const df = new Map(); for (const w of q) df.set(w, tf.reduce((n, x) => n + (x.m.has(w) ? 1 : 0), 0));
    const out = [];
    this.docs.forEach((d, i) => {
      let s = 0;
      for (const w of q) { const f = tf[i].m.get(w) || 0; if (!f) continue; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); s += idf * (f * 2.5) / (f + 1.5 * (0.25 + 0.75 * (tf[i].len / avg))); }
      if (s > 0) out.push({ doc: d, score: s });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  // Embeds notes that have no saved vector yet (at most `limit` per call, so a big vault fills in over a few searches). embed(text) -> [numbers].
  async embedMissing(embed, { limit = 60 } = {}) {
    let n = 0;
    for (const d of this.docs) {
      if (this.vectors.has(d.id)) continue;
      if (n >= limit) break;
      const v = await embed(`${d.title}\n${d.text}`.trim().slice(0, 1500));
      if (Array.isArray(v) && v.length && v.every(Number.isFinite)) { this.vectors.set(d.id, { h: d.h, v }); this.changed = true; }
      n++;
    }
    return { embedded: n, remaining: this.docs.filter((d) => !this.vectors.has(d.id)).length };
  }

  async meaning(query, embed, k = 10) {
    if (!embed || !this.vectors.size) return [];
    let qv; try { qv = await embed(String(query).slice(0, 500)); } catch { return []; }
    if (!Array.isArray(qv)) return [];
    const byId = new Map(this.docs.map((d) => [d.id, d]));
    const out = [];
    for (const [id, { v }] of this.vectors) { const d = byId.get(id); if (!d) continue; const s = cosine(qv, v); if (s >= 0.35) out.push({ doc: d, score: s }); }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  // -> [{ doc, snippet, via: ['keyword'?, 'meaning'?] }], best first. Reciprocal rank fusion of the two rankings.
  async search(query, { embed = null, k = 5 } = {}) {
    const kw = this.bm25(query, 12), mv = await this.meaning(query, embed, 12);
    const fused = new Map(); const add = (list, via) => list.forEach((r, i) => { const e = fused.get(r.doc.id) || { doc: r.doc, s: 0, via: [] }; e.s += 1 / (60 + i + 1); e.via.push(via); fused.set(r.doc.id, e); });
    add(kw, 'keyword'); add(mv, 'meaning');
    const q = [...new Set(tokens(query))];
    return [...fused.values()].sort((a, b) => b.s - a.s || (b.doc.ts || 0) - (a.doc.ts || 0)).slice(0, k).map((e) => ({ doc: e.doc, snippet: snippet(e.doc.text, q), via: e.via }));
  }

  export() { const vectors = {}; for (const [id, x] of this.vectors) vectors[id] = { h: x.h, v: x.v.map((n) => Math.round(n * 1e5) / 1e5) }; this.changed = false; return { version: 1, vectors }; }
  import(data) {
    if (!data || data.version !== 1 || typeof data.vectors !== 'object') return;
    for (const [id, x] of Object.entries(data.vectors)) if (x && typeof x.h === 'string' && Array.isArray(x.v) && x.v.every(Number.isFinite)) this.vectors.set(id, { h: x.h, v: x.v });
  }
}

// Ollama on this Mac (127.0.0.1 only). post(url, body) -> parsed JSON; get(url) -> parsed JSON.
const MODEL = 'nomic-embed-text';
async function ollamaStatus({ get }) {
  try { const t = await get('http://127.0.0.1:11434/api/tags'); const has = (t.models || []).some((m) => String(m.name || m.model).startsWith(MODEL)); return has ? { ok: true } : { ok: false, why: `Ollama is running but the ${MODEL} model is not installed. Install it with "ollama pull ${MODEL}" for meaning-based search.` }; }
  catch { return { ok: false, why: 'Ollama is not running, so this is keyword search only. Install Ollama and run "ollama pull nomic-embed-text" for meaning-based search.' }; }
}
const ollamaEmbedder = ({ post }) => async (text) => { const r = await post('http://127.0.0.1:11434/api/embeddings', { model: MODEL, prompt: text }); return r.embedding; };

// "search my notes for X", "what do my notes say about X", "find notes about X", "search my memory for X"
function parseSearchCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const m = /^(?:search|look through|look in|look up in|check) (?:all )?(?:of )?(?:my |the )?(?:notes|memory|memories|obsidian(?: notes| vault)?|session notes|everything (?:i|you) know)(?: for| about| on)\s+(.{2,200})$/i.exec(n)
    || /^(?:find|show me|get me)(?: me)?(?: any| all| the)?(?: of)? (?:my |the )?(?:notes|memories)(?: that mention| about| on| regarding)\s+(.{2,200})$/i.exec(n)
    || /^what do (?:my |the )?(?:notes|obsidian notes) say about\s+(.{2,200})$/i.exec(n);
  return m ? { type: 'search', query: m[1].trim() } : null;
}

module.exports = { HybridIndex, tokens, snippet, cosine, hash, ollamaStatus, ollamaEmbedder, parseSearchCommand, MODEL };
