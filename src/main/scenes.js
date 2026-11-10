// Scenes when you leave or come back: "when I leave, lock my Mac", "when I come back, read me my briefing". Whatever you say is run the way anything you say is run (a routine's name works
// too), so the usual confirmations still apply. It rides on the presence camera ("Pause music when I leave the desk" must be on, because that is what notices you leaving), and it is
// off until you set one. Only when Relay is idle and not in a meeting. Pure: this file only understands the words.
//   settings.scenes: { away, back }

const clean = (t) => String(t || '').replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();

const AWAY = '(?:leave(?: the desk| my desk| the room| my computer| the computer)?|walk away(?: from (?:the|my) (?:desk|computer))?|step away(?: from (?:the|my) (?:desk|computer))?|go away|am away|get up)';
const BACK = '(?:come back|am back|get back|return(?: to (?:the|my) (?:desk|computer))?|sit (?:back )?down|walk back in)';

const VERBS = 'lock|pause|play|open|turn|start|run|say|read|tell|send|mute|unmute|dim|switch|set|stop|close|shut|put|show|check|take|text|call|message|email|remind|brief|give|launch|resume|silence|save|log|sleep';

// -> { type: 'scene-set', which: 'away'|'back', command } | { type: 'scene-clear', which } | { type: 'scene-status' } | null
function parseSceneCommand(text) {
  const n = clean(text), l = n.toLowerCase();
  // after a comma (or "then") anything is a command; with neither, it has to start with an action word, so "when I leave the house play music" is not read as "the house play music"
  const one = (when) => { const m = new RegExp(`^(?:when|whenever|if) i ${when}(?:\\s*,\\s*(?:then )?|\\s+then\\s+)(.{3,200})$`, 'i').exec(n) || new RegExp(`^(?:when|whenever|if) i ${when}\\s+((?:${VERBS})\\b.{2,200})$`, 'i').exec(n); return m ? m[1].trim() : null; };
  let c = one(AWAY);
  if (c) return { type: 'scene-set', which: 'away', command: c };
  c = one(BACK);
  if (c) return { type: 'scene-set', which: 'back', command: c };
  if (/^(?:clear|remove|stop|cancel|forget)(?: the| my)? (?:leaving|away|leave) scene$|^stop doing (?:anything|things) when i leave$/.test(l)) return { type: 'scene-clear', which: 'away' };
  if (/^(?:clear|remove|stop|cancel|forget)(?: the| my)? (?:coming back|back|return|welcome back) scene$|^stop doing (?:anything|things) when i (?:come|get) back$/.test(l)) return { type: 'scene-clear', which: 'back' };
  if (/^(?:what happens when i (?:leave|come back|go away)|what(?:'s| are| is) my scenes?|list my scenes?)$/.test(l)) return { type: 'scene-status' };
  return null;
}

function describe(scenes) {
  const s = scenes || {};
  const parts = [s.away ? `when you leave I will: ${s.away}` : '', s.back ? `when you come back I will: ${s.back}` : ''].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : 'You have not set anything for leaving or coming back. Say, for example, "when I leave, lock my Mac".';
}

module.exports = { parseSceneCommand, describe };
