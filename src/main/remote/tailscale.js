// Tailscale makes the connection secure when you are away from home: your phone and Mac join a private network, and "tailscale serve"
// gives Relay Remote an https address on it (which the phone's microphone needs). All of this is optional; at home Wi-Fi works without it.

const fs = require('fs');
const { execFile } = require('child_process');

const CANDIDATES = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];

const findCli = (exists = fs.existsSync) => CANDIDATES.find((p) => exists(p)) || null;

// From `tailscale status --json`: { running, name, ips, https } where https is this Mac's address on your tailnet.
function parseStatus(json) {
  let j;
  try { j = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { running: false }; }
  const self = j?.Self || {};
  const dns = String(self.DNSName || '').replace(/\.$/, '');
  return { running: j?.BackendState === 'Running', name: dns.split('.')[0] || '', ips: self.TailscaleIPs || [], https: dns ? `https://${dns}` : '', certs: !!(j?.CertDomains || []).length };
}

const run = (cli, args, timeout = 15000) => new Promise((resolve) => execFile(cli, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })));

async function status({ find = findCli, exec = run } = {}) {
  const cli = find();
  if (!cli) return { installed: false };
  const r = await exec(cli, ['status', '--json']);
  return { installed: true, ...(r.ok ? parseStatus(r.out) : { running: false, error: r.err.slice(0, 200) }) };
}

// Publishes the port on the tailnet over https (kept across restarts, `--bg`).
async function serve(port, { find = findCli, exec = run } = {}) {
  const cli = find();
  if (!cli) return { ok: false, error: 'Tailscale is not installed.' };
  const r = await exec(cli, ['serve', '--bg', String(port)], 30000);
  return r.ok ? { ok: true } : { ok: false, error: r.err.slice(0, 300) || 'Tailscale did not accept that.' };
}

async function unserve({ find = findCli, exec = run } = {}) {
  const cli = find();
  if (cli) await exec(cli, ['serve', 'reset']);
}

module.exports = { status, serve, unserve, parseStatus, findCli };
