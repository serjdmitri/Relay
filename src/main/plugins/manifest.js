// A plugin is a folder with a plugin.json. This reads and checks it, and says in plain words what the plugin asks to do, so the person can
// decide before it is installed. Nothing here runs the plugin.
//
//   { "name": "weather-panel", "version": "1.0.0", "description": "...",
//     "command": ["node", "index.js"],                      // run inside the plugin folder, speaks MCP over stdio
//     "tools": [{ "name": "forecast", "description": "...", "input_schema": { "type": "object", "properties": {} } }],
//     "permissions": { "network": ["api.weather.gov"], "files": [{ "path": "~/Documents/Notes", "mode": "read" }], "shell": false, "acts": false, "screen": false },
//     "panels": [{ "id": "now", "title": "Now", "tool": "forecast", "everySeconds": 60 }] }

const crypto = require('crypto');

const NAME = /^[a-z][a-z0-9-]{1,38}$/;
const TOOL = /^[a-z][a-z0-9_]{0,38}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const MAX_TOOLS = 20;

// Returns { ok, manifest, errors }. The manifest is rebuilt from known fields only, so nothing unexpected passes through.
function parseManifest(raw) {
  const errors = [];
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return { ok: false, errors: ['plugin.json is not valid JSON.'] }; }
  if (!j || typeof j !== 'object') return { ok: false, errors: ['plugin.json is empty.'] };
  const name = String(j.name || '');
  if (!NAME.test(name)) errors.push('name must be lowercase letters, numbers and dashes (2 to 39 characters), starting with a letter.');
  const version = String(j.version || '').slice(0, 20);
  if (!/^\d+\.\d+\.\d+/.test(version)) errors.push('version must look like 1.0.0.');
  const command = Array.isArray(j.command) ? j.command.map(String) : [];
  if (!command.length || command.some((c) => !c || c.length > 200)) errors.push('command must be a list like ["node", "index.js"].');
  if (command[0] && /[\\/]/.test(command[0]) && !/^(?:\/usr\/bin\/|\/bin\/|\/opt\/homebrew\/bin\/|\/usr\/local\/bin\/)/.test(command[0])) errors.push('command may only start with a program, or a path in /usr/bin, /bin or Homebrew.');
  if (command.some((c) => c.includes('..'))) errors.push('command may not contain "..".');
  const tools = (Array.isArray(j.tools) ? j.tools : []).slice(0, MAX_TOOLS).map((t) => ({ name: String(t?.name || ''), description: String(t?.description || '').slice(0, 400), input_schema: t?.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} } }));
  if (!tools.length) errors.push('the plugin must declare at least one tool.');
  for (const t of tools) if (!TOOL.test(t.name)) errors.push(`tool name "${t.name}" must be lowercase letters, numbers and underscores.`);
  if (new Set(tools.map((t) => t.name)).size !== tools.length) errors.push('tool names must be different from each other.');
  const p = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
  const network = (Array.isArray(p.network) ? p.network : []).map(String);
  for (const h of network) if (!HOST.test(h)) errors.push(`"${h}" is not a host name (like api.example.com).`);
  const files = (Array.isArray(p.files) ? p.files : []).map((f) => ({ path: String(f?.path || ''), mode: f?.mode === 'write' ? 'write' : 'read' }));
  for (const f of files) if (!/^(?:~\/|\/)/.test(f.path) || f.path.includes('..') || f.path === '/' || f.path === '~/') errors.push(`file permission "${f.path}" must be a folder inside your home folder or another specific path.`);
  const permissions = { network, files, shell: p.shell === true, acts: p.acts === true, screen: p.screen === true };
  const panels = (Array.isArray(j.panels) ? j.panels : []).slice(0, 4).map((x) => ({ id: String(x?.id || ''), title: String(x?.title || '').slice(0, 40), tool: String(x?.tool || ''), everySeconds: Math.max(1, Math.min(3600, Number(x?.everySeconds) || 5)) }));
  for (const x of panels) if (!TOOL.test(x.id) || !tools.some((t) => t.name === x.tool)) errors.push(`panel "${x.id}" must name one of the plugin's tools.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], manifest: { name, version, description: String(j.description || '').slice(0, 300), command, tools, permissions, panels } };
}

// What the permissions mean, one line each, riskiest first. `warn` marks the ones to think about.
function describePermissions(m) {
  const p = m.permissions;
  const lines = [];
  if (p.shell) lines.push({ warn: true, text: 'Can run commands on your Mac.' });
  if (p.shell && p.network.length) lines.push({ warn: true, text: 'Can run commands AND reach the internet: it could send things from your Mac out.' });
  if (p.acts) lines.push({ warn: true, text: 'Declares that it can change things (send, create, delete). Relay asks before calling its tools.' });
  if (p.screen) lines.push({ warn: true, text: 'Can read what is on your screen.' });
  for (const f of p.files) lines.push({ warn: f.mode === 'write', text: `${f.mode === 'write' ? 'Can read and change' : 'Can read'} files in ${f.path}.` });
  if (p.network.length) lines.push({ warn: true, text: `Requests network access for ${p.network.join(', ')}. The sandbox cannot limit access to those hosts; it can reach other network addresses too.` });
  if (!lines.length) lines.push({ warn: false, text: 'Declares no special permissions. The sandbox is best effort and does not restrict every system resource.' });
  return lines;
}

// A fingerprint of what the person approved: the manifest. A different one means the plugin asks for something new.
const manifestHash = (m) => crypto.createHash('sha256').update(JSON.stringify({ c: m.command, t: m.tools.map((t) => [t.name, t.input_schema]), p: m.permissions, n: m.panels })).digest('hex').slice(0, 16);

// What changed between an approved manifest and a new one, for the update screen.
function diffManifests(a, b) {
  const out = [];
  const tn = (m) => new Set(m.tools.map((t) => t.name));
  for (const t of tn(b)) if (!tn(a).has(t)) out.push(`New tool: ${t}`);
  for (const t of tn(a)) if (!tn(b).has(t)) out.push(`Removed tool: ${t}`);
  const la = new Set(describePermissions(a).map((l) => l.text)); const lb = describePermissions(b);
  for (const l of lb) if (!la.has(l.text)) out.push(`New permission: ${l.text}`);
  if (JSON.stringify(a.command) !== JSON.stringify(b.command)) out.push(`Start command changed: ${b.command.join(' ')}`);
  return out;
}

module.exports = { parseManifest, describePermissions, manifestHash, diffManifests, validPluginName: (name) => typeof name === 'string' && NAME.test(name) };
