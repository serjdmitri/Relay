// A local handoff for explicit memories, for the user to import into Sentient OS.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isSecret } = require('./memory');

function exportMemory(dir, fact, { now = new Date(), id = crypto.randomUUID() } = {}) {
  const text = String(fact || '').trim();
  if (!text || isSecret(text)) throw new Error('This memory cannot be exported.');
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id) || !Number.isFinite(now.getTime())) throw new Error('Invalid memory identifier.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `relay-memory-${now.toISOString().slice(0, 10)}-${id}.txt`);
  const body = `Relay memory for manual Sentient OS import\nCreated: ${now.toISOString()}\nSource: explicitly saved by the user in Relay\nStatus: user-stated; not independently verified\n\n${text}\n`;
  fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  return file;
}

function exportOutput(dir, title, text, { now = new Date(), id = crypto.randomUUID() } = {}) {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id) || !Number.isFinite(now.getTime()) || !String(text || '').trim() || isSecret(text)) throw new Error('This output cannot be saved.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `relay-output-${now.toISOString().slice(0, 10)}-${id}.txt`);
  fs.writeFileSync(file, `Relay local output: ${title}\nCreated: ${now.toISOString()}\n\n${text}\n`, { flag: 'wx', mode: 0o600 });
  return file;
}

module.exports = { exportMemory, exportOutput };
