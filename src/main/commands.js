// Pre-LLM handling of spoken commands: routines and routine recording.
// Speech recognition adds capitalization and punctuation, so everything is normalized first.

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[“”"'.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey |ok |okay )?relay[, ]*/, '')
    .replace(/^please /, '')
    .replace(/ please$/, '')
    .trim();
}

function parseCommand(text, routines, state = {}) {
  const n = normalize(text);
  if (!n) return { type: 'empty' };

  if (n === 'start a routine' || n === 'start recording a routine' || n === 'record a routine') {
    return { type: 'routine-start' };
  }

  const save = n.match(/^(?:save|remember|learn|keep) (it|that|this) as (.+)$/);
  if (save) {
    return { type: 'routine-save', name: save[2].trim(), source: state.recording ? 'recording' : 'last' };
  }

  // "forget morning setup": only when that is one of the saved names, so other uses of "forget" are left alone.
  const forget = n.match(/^(?:forget|delete|remove) (?:the |my )?(?:routine |task )?(.+?)(?: routine| task)?$/);
  if (forget) {
    const r = routines.find((x) => normalize(x.name) === forget[1].trim());
    if (r) return { type: 'routine-delete', routine: r };
  }

  const inline = n.match(/^when i say (.+?),? (?:open|do|run|tell|check|show|turn|set|quit|play|start)\b(.*)$/);
  if (inline) {
    const rest = text.replace(/^.*?when i say [^,]+,?\s*/i, '').trim();
    return { type: 'routine-inline', name: inline[1].trim(), steps: splitSteps(rest) };
  }

  for (const r of routines) {
    const rn = normalize(r.name);
    if (n === rn || n === `run ${rn}` || n === `do ${rn}` || n === `start ${rn}`) {
      return { type: 'routine-run', routine: r };
    }
  }

  return { type: 'agent', text: text.trim() };
}

function splitSteps(s) {
  return s
    .split(/\s*(?:,? and then |, then | then |,? and (?=tell|check|open|show|set|play)|;)\s*/i)
    .map((x) => x.replace(/\.$/, '').trim())
    .filter(Boolean);
}

module.exports = { parseCommand, normalize, splitSteps };
