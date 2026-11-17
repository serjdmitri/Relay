// Decides when a raw AppleScript needs the user's OK. Specific tools (messages_send,
// trash_path, run_shell) always confirm on their own; this covers the free-form escape hatch.
const RISKY = /\b(delete|remove|erase|trash|empty trash|send|quit|shut ?down|restart|log ?out|do shell script|sudo|move to trash)\b/i;
// Ways to run code that the words above do not catch: Terminal or iTerm's "do script", "run script" / "load script" (a script built from pieces), raw Apple
// event codes («event sysoexec» is "do shell script"), osascript, and typing keys into another app. Found by the audit: these ran with no question.
const RUNS_CODE = /\b(do script|run script|load script|osascript|keystroke|key code)\b|«\s*(event|class|data)\b|\bapplication "(Terminal|iTerm2?|Script Editor)"|\bapp "(Terminal|iTerm2?|Script Editor)"/i;

function scriptNeedsConfirm(script) {
  return RISKY.test(script) || RUNS_CODE.test(script);
}

module.exports = { scriptNeedsConfirm };
