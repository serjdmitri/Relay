const MODES = {
  personal: 'Be a practical personal assistant.',
  homework: 'For schoolwork, explain the reasoning clearly and adapt to the student’s level.',
  coding: 'For coding, prioritize precise technical answers and practical verification.',
  focus: 'Keep responses brief and help the user stay on the current task.'
};
function parseWorkMode(text) {
  const m = String(text || '').trim().match(/^(?:set|switch|change) (?:my )?work mode (?:to )?(personal|homework|coding|focus)[.!?]*$/i);
  return m ? m[1].toLowerCase() : null;
}
function workStyle(mode) { return MODES[mode] || MODES.personal; }
module.exports = { MODES, parseWorkMode, workStyle };
