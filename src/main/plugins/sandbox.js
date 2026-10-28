// A macOS sandbox profile (sandbox-exec) that fits a plugin's declared permissions. This is best effort and not a hard security boundary:
// sandbox-exec is deprecated by Apple and cannot limit the internet to particular hosts (any declared host opens the network). The real control is
// the approval you give at install. Relay checks the profile starts before relying on it and says so when it does not.

const path = require('path');
const os = require('os');

const q = (s) => `"${String(s).replace(/["\\]/g, '')}"`;
const expand = (p, home) => (p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

function buildProfile(manifest, dir, { home = os.homedir(), tmp = os.tmpdir() } = {}) {
  const p = manifest.permissions;
  const lines = ['(version 1)', '(allow default)', '(deny network*)', `(deny file-write* (subpath ${q(home)}))`, `(deny file-read* (subpath ${q(path.join(home, 'Library/Keychains'))}) (subpath ${q(path.join(home, '.ssh'))}) (subpath ${q(path.join(home, 'Library/Messages'))}) (subpath ${q(path.join(home, 'Library/Application Support/Relay'))}))`];
  if (p.network.length) lines.push('(allow network*)');
  lines.push(`(allow file-write* (subpath ${q(dir)}) (subpath ${q(tmp)}))`);
  for (const f of p.files) if (f.mode === 'write') lines.push(`(allow file-write* (subpath ${q(expand(f.path, home))}))`);
  return lines.join('\n');
}

// The program and arguments to start: through sandbox-exec when it is available.
const wrap = (profile, command, available) => (available ? { file: '/usr/bin/sandbox-exec', args: ['-p', profile, ...command] } : { file: command[0], args: command.slice(1) });

module.exports = { buildProfile, wrap };
