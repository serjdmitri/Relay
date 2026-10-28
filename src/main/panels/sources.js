// What a live panel can show: small read-only numbers about this Mac. The parsers are pure (text in, numbers out); the Sampler runs the real
// commands through injected functions, so the whole thing can be tested without a Mac.

const SOURCES = {
  cpu: { label: 'CPU use' },
  memory: { label: 'Memory use' },
  battery: { label: 'Battery' },
  network: { label: 'Network speed' },
  disk: { label: 'Disk space' },
  jobs: { label: 'What Relay is working on' }
};

// os.cpus() twice: how busy the processors were between the two readings, 0 to 100.
function cpuUsage(prev, cur) {
  const sum = (list) => list.reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
  const a = sum(prev); const b = sum(cur);
  const total = b.total - a.total;
  return total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - (b.idle - a.idle) / total)))) : 0;
}

// `pmset -g batt`
function parseBattery(out) {
  const t = String(out || '');
  const m = t.match(/(\d{1,3})%;\s*([\w ]+?);/);
  if (!m) return { present: false };
  return { present: true, percent: Number(m[1]), charging: /charging|charged|finishing charge/i.test(m[2]) && !/discharging/i.test(m[2]), onBattery: /Battery Power/i.test(t) };
}

// `netstat -ib`: total bytes in and out over the real interfaces (the loopback and bridge rows are left out).
function parseNetstat(out) {
  let inB = 0; let outB = 0;
  const seen = new Set();
  for (const line of String(out || '').split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 10 || !/^<Link#/.test(c[2]) || /^(?:lo|bridge|awdl|llw|utun|gif|stf|ap)\d*$/.test(c[0]) || seen.has(c[0])) continue;
    seen.add(c[0]);
    inB += Number(c[c.length - 5]) || 0; // Ibytes
    outB += Number(c[c.length - 2]) || 0; // Obytes
  }
  return { inB, outB };
}

// `df -k /`
function parseDf(out) {
  const line = String(out || '').trim().split('\n').pop().trim().split(/\s+/);
  const total = Number(line[1]); const avail = Number(line[3]);
  if (!total) return { present: false };
  return { present: true, usedPct: Math.round(100 * (1 - avail / total)), freeGb: Math.round((avail / 1048576) * 10) / 10 };
}

// Bytes per second between two network readings.
const speed = (a, b, ms) => (ms > 0 && a && b ? { downKBs: Math.max(0, Math.round((b.inB - a.inB) / (ms / 1000) / 1024)), upKBs: Math.max(0, Math.round((b.outB - a.outB) / (ms / 1000) / 1024)) } : { downKBs: 0, upKBs: 0 });

class Sampler {
  // os: { cpus(), totalmem(), freemem() }; exec(file, args) -> text; jobs() -> [{ text, status }]
  constructor({ os, exec, jobs = () => [], now = Date.now }) {
    Object.assign(this, { os, exec, jobs, now });
    this.lastCpu = null;
    this.lastNet = null;
  }

  async sample(source) {
    switch (source) {
      case 'cpu': { const cur = this.os.cpus(); const v = this.lastCpu ? cpuUsage(this.lastCpu, cur) : 0; this.lastCpu = cur; return { percent: v }; }
      case 'memory': { const t = this.os.totalmem(); const f = this.os.freemem(); return { percent: Math.round(100 * (1 - f / t)), usedGb: Math.round(((t - f) / 1073741824) * 10) / 10, totalGb: Math.round((t / 1073741824) * 10) / 10 }; }
      case 'battery': return parseBattery(await this.exec('/usr/bin/pmset', ['-g', 'batt']).catch(() => ''));
      case 'network': { const cur = { ...parseNetstat(await this.exec('/usr/sbin/netstat', ['-ib']).catch(() => '')), at: this.now() }; const out = speed(this.lastNet, cur, this.lastNet ? cur.at - this.lastNet.at : 0); this.lastNet = cur; return out; }
      case 'disk': return parseDf(await this.exec('/bin/df', ['-k', '/']).catch(() => ''));
      case 'jobs': return { jobs: this.jobs().slice(0, 6).map((j) => ({ text: String(j.text).slice(0, 80), status: j.status })) };
      default: return null;
    }
  }
}

module.exports = { SOURCES, cpuUsage, parseBattery, parseNetstat, parseDf, speed, Sampler };
