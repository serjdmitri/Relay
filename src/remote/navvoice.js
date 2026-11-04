// What you can say to the phone map page, turned into an action. Pure, so it is tested without a microphone. The page listens with the phone's own speech recognition when you tap the
// microphone button, and hands the words here; a typed command works the same way.
// -> { type, ... } or null.
//   go { place, mode }   take me to / walk to / drive to / navigate to / directions to ...
//   mode { mode }        walking | driving
//   start | stop | mute | unmute | repeat | next | eta | zoom-in | zoom-out | overview | recenter | apple

export function parseCommand(raw) {
  const t = String(raw || '').trim().replace(/[“”"]/g, '').replace(/[.!?,]+$/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/\s+/g, ' ');
  const n = t.toLowerCase();
  if (!n) return null;

  // a destination: "take me to X", "walk me to X", "drive to X", "navigate to X", "directions to X", "how do I get to X"
  let m = /^(?:take me to|bring me to|get me to|navigate to|directions to|route to|go to|let'?s go to|how do i get to|how (?:can|do) i get to|i (?:want|need) to go to|find (?:me )?(?:the )?(?:way|route) to)\s+(.{1,200})$/i.exec(t);
  if (m) return { type: 'go', place: m[1].trim(), mode: 'driving' };
  m = /^(walk(?:ing)?(?: me)?(?: to)?|drive(?: me)?(?: to)?)\s+(.{1,200})$/i.exec(t);
  if (m && /\bto\b|^walk|^drive/i.test(m[1])) return { type: 'go', place: m[2].trim().replace(/^to\s+/i, ''), mode: /^walk/i.test(m[1]) ? 'walking' : 'driving' };

  if (/^(?:switch to |change to |use |go by |travel by )?(?:walking|on foot|walk)$/.test(n)) return { type: 'mode', mode: 'walking' };
  if (/^(?:switch to |change to |use |go by |travel by )?(?:driving|by car|drive|car)$/.test(n)) return { type: 'mode', mode: 'driving' };

  if (/^(?:start|begin|go|let'?s go|start (?:the )?(?:navigation|route|trip|directions)|begin (?:the )?(?:navigation|route|trip)|start (?:driving|walking)|navigate|lead the way|take me there)$/.test(n)) return { type: 'start' };
  if (/^(?:stop|end|cancel|exit|quit|finish)(?: the)?(?: navigation| route| directions| trip)?$|^(?:stop|end) (?:navigating|navigation)$|^i(?:'ve| have) arrived$/.test(n)) return { type: 'stop' };
  if (/^(?:mute|be quiet|quiet|silence|shut up|stop talking|voice off|turn (?:the )?voice off|no voice)$/.test(n)) return { type: 'mute' };
  if (/^(?:unmute|voice on|turn (?:the )?voice on|speak|talk to me|you can talk)$/.test(n)) return { type: 'unmute' };
  if (/^(?:repeat(?: that)?|say that again|say again|what did you say|come again|again)$/.test(n)) return { type: 'repeat' };
  if (/^(?:what'?s next|what is next|next turn|what'?s the next turn|what is the next turn|where (?:do i|should i|to) turn(?: next)?|which way|what now)$/.test(n)) return { type: 'next' };
  if (/^(?:how far|how long|how much (?:longer|further|farther)|when (?:do|will) i (?:get there|arrive)|what'?s my eta|eta|time remaining|how far (?:is it|am i)|how long (?:is it|will it take))(?: left)?$/.test(n)) return { type: 'eta' };
  if (/^zoom in$|^closer$|^bigger$/.test(n)) return { type: 'zoom-in' };
  if (/^zoom out$|^farther$|^further out$|^smaller$/.test(n)) return { type: 'zoom-out' };
  if (/^(?:overview|show (?:me )?(?:the )?(?:whole |full |entire )?(?:route|map|trip)|route overview)$/.test(n)) return { type: 'overview' };
  if (/^(?:recenter|re-center|center|follow me|where am i|show me where i am|my location)$/.test(n)) return { type: 'recenter' };
  if (/^(?:open|use|switch to|show (?:me )?in) apple maps$|^apple maps$/.test(n)) return { type: 'apple' };
  return null;
}

// Short confirmations, in Jarvis's voice, for each action (what is said back).
export const REPLIES = {
  stop: 'Navigation ended, Sir.', mute: 'Voice guidance is off.', unmute: 'Voice guidance is on, Sir.', 'zoom-in': '', 'zoom-out': '', overview: '', recenter: '', apple: 'Opening Apple Maps.',
  mode: (mode) => (mode === 'walking' ? 'Walking directions.' : 'Driving directions.'),
  none: 'I did not catch a map command, Sir. Try "take me to" and a place, or "start".'
};
