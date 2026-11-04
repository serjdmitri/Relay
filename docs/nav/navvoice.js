// What you can say to the phone map page, turned into an action. Pure, so it is tested without a microphone. The page listens with the phone's own speech recognition when you tap the
// microphone button, and hands the words here; a typed command works the same way.
// -> { type, ... } or null.
//   go { place, mode, then }   take me to / walk to / drive to / navigate to / directions to ...; "X and then Y" gives place X and then [Y]; "Y with a stop at X" gives place X and then [Y]
//   addstop { place }    add a stop on the way: "add a stop at Starbucks", "stop at the bank first"
//   continue             after arriving at a stop: carry on to the next one
//   sethome { name }     "this is home", "save this as work"
//   mode { mode }        walking | driving
//   start | stop | mute | unmute | repeat | next | eta | zoom-in | zoom-out | overview | recenter | apple

// Place words that mean a saved place: "home", "my home", "back home" -> "home"; "work", "the office" -> "work".
function normPlace(text) {
  const t = String(text || '').trim().replace(/^(?:to |back to |over to |by )/i, '').replace(/[.!?,]+$/g, '').trim();
  if (/^(?:my |the )?(?:home|house)$|^back home$|^home$/i.test(t)) return 'home';
  if (/^(?:my |the )?(?:work|office|workplace)$/i.test(t)) return 'work';
  return t;
}
// "Starbucks and then home" -> ["Starbucks", "home"]; "home with a stop at Starbucks" -> ["Starbucks", "home"]. At most four places.
function placesIn(text) {
  const t = String(text || '').trim();
  const withStop = /^(.+?)\s+(?:with|and|but)\s+(?:a |one )?stops?\s+(?:at|in|by)\s+(.+)$/i.exec(t);
  const parts = withStop ? [withStop[2], withStop[1]] : t.split(/\s*,?\s+(?:and then|and after that|after that|then|followed by|and finally|and later)\s+/i);
  return parts.map(normPlace).filter(Boolean).slice(0, 4);
}
const goResult = (text, mode) => { const [place, ...then] = placesIn(text); return { type: 'go', place, mode, then }; };

export function parseCommand(raw) {
  const t = String(raw || '').trim().replace(/[“”"]/g, '').replace(/[.!?,]+$/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/\s+/g, ' ');
  const n = t.toLowerCase();
  if (!n) return null;

  // a destination: "take me to X", "walk me to X", "drive to X", "navigate to X", "directions to X", "how do I get to X"
  let m = /^(?:take me to|bring me to|get me to|navigate to|directions to|route to|go to|let'?s go to|how do i get to|how (?:can|do) i get to|i (?:want|need) to go to|find (?:me )?(?:the )?(?:way|route) to)\s+(.{1,200})$/i.exec(t);
  if (m) return goResult(m[1], 'driving');
  m = /^(walk(?:ing)?(?: me)?(?: to)?|drive(?: me)?(?: to)?)\s+(.{1,200})$/i.exec(t);
  if (m && /\bto\b|^walk|^drive/i.test(m[1])) return goResult(m[2].replace(/^to\s+/i, ''), /^walk/i.test(m[1]) ? 'walking' : 'driving');

  m = /^(?:take me|bring me|get me|drive me|walk me|drive|walk|go|head)\s+home\b\s*(.*)$/i.exec(t);
  if (m) return goResult(('home ' + m[1]).trim(), /^walk/i.test(t) ? 'walking' : 'driving');
  m = /^(?:(?:save|set|make|remember|mark) (?:this|here|this place|my (?:current )?location|where i am|where we are)(?: as)?(?: my)? (home|work)|(?:this is|here is)(?: my)? (home|work)|(?:my )?(home|work) is (?:here|this place|where i am)|set (?:my )?(home|work) (?:here|to here|to this location|to my location))$/i.exec(t);
  if (m) return { type: 'sethome', name: (m[1] || m[2] || m[3] || m[4]).toLowerCase() };
  m = /^(?:(?:add|include|make)(?: a)? stop (?:at|in|for|by) (.+)|(?:add|include) (.+?) (?:as|for) (?:a|my) stop|(?:also |first )?(?:stop|swing|pop|drop|go) (?:at|by|in at) (.+?)(?: (?:on the way|first|along the way|too))?)$/i.exec(t);
  if (m && !/^(?:stop|end|cancel)$/i.test(t)) return { type: 'addstop', place: normPlace(m[1] || m[2] || m[3]) };
  if (/^(?:continue|keep going|next stop|go on|carry on|continue (?:the )?(?:trip|route|navigation|journey)|head to the next stop|i(?:'m| am) ready|ready to go|let'?s continue)$/.test(n)) return { type: 'continue' };

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
  sethome: (name) => `Saved this spot as ${name}, Sir.`,
  nohome: (name) => `I do not know where ${name} is yet, Sir. Say “this is ${name}” when you are there.`,
  nostop: 'There is no stop waiting, Sir.',
  none: 'I did not catch a map command, Sir. Try "take me to" and a place, or "start".'
};
