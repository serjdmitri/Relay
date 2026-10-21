// Decides when a raw AppleScript needs the user's OK. Specific tools (messages_send,
// trash_path, run_shell) always confirm on their own; this covers the free-form escape hatch.
const RISKY = /\b(delete|remove|erase|trash|empty trash|send|quit|shut ?down|restart|log ?out|do shell script|sudo|move to trash)\b/i;

function scriptNeedsConfirm(script) {
  return RISKY.test(script);
}

module.exports = { scriptNeedsConfirm };
