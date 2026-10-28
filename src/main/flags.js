// Experimental features: each is off until you turn it on in Settings > Experimental. Some need a permission first, and the switch says why when it cannot be turned on.

const FLAGS = {
  memoryV2: { label: 'Smarter memory', desc: 'Learns from your corrections and offers things it noticed about you for approval. Nothing is used until you approve it.', needs: [], ready: false },
  toolCategories: { label: 'Fewer tools per request', desc: 'Shows the model only the tool groups a request needs. Faster; it can ask for more tools if it guessed wrong.', needs: [], ready: false },
  queue: { label: 'Queue while the Mac sleeps', desc: 'Requests sent while the Mac is asleep wait and run when it wakes. A later message can cancel an earlier one.', needs: [], ready: false },
  imessage: { label: 'Command Relay by text', desc: 'Text yourself to run things. Only your own message thread, after a one-time pairing code. Needs Full Disk Access.', needs: ['fulldisk'], ready: false },
  plugins: { label: 'Plugins', desc: 'Add abilities from a folder or a GitHub link. Each plugin shows what it wants to do and waits for your approval.', needs: [], ready: false },
  panels: { label: 'Live panels', desc: 'Small floating panels with live numbers: CPU, battery, a running job.', needs: [], ready: false },
  folderQa: { label: 'Ask my notes', desc: 'Answers questions from folders you choose, searched on this Mac.', needs: [], ready: false },
  proactive: { label: 'Speak up on its own', desc: 'Tells you when something important happens, quietly by default.', needs: [], ready: false },
  offline: { label: 'Offline mode', desc: 'With no internet, answers simple things with a local model if you have Ollama.', needs: [], ready: false }
};

// ready: false means the feature is not built yet, so it is not offered in Settings.
const isOn = (settings, name) => !!FLAGS[name] && settings?.flags?.[name] === true;

// Can this switch be turned on now? `perms` is a map of permission name -> true/false.
function canEnable(name, perms = {}) {
  const f = FLAGS[name];
  if (!f) return { ok: false, why: 'Unknown setting.' };
  const missing = f.needs.filter((n) => !perms[n]);
  if (missing.length) return { ok: false, why: `Needs ${missing.map((n) => ({ fulldisk: 'Full Disk Access' }[n] || n)).join(' and ')} first.` };
  return { ok: true, why: '' };
}

const offered = () => Object.fromEntries(Object.entries(FLAGS).filter(([, f]) => f.ready));

module.exports = { FLAGS, offered, isOn, canEnable };
