// Skill import: bring skills written in the open agentskills.io format (a SKILL.md with a short header and instructions in words, as used by Hermes, OpenClaw
// and many GitHub repositories) into Relay as "playbooks". Idea from OpenJarvis (Apache-2.0).
// Safety: only the SKILL.md TEXT is imported (never scripts that sit beside it); it is scanned for wording aimed at an AI and for secrets; and every imported
// playbook waits as "pending" until YOU approve it in Settings > Memory. Even then it is advice shown to the model, never code Relay runs, and the normal
// tools still ask as usual.

const shield = require('./injectionShield');
const { isSecret } = require('./memory');

const MAX_FILE = 24000; // bytes of SKILL.md read
const MAX_IMPORT = 8; // skills taken in one go
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Header (--- key: value ---) and body of a SKILL.md. Handles quoted values and the folded ">" / "|" forms.
function parseSkillMd(text) {
  const t = String(text || '').replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const m = /^---\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/.exec(t);
  if (!m) return null;
  const meta = {}; let key = null;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv && !/^\s/.test(line)) { key = kv[1].toLowerCase(); const v = kv[2].trim(); meta[key] = /^[>|][+-]?$/.test(v) ? '' : v.replace(/^(['"])(.*)\1$/, '$2'); }
    else if (key && /^\s+\S/.test(line)) meta[key] = `${meta[key]} ${line.trim()}`.trim();
  }
  const name = clean(meta.name, 60), description = clean(meta.description, 200);
  if (!name || !description) return null;
  return { name, description, license: clean(meta.license, 40), body: String(m[2] || '').trim() };
}

// Is it safe to keep? -> { ok, why, warnings }
function vet(skill) {
  const text = `${skill.description}\n${skill.body}`;
  const s = shield.scan(text);
  if (s.level === 'high') return { ok: false, why: `it contains wording aimed at an AI (${[...new Set(s.findings.filter((f) => f.level === 'high').map((f) => f.name))].join(', ')})` };
  if (shield.sensitive(text).length || isSecret(text)) return { ok: false, why: 'it seems to contain a key or a secret' };
  if (!skill.body || skill.body.length < 40) return { ok: false, why: 'it has no real instructions' };
  const warnings = s.findings.map((f) => f.name);
  if (/\b(?:scripts?\/|\.sh\b|\.py\b|npm\s+(?:i|install)|pip\s+install)\b/i.test(skill.body)) warnings.push('mentions scripts or installs, which Relay will not run for it');
  return { ok: true, warnings };
}

// "https://github.com/o/r", ".../tree/main/path", ".../blob/main/path/SKILL.md", "o/r", "o/r/path" -> { owner, repo, ref?, path }
function parseSource(text) {
  const t = String(text || '').trim().replace(/[)\].,;!?]+$/, '');
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^\/]+)(?:\/(.*))?)?\/?$/.exec(t);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] || undefined, path: (m[4] || '').replace(/\/$/, '') };
  m = /^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/.exec(t);
  if (m && !/^https?:/.test(t) && !/\s/.test(t)) return { owner: m[1], repo: m[2], path: m[3] || '' };
  return null;
}

// deps: { json(url) -> object }. Finds SKILL.md files for a source: -> { files: [{ path }], more, ref }
async function findSkillFiles(src, { json }) {
  const api = `https://api.github.com/repos/${src.owner}/${src.repo}`;
  const ref = src.ref || (await json(api)).default_branch || 'main';
  if (/SKILL\.md$/i.test(src.path)) return { files: [{ path: src.path }], more: 0, ref };
  const tree = await json(`${api}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const prefix = src.path ? `${src.path.replace(/\/$/, '')}/` : '';
  const all = (tree.tree || []).filter((n) => n.type === 'blob' && /(?:^|\/)SKILL\.md$/i.test(n.path) && n.path.startsWith(prefix) && (n.size || 0) <= MAX_FILE).map((n) => ({ path: n.path }));
  return { files: all.slice(0, MAX_IMPORT), more: Math.max(0, all.length - MAX_IMPORT), ref, truncated: !!tree.truncated };
}

// Imports into the skills list. Returns { list, results: [{ name, added, why }], summary }.
async function importFrom(sourceText, list, { json, text, addSkill, id = () => Math.random().toString(36).slice(2), now = Date.now }) {
  const src = parseSource(sourceText);
  if (!src) return { list, results: [], summary: 'Give me a GitHub link, for example github.com/owner/repo or a link to a folder with a SKILL.md in it.' };
  let found;
  try { found = await findSkillFiles(src, { json }); } catch (e) { return { list, results: [], summary: `I could not read that repository (${clean(e.message, 80)}).` }; }
  if (!found.files.length) return { list, results: [], summary: 'I found no SKILL.md there. Point me at a skill folder, for example github.com/owner/repo/tree/main/skills/name.' };
  const results = []; let cur = list;
  for (const f of found.files) {
    let raw;
    try { raw = await text(`https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(found.ref)}/${f.path.split('/').map(encodeURIComponent).join('/')}`); } catch { results.push({ name: f.path, added: false, why: 'it could not be downloaded' }); continue; }
    const sk = parseSkillMd(String(raw).slice(0, MAX_FILE));
    if (!sk) { results.push({ name: f.path, added: false, why: 'it is not a valid SKILL.md (it needs a name and a description in its header)' }); continue; }
    const v = vet(sk);
    if (!v.ok) { results.push({ name: sk.name, added: false, why: `refused: ${v.why}` }); continue; }
    const r = addSkill(cur, { name: sk.name, goal: sk.description, kind: 'playbook', code: sk.body, source: `github.com/${src.owner}/${src.repo}/${f.path}` }, { id: id(), now: now() });
    if (r.added) { cur = r.list; results.push({ name: sk.name, added: true, warnings: v.warnings }); } else results.push({ name: sk.name, added: false, why: r.why });
  }
  const added = results.filter((r) => r.added), skipped = results.filter((r) => !r.added);
  const parts = [];
  if (added.length) parts.push(`Imported ${added.length} playbook${added.length === 1 ? '' : 's'} (${added.map((r) => r.name).join(', ')}). They are waiting for your approval in Settings > Memory; nothing is used until you approve it.`);
  if (skipped.length) parts.push(`Skipped ${skipped.length}: ${skipped.slice(0, 4).map((r) => `${r.name} (${r.why})`).join('; ')}.`);
  if (found.more) parts.push(`There are ${found.more} more in that repository; point me at a folder to import specific ones.`);
  const warned = added.filter((r) => r.warnings?.length);
  if (warned.length) parts.push(`Note: ${warned.map((r) => `${r.name} ${r.warnings.join(', ').replace(/-/g, ' ')}`).join('; ')}.`);
  return { list: cur, results, summary: parts.join(' ') || 'Nothing was imported.' };
}

// "import skills from github.com/…", "import the arxiv skill from https://github.com/…", "add a skill from o/r"
function parseSkillImportCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ');
  const m = /^(?:import|add|install|get|load)\s+(?:(?:the|a|some|new|more)\s+)?(?:[\w .-]{0,40}?\s+)?(?:skills?|playbooks?)\s+(?:from|at|in|on)\s+(\S+)$/i.exec(n);
  if (!m) return null;
  return parseSource(m[1]) ? { type: 'import', source: m[1] } : null;
}

module.exports = { parseSkillMd, vet, parseSource, findSkillFiles, importFrom, parseSkillImportCommand, MAX_IMPORT };
