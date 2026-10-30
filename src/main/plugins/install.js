// Getting a plugin onto the Mac: from a GitHub link or a folder. The commit is pinned (a link always becomes an exact commit), the folder is
// checked (no links out of it, a sane size), and nothing is installed until the person has seen what it asks for and approved.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { parseManifest } = require('./manifest');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 500;

// "https://github.com/o/r", "github.com/o/r/tree/main", "o/r", "o/r@ref", or a folder path.
function parseSource(input) {
  const t = String(input || '').trim();
  if (!t) return null;
  if (/^(?:~\/|\/)/.test(t)) return { local: t };
  let m = t.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+))?\/?$/i);
  if (!m) m = t.match(/^([\w.-]+)\/([\w.-]+?)(?:@([\w./-]+))?$/);
  return m ? { owner: m[1], repo: m[2], ref: m[3] || '' } : null;
}

// Lists what is in a folder and refuses anything that could reach outside it (links) or is too big.
function scanDir(dir) {
  const files = [];
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') throw new Error('The plugin contains a Git metadata directory.');
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) throw new Error(`The plugin contains a link (${path.relative(dir, p)}), which could point outside its folder.`);
      if (e.isDirectory()) walk(p);
      else { if (!e.isFile()) throw new Error('The plugin contains a special file.'); const size = fs.statSync(p).size; total += size; files.push({ path: path.relative(dir, p), size }); if (files.length > MAX_FILES || total > MAX_BYTES) throw new Error('The plugin is too big (over 500 files or 20 MB).'); }
    }
  };
  walk(dir);
  return { files, total };
}

// Fingerprint the complete inspected copy, including names, sizes and file contents.
function fingerprint(dir, files) {
  const hashes = files.map((f) => [f.path, f.size, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f.path))).digest('hex')]);
  hashes.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}

function inspectDir(dir) {
  const mf = path.join(dir, 'plugin.json');
  if (!fs.existsSync(mf)) throw new Error('There is no plugin.json in it.');
  const parsed = parseManifest(fs.readFileSync(mf, 'utf8'));
  if (!parsed.ok) throw new Error(`plugin.json has problems: ${parsed.errors.join(' ')}`);
  const scan = scanDir(dir);
  const entry = parsed.manifest.command.find((c, i) => i > 0 && !c.startsWith('-'));
  if (entry && !/^(?:\/|\w+:)/.test(entry) && !fs.existsSync(path.join(dir, entry))) throw new Error(`The start file ${entry} is not in the plugin.`);
  return { manifest: parsed.manifest, ...scan };
}

const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 60000, maxBuffer: 1e7 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).slice(0, 200))) : resolve(out))));

// A GitHub repository at an exact commit, unpacked into `into` (an empty folder). Returns the commit.
async function fetchGithub({ owner, repo, ref }, into, { fetchFn = fetch, extract = (file, to) => run('/usr/bin/tar', ['-xzf', file, '-C', to, '--strip-components=1']) } = {}) {
  const api = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref || 'HEAD')}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Relay' }, signal: AbortSignal.timeout(15000) });
  if (!api.ok) throw new Error(`GitHub did not find ${owner}/${repo}${ref ? ` at ${ref}` : ''} (${api.status}).`);
  const sha = String((await api.json()).sha || '');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub did not give a commit.');
  const res = await fetchFn(`https://codeload.github.com/${owner}/${repo}/tar.gz/${sha}`, { headers: { 'user-agent': 'Relay' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Could not download the plugin (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('The plugin is too big (over 20 MB).');
  const tarball = path.join(into, '..', `plugin-${sha.slice(0, 8)}.tgz`);
  fs.writeFileSync(tarball, buf);
  try { await extract(tarball, into); } finally { fs.rmSync(tarball, { force: true }); }
  return sha;
}

module.exports = { parseSource, scanDir, inspectDir, fingerprint, fetchGithub, MAX_BYTES };
