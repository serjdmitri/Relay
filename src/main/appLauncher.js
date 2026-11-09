// Starts Ollama's server by itself when it is closed, so the local model works without you opening anything. Relay runs "ollama serve" in the background (no window, no Dock icon, no menu-bar icon);
// only if that command is not installed does it open the Ollama app hidden. Everything is injected (get, exec, spawnDetached, sleep), so it is tested without launching anything.
// One start at a time: concurrent callers share the same attempt. (Calendar and Reminders do not need this: relay-cal reads them directly.)

const OLLAMA_URL = 'http://127.0.0.1:11434';

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

let ollamaStart = null;
// Make sure the Ollama server answers on this Mac. get(url) -> parsed JSON (rejects when nothing listens). -> true when it answers.
async function ensureOllama({ get, exec, fileExists, spawnDetached, url = OLLAMA_URL, sleep = sleepReal, tries = 40, gap = 500 } = {}) {
  const up = async () => { try { await get(url.replace(/\/+$/, '') + '/api/tags'); return true; } catch { return false; } };
  if (await up()) return true;
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):11434\/?$/.test(url)) return false; // only the standard address on this Mac is ever started by Relay
  if (!ollamaStart) {
    ollamaStart = (async () => {
      const bin = ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'].find((p) => fileExists?.(p));
      if (bin) { try { spawnDetached(bin, ['serve']); } catch { return false; } }
      else if (fileExists?.('/Applications/Ollama.app')) { try { await exec('/usr/bin/open', ['-g', '-j', '-a', 'Ollama']); } catch { return false; } }
      else return false;
      for (let i = 0; i < tries; i++) { if (await up()) return true; await sleep(gap); }
      return false;
    })().finally(() => { ollamaStart = null; });
  }
  return ollamaStart;
}

module.exports = { ensureOllama, OLLAMA_URL };
