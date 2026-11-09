// Starts the helper apps Relay talks to, quietly and by itself, so you never have to open them first:
//   * Calendar and Reminders: Relay reads them with AppleScript, which is slow or fails while the app is closed. They are opened hidden ("open -g -j": no window, no focus steal) and waited for.
//   * Ollama: the local model needs its server. If nothing answers, Relay starts the Ollama app hidden, or runs "ollama serve" itself when the app is not installed, and waits for it.
// Everything is injected (exec, get, spawnDetached, sleep), so it is tested without launching anything. One start at a time: concurrent callers share the same attempt.

const OLLAMA_URL = 'http://127.0.0.1:11434';
const HELPERS = new Set(['Calendar', 'Reminders']);

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// Is a process with this exact name running? exec(cmd, args) -> stdout (rejects on non-zero exit, like execFile).
async function isRunning(exec, name) {
  try { return !!String(await exec('/usr/bin/pgrep', ['-x', name])).trim(); } catch { return false; }
}

// Open a Mac app hidden and wait until it is running. -> true when it is up.
async function ensureApp(name, { exec, sleep = sleepReal, tries = 40, gap = 500 } = {}) {
  if (!HELPERS.has(name)) return false;
  if (await isRunning(exec, name)) return true;
  try { await exec('/usr/bin/open', ['-g', '-j', '-a', name]); } catch { return false; }
  for (let i = 0; i < tries; i++) {
    if (await isRunning(exec, name)) { await sleep(1500); return true; } // a moment to finish starting, so the first command is not dropped
    await sleep(gap);
  }
  return false;
}

// Which helper apps does this AppleScript talk to?
const helpersIn = (script) => [...new Set([...String(Array.isArray(script) ? script.join('\n') : script).matchAll(/application "(Calendar|Reminders)"/g)].map((m) => m[1]))];

let ollamaStart = null;
// Make sure the Ollama server answers on this Mac. get(url) -> parsed JSON (rejects when nothing listens). -> true when it answers.
async function ensureOllama({ get, exec, fileExists, spawnDetached, url = OLLAMA_URL, sleep = sleepReal, tries = 40, gap = 500 } = {}) {
  const up = async () => { try { await get(url.replace(/\/+$/, '') + '/api/tags'); return true; } catch { return false; } };
  if (await up()) return true;
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):11434\/?$/.test(url)) return false; // only the standard address on this Mac is ever started by Relay
  if (!ollamaStart) {
    ollamaStart = (async () => {
      const app = '/Applications/Ollama.app';
      let started = false;
      if (fileExists?.(app)) { try { await exec('/usr/bin/open', ['-g', '-j', '-a', 'Ollama']); started = true; } catch { /* fall through to the command */ } }
      if (!started) {
        const bin = ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'].find((p) => fileExists?.(p));
        if (!bin) return false;
        try { spawnDetached(bin, ['serve']); } catch { return false; }
      }
      for (let i = 0; i < tries; i++) { if (await up()) return true; await sleep(gap); }
      return false;
    })().finally(() => { ollamaStart = null; });
  }
  return ollamaStart;
}

module.exports = { ensureApp, ensureOllama, helpersIn, isRunning, HELPERS, OLLAMA_URL };
