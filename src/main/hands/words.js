// What you say to open, hide or stop the hand view: "hands", "show my hands", "hide hands", "stop hand control". Nothing else counts.
// 'show' turns hand control on if needed and puts the camera view in the top right; 'hide' keeps control on but puts the view away; 'off' stops it.

const NOUN = '(?:hand|hands)';
const KIND = '(?:control|tracking|preview|camera|view|window|mode|gestures?)';
const SHOW = new RegExp(`^(?:(?:show|open|start|turn on|enable|activate|launch|switch on|bring up)(?: me)?(?: the)?(?: my)? )?${NOUN}(?: ${KIND})?(?: on)?$|^(?:show|open) (?:me )?(?:my )?${NOUN}$`, 'i');
const HIDE = new RegExp(`^(?:hide|close|dismiss|put away)(?: the)?(?: my)? ${NOUN}(?: ${KIND})?$`, 'i');
const OFF = new RegExp(`^(?:(?:stop|turn off|disable|deactivate|switch off|end|quit) (?:the )?(?:my )?${NOUN}(?: ${KIND})?|${NOUN}(?: ${KIND})? off)$`, 'i');

function parseHandsCommand(text) {
  const t = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?,]+$/g, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis|j\.a\.r\.v\.i\.s)[, ]*/i, '').replace(/^please /i, '').replace(/ please$/i, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^(?:show|open)(?: me)?(?: my| the)? (?:jarvis )?dashboard$/i.test(t)) return 'dashboard';
  if (/^(?:undo (?:that |the )?throw|bring back (?:the |that )?(?:panel|hologram|item))[.!?]*$/i.test(t)) return 'undo';
  if (/^(?:show|open|list)(?: me)?(?: the)?(?: my)? (?:hand )?gestures?(?: cheat sheet| guide| help)?$/i.test(t)) return 'help';
  if (/^(?:calibrate|adjust|set up)(?: my| the)? hand(?:s| control| tracking)?$/i.test(t)) return 'calibrate';
  if (/^(?:pause|resume)(?: my| the)? hand(?:s| control| tracking)?$/i.test(t)) return /^pause/i.test(t) ? 'pause' : 'resume';
  if (OFF.test(t)) return 'off';
  if (HIDE.test(t)) return 'hide';
  if (SHOW.test(t)) return 'show';
  return null;
}

module.exports = { parseHandsCommand };
