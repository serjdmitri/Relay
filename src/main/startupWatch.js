// A hung start restarts itself. Twice now Relay has frozen right at launch, its main thread stuck inside the global key listener, so no window ever appeared and nothing could say so
// from inside (the stuck thread is the one that would have to). So a tiny separate watchdog, started before anything risky, waits for Relay to say "I finished starting" (a file).
// If that has not happened after about 40 seconds it force-quits the stuck copy and opens Relay again.
//
// Safe by design:
//  * it only acts while that exact process is still alive and has not finished starting; a normal quit, or a start that finishes, ends it silently;
//  * while a macOS security prompt is open (the Keychain "Always Allow" one) it waits for you, up to ten minutes, instead of killing the app under it;
//  * at most two forced restarts in fifteen minutes, so a problem it cannot fix never becomes a restart loop; after a good start the count is forgotten.
// It is plain sh, written next to Relay's data, started detached, and does not need Relay (or node) to run.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LIMIT_SECONDS = 40;

const SCRIPT = `#!/bin/sh
# Relay's startup watchdog (see startupWatch.js). Usage: startup-watch.sh <pid> <ready-file> <state-file> <app-bundle> [seconds]
PID="$1"; READY="$2"; STATE="$3"; APP="$4"; LIMIT="\${5:-40}"; TICK="\${RELAY_WATCH_TICK:-2}"
T=0
while kill -0 "$PID" 2>/dev/null; do
  [ -f "$READY" ] && exit 0
  if [ "$T" -ge "$LIMIT" ]; then
    # a security prompt (the Keychain one) is waiting for you: do not kill the app under it
    if [ "$T" -lt "\${RELAY_WATCH_PROMPT_CAP:-600}" ] && pgrep -x SecurityAgent >/dev/null 2>&1; then sleep "$TICK"; T=$((T + TICK)); continue; fi
    NOW=$(date +%s); RECENT=0
    if [ -f "$STATE" ]; then
      while read -r TS; do
        case "$TS" in ''|*[!0-9]*) continue ;; esac
        [ $((NOW - TS)) -lt 900 ] && RECENT=$((RECENT + 1))
      done < "$STATE"
    fi
    [ "$RECENT" -ge 2 ] && exit 0
    echo "$NOW" >> "$STATE"
    kill -9 "$PID" 2>/dev/null
    sleep 2
    open "$APP"
    exit 0
  fi
  sleep "$TICK"; T=$((T + TICK))
done
exit 0
`;

const files = (dir) => ({ script: path.join(dir, 'startup-watch.sh'), ready: path.join(dir, 'startup-ready'), state: path.join(dir, 'startup-watch-state') });

// "/Applications/Relay.app/Contents/MacOS/Relay" -> "/Applications/Relay.app", or null when it is not inside an app bundle.
const bundleOf = (exe) => { const m = /^(.*?\.app)(?:\/|$)/.exec(String(exe || '')); return m ? m[1] : null; };

// Call first thing at start. Never throws: the watchdog must not be able to stop Relay starting.
function begin({ dir, exe, pid = process.pid, packaged = true, fsImpl = fs, spawnFn = spawn, seconds = LIMIT_SECONDS } = {}) {
  try {
    const bundle = bundleOf(exe);
    if (!packaged || !bundle || !dir) return { ok: false, why: 'not a packaged app' };
    const f = files(dir);
    fsImpl.mkdirSync(dir, { recursive: true });
    try { fsImpl.unlinkSync(f.ready); } catch { /* none left over */ }
    fsImpl.writeFileSync(f.script, SCRIPT, { mode: 0o700 });
    const child = spawnFn('/bin/sh', [f.script, String(pid), f.ready, f.state, bundle, String(seconds)], { detached: true, stdio: 'ignore' });
    if (child && child.unref) child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}

// Call when starting has really finished.
function ready({ dir, fsImpl = fs } = {}) {
  try {
    const f = files(dir);
    fsImpl.writeFileSync(f.ready, String(Date.now()));
    try { fsImpl.unlinkSync(f.state); } catch { /* nothing to forget */ }
    return true;
  } catch { return false; }
}

module.exports = { begin, ready, bundleOf, files, SCRIPT, LIMIT_SECONDS };
