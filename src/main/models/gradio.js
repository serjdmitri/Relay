// A small client for a Hugging Face Space made with Gradio 4 or 5 (its queue protocol): upload a file, run a named function, wait for its
// answer, download the file it made. Only what Relay needs for image-to-3D. Nothing about you is sent, only the (public) photo; an
// optional Hugging Face token (yours, from Settings) is sent as a header so the Space counts the use on your free quota.

const { UA } = require('../cards/lookup');

class GradioError extends Error {
  constructor(message, raw = '') { super(message); this.raw = raw; }
}

// Why a call failed, in words a person can use.
function friendly(msg) {
  const m = String(msg || '');
  if (/quota|zerogpu|exceeded|too many|rate|unauthorized.*gpu|gpu.*(limit|abort)/i.test(m)) return 'The free 3D service has hit its daily limit. Try again later, or add a free Hugging Face token in Settings for more.';
  if (/queue|busy|full|sleeping|starting|building/i.test(m)) return 'The free 3D service is busy right now. Try again in a minute.';
  return 'The free 3D service could not make that one.';
}

class GradioSpace {
  constructor({ host, fetchImpl = fetch, token = '' }) {
    this.host = host.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.token = token;
    this.cfg = null;
  }

  headers(extra = {}) {
    return { 'user-agent': UA, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  async config() {
    if (this.cfg) return this.cfg;
    const res = await this.fetch(`${this.host}/config`, { headers: this.headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new GradioError(friendly(`HTTP ${res.status}`));
    const c = await res.json();
    this.cfg = { prefix: c.api_prefix || '', deps: c.dependencies || [], comps: new Map((c.components || []).map((x) => [x.id, x.type])) };
    return this.cfg;
  }

  // The function behind a named endpoint: its id, and which of its inputs are hidden state (they are sent as null).
  async fn(apiName) {
    const c = await this.config();
    const dep = c.deps.find((d) => d.api_name === apiName);
    if (!dep) throw new GradioError('The 3D service changed and no longer has what Relay needs.');
    return { id: dep.id, inputs: dep.inputs.map((i) => c.comps.get(i)) };
  }

  async upload(bytes, type, name = 'photo') {
    const c = await this.config();
    const form = new FormData();
    form.append('files', new Blob([bytes], { type }), `${name}.${(type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`);
    const res = await this.fetch(`${this.host}${c.prefix}/upload`, { method: 'POST', body: form, headers: this.headers(), signal: AbortSignal.timeout(40000) });
    if (!res.ok) throw new GradioError(friendly(`HTTP ${res.status}`));
    const paths = await res.json();
    if (!paths?.[0]) throw new GradioError(friendly(''));
    return { path: paths[0], url: `${this.host}${c.prefix}/file=${paths[0]}`, orig_name: `${name}`, mime_type: type, meta: { _type: 'gradio.FileData' } };
  }

  // Runs a named function. params are its visible inputs in order; hidden state inputs are filled in. Returns the data it answered with.
  async run(apiName, params, { session, timeoutMs = 240000 } = {}) {
    const c = await this.config();
    const f = await this.fn(apiName);
    let k = 0;
    const data = f.inputs.map((t) => (t === 'state' ? null : params[k++]));
    const join = await this.fetch(`${this.host}${c.prefix}/queue/join`, { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ data, event_data: null, fn_index: f.id, trigger_id: null, session_hash: session }), signal: AbortSignal.timeout(30000) });
    if (!join.ok) { const raw = `HTTP ${join.status} ${(await join.text().catch(() => '')).slice(0, 300)}`; throw new GradioError(friendly(raw), raw); }
    const { event_id: id } = await join.json();
    const res = await this.fetch(`${this.host}${c.prefix}/queue/data?session_hash=${session}`, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new GradioError(friendly(`HTTP ${res.status}`));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new GradioError('The free 3D service stopped answering.');
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = chunk.match(/^data: (.*)$/m);
          if (!m) continue;
          let ev;
          try { ev = JSON.parse(m[1]); } catch { continue; }
          if (ev.event_id && id && ev.event_id !== id) continue;
          if (ev.msg === 'process_completed') {
            if (!ev.success) { const raw = JSON.stringify(ev.output || ev).slice(0, 400); throw new GradioError(friendly(raw), raw); }
            return ev.output?.data || [];
          }
          if (ev.msg === 'queue_full') throw new GradioError(friendly('queue full'));
        }
      }
    } finally {
      try { reader.cancel(); } catch { /* done */ }
    }
  }

  // A file the Space made: its bytes, always fetched from this Space's own address (by the file's path), never from a link the answer names.
  async download(file, { max = 60 * 1024 * 1024 } = {}) {
    const f = file && typeof file === 'object' ? (file.value ?? file) : file;
    const prefix = (await this.config()).prefix;
    const path = typeof f === 'string' ? (/^https?:/.test(f) ? '' : f) : f?.path || '';
    let url = path ? `${this.host}${prefix}/file=${path}` : '';
    if (!url) { const u = typeof f === 'string' ? f : f?.url || ''; url = u.startsWith(`${this.host}/`) ? u : ''; }
    if (!url) throw new GradioError(friendly(''));
    const res = await this.fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new GradioError(friendly(`HTTP ${res.status}`));
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > max) throw new GradioError(friendly(''));
    return bytes;
  }
}

module.exports = { GradioSpace, GradioError, friendly };
