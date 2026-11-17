# Relay 0.38.18 — audit report

- **Checked commit:** `2397e75` (= `origin/main` and local `mine`, fetched 2026-11-16). `package.json` version 0.38.18.
- **Work branch:** `audit/full-audit-2026-11-16`, in the worktree `~/Downloads/relay/relay-audit`. Released as 0.38.19 (tag `v0.38.19`, pre-release, like the earlier 0.38.x releases) and installed on this Mac.
- **Your other checkouts were not touched.** `relay-latest` still has its 13 uncommitted files; `relay-mine`, `relay-lid`, `relay-docs4`, `relay-send-erase` and `relay-review-fixes` are unchanged.
- **Environment:** macOS 27.2 on Apple Silicon, Node 26.10 (CI uses Node 22), Electron 45.2.3, Swift 6.4.2, Claude Code CLI 2.1.325, Codex CLI 0.165.0. The installed app is 0.38.18 and was running during the audit.
- **Status:** complete for the areas listed in A–F. Five read-only review agents did the second pass. They hit the account usage limit twice and were then asked to report early, so each covered about a third to a half of its scope. Section G lists what was not reached.

## A. System health

| Subsystem | State | Basis |
|---|---|---|
| Electron core, IPC | Good. All `ipcMain.handle` calls go through a frame check (`ipcSecurity.js`). Navigation and new windows are blocked on every window with a preload. All 198 preload channels have a handler. | Code read plus a mechanical cross-check |
| Settings store | Fixed (F3). An unreadable `relay.json` used to be overwritten with defaults, losing data. All 111 `store.set` keys have parents in the defaults. | Tests, script |
| AI engine (Claude) | Fixed (F1, F2, F8). The flags Relay passes all exist in the installed CLI. | Reproduced on the real CLI |
| AI engine (Codex fallback) | All `exec` flags exist in the installed Codex. | `codex exec --help` |
| Phone remote | Pairing is sound: 6-digit code, lockout after 5 tries, hashed tokens compared in constant time, private-address check, header check against browser-driven requests, rate limit. Fixed a text-decoding defect (F7). | Code read, test |
| Injection shield | Fixed (F5). Flagged content used to restrict nothing new. | Tests |
| Plugins | Fixed a crash (F6). Plugins run in a sandbox profile with no keys in their environment. | Test |
| Firefox bridge, OAuth | Firefox only accepts `moz-extension://` origins on 127.0.0.1. OAuth uses state, PKCE and a host-checked loopback. | Code read |
| Scheduler | Exactly-once design: the schedule is advanced and saved before the run, and a crash leaves "unknown", not a re-run. | Code read |
| Native helpers | All 7 are built, executable, arm64 and signed in the installed app; `codesign --verify --deep` passes. All Swift sources parse. | Read-only checks |
| Voice, hands, camera, holograms, UI | Only partly reviewed (see G). | |
| Dependencies | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities. | Command |

## B. Issues found

| ID | Priority | File | Root cause | Fix | Verification |
|---|---|---|---|---|---|
| F1 | P1 | `src/main/agent/claudeCli.js` | A text block was taken as the final answer after 250 ms, even while a tool call was being written (that can take 5 s). The tool then ran after the request had been reported done; the real answer and the action count were lost. | Any new content block clears the final-answer timer. | Reproduced on the real CLI before and after the fix. New test fails on old code. |
| F2 | P1 | `claudeCli.js` | A request that timed out was reported failed but not interrupted, so it could keep calling tools. | Interrupt on timeout. | New test fails on old code. |
| F3 | P0 (data loss) | `src/main/store.js` | An unreadable or non-object `relay.json` (crash, full disk, hand edit) was replaced by defaults on the first save, losing history, memories, paired phones and keys. A file containing `null` crashed startup. | Keep a private copy (`relay.json.unreadable-<time>`, mode 600) first; log it in main.js. | New test fails on old code. |
| F4 | P2 | `src/main/main.js` | `googleConnections` was a constant inside `registerIpc()` but used by the "connect Google" voice command set up elsewhere, so it threw `ReferenceError`. | Moved to module state. | Static scope check now clean, plus a test. |
| F5 | P1 (security) | `src/main/askController.js` | When the shield flagged an injection attempt, the only tools it made "ask first" already asked. Typing, key presses, clicks and opening URLs stayed unconfirmed. | After a high-level flag, 25 acting tools ask first. Medium-only matches (often ordinary text such as "System: macOS 27") are not affected. | Two tests. |
| F6 | P1 (crash) | `src/main/plugins/host.js` | No error handler on the plugin's stdin, so a plugin dying mid-write raised an uncaught `EPIPE` in the main process. | Ignore pipe errors; the call fails on exit. | New test fails on old code. |
| F7 | P3 | `claudeCli.js`, `remote/server.js` | Output and request bodies were decoded chunk by chunk, so a letter split across chunks became broken characters. | `StringDecoder` / `setEncoding('utf8')`. | Two new tests, both fail on old code. |
| F8 | P1 | `askController.js` (`warmUp`) | Pressing the ask key while a request runs built a warm Claude session on the same tool server, and its constructor took the server over (`host.run`). The running request's next tool calls were declined, could not be stopped, and were not logged or undoable. | No warm-up while a request is running. | Traced in code. New test fails on old code. |
| F9 | P3 | `src/renderer/ui-es.js` | Six keys appeared twice in one table (`Unpair` with two different values). | Removed the dead copies. | Every translation resolves exactly as before (353 keys, 0 differences). |
| F10 | P1 (security) | `src/main/agent/safety.js` | `run_applescript` asked only when the script contained words such as "delete" or "do shell script". `tell application "Terminal" to do script "…"`, `run script`, raw `«event sysoexec»` and typed keystrokes ran shell commands with no question, which also got past "Relay never deletes". | These forms now ask first. Ordinary scripts (Notes, Finder, Music) still do not. | Found by the security agent; confirmed in code. New test fails on old code. |
| F11 | P1 (security) | `src/main/agent/web.js` | `fetch_page` read any http(s) address and followed any redirect. A model or an injected page could read this Mac's local servers (the phone server on 47900), the router, and 169.254.169.254, and get the content into the model's context. | Every hop's address is resolved first and private, loopback and link-local addresses are refused. Redirects are followed by hand. http still works for public sites. | New tests (3) fail on old code. |
| F12 | P2 (security) | `src/main/agent/files.js` | `read_file` compared path strings, so a symlink inside a dropped folder (for example `notes.txt -> ~/.ssh/id_ed25519`) was read without a question. | Compare real paths. | New test fails on old code. |
| F13 | P3 | `src/main/safeFetch.js` | IPv6 forms that carry an IPv4 address (NAT64 `64:ff9b::`, 6to4 `2002::`, Teredo `2001:0::`) counted as public. | Treated as private. | New test fails on old code. |
| F14 | P0 (unauthorized action) | `src/main/askController.js` (`askConfirm`, `finish`) | A phone answer was applied to whichever question was current, not the one it was sent for. A second question replaced the first without closing it. A request that ended (for example, a Claude timeout after 5 minutes) left its question open. So a late "Yes" from the phone could approve a different, newer action, and a late "Allow" on the Mac could run a timed-out request's tool. | Each question has its own answer function. Phone answers and the 90-second unattended timeout only reach that question. A new question first closes the old one as No. `finish()` closes any open question as No. | Found by the AI-engine agent; confirmed in code. 3 new tests fail on old code (one by hanging forever, the bug itself). |
| F15 | P2 | `askController.js` (`finish`) | Answering No to a question ends that request as "stopped". The next request on the list had already been taken off the queue but was not started, so it was silently lost. | Start the next request unless Stop was pressed. Stop already empties the list. | New test (source check). |
| F16 | P2 | `src/main/agent/codexCli.js` | The Codex result was read on `exit`, which can come before the last lines of output have been read. The usage-limit error is often the last line, so failover could be missed. Output was also decoded per chunk. | Read on `close`; decode with `StringDecoder`. | New test fails on old code. |
| F17 | P0 (microphone left on) | `src/main/meeting.js` | When a meeting ended while its 50-second stretch was being read ("Jarvis, end the meeting", or the menu), the stretch change still opened the microphone again. Nothing owned or closed that session, so with Hey Jarvis off it stayed open until Relay quit. | After reading a stretch, stop if the meeting is ending. If it ended while the microphone was opening, close it again. | Found by the voice agent; confirmed in code. New test fails on old code. |
| F18 | P1 | `src/main/speech.js` | Replacing a stuck speech helper inside `listen()` (the recovery after sleep) emitted `exit`. The controller treats `exit` while listening as a failure, so instead of recovering, the key press fell back to "You can type instead". | A chosen restart emits `restart`, not `exit`. | New test fails on old code. |
| F19 | P2 | `speech.js` | Any error from the helper rejected whichever request was waiting first. A `start` error could reject a pending device list while the start waited for its timeout, and a microphone failure never reached listeners. | Errors are matched to their command by code. Errors with no command go to `error-event`. | New test fails on old code. |
| F20 | P1 (privacy) | `src/main/askController.js` (forget-all) | "Forget everything" cleared only the facts list. Learned lessons, things Relay noticed, session notes (which quote what you said word for word) and `semantic-index.json` all stayed. With the facts list already empty, Relay replied that there was nothing to forget and cleared nothing. | Clears all four stores and deletes the index file. "Nothing to forget" is now said only when all of them are empty. | Found by the memory agent; confirmed in code. New test fails on old code. |
| F21 | P1 | `src/main/wakeScheduler.js` | A second keep-awake hold while one was running recorded Relay's own "sleep off" as the state to restore and overwrote the heartbeat timer. After both finished the Mac could never sleep, even with the lid closed. | A second hold joins the first, which restores sleep when it ends. | New test fails on old code. |
| F22 | P2 | `wakeScheduler.js` | If the heartbeat file could not be written, Relay held the Mac awake anyway. The watchdog exits without restoring when that file is missing, so a crash left sleep off until the next start. | Do not hold without a heartbeat. | New test fails on old code. |
| F23 | P1 | `src/renderer/app.js` | History > Dictation "Remove" never did anything: the click handler only matched Copy and Fix. | Remove is matched too. | Found by the frontend agent. New test fails on old code. |
| F24 | P3 | `app.js`, `shared.js` | A suggested routine's name went into the page unescaped. A failed Undo left its button stuck on "Undoing…". `esc()` did not escape single quotes. | Escaped; try/catch; `esc()` now escapes `'`. | New tests fail on old code. |
| F25 | P2 | `src/main/main.js` (quit path) | **Found, not fixed.** A running Relay ignored a normal Apple Event quit and `SIGTERM` for at least 15 s, in both 0.38.18 (after 21 hours) and 0.38.19 (after 12 minutes, responsive and logging). Nothing in `main.js` prevents quitting, so the cause is not known. It makes the install script's polite quit fail, and updates then need a force-quit. | Not changed. Needs a reproduction with the running app (`app.on('before-quit')` handlers and `window-all-closed` are the first places to look). | Observed three times; not reproduced in isolation. |

## C. Fixes implemented

These are the small changes listed in B. Each new or extended test fails on the original code; this was shown by restoring the original file and running the test. F5 and F4 are the exceptions: F5's tests and F4's test check the new structure. No dependencies were added. No feature was removed.

## D. Test results

- **Baseline:** `npm test` gave 1907 pass, 0 fail (31.7 s).
- **After all changes:** `npm test` gave 1935 pass, 0 fail (28 new tests, all failing on the original code except two that check the new structure).
- **Other commands:**
  - `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
  - `xcrun swiftc -frontend -parse` on every `native/`, `ios/` and `ios/Navigation/` Swift file, as CI does: no errors.
- **Warnings seen (not changed):** Node prints `MODULE_TYPELESS_PACKAGE_JSON` for the ES-module renderer files that tests import (`holo-*.js`, `liveness.js`). These are harmless.

### Release and install notes (0.38.19)

- The first build, made in the audit worktree with a symlinked `node_modules`, **was missing `node-gyp-build`** (the key listener needs it). The project's own startup check caught it ("Cannot find module 'node-gyp-build'") and refused to make a DMG, so it was never installed. The release was rebuilt from a real `npm ci` and passed the startup check (15.3 s). Lesson: build releases from a checkout with a real `node_modules`.
- One full test run after the clean install gave 1930 pass and 1 fail out of 1931 tests. It could not be reproduced: the next three runs gave 1935/1935. Cause unknown; worth watching.
- The installed 0.38.18 ignored a polite quit and a terminate signal after running for 21 hours, so it was force-quit to install. Its settings file had been saved a minute earlier. A backup of the 0.38.18 app is in `~/Downloads/relay/Relay-0.38.18-before-0.38.19.app`.
- After installing, macOS asked once for Keychain access for "Relay Safe Storage". Relay waits for that answer before it finishes starting.

### CI and history notes

- **CI on Node 22 was failing before this audit** (and still failed on the first 0.38.19 tag): two unref'd timers in `documents/store.js` and `documents/render.js` let Node 22 end waiting tests ("event loop has already resolved"). Fixed in `a96e3b7`; the whole suite passes on Node 22 (1935/1935) and `Checks` is green on `main`.
- **Commit attribution:** no git identity was set, so git used the Mac's hostname email and GitHub could not link the commits to your account. A global identity is now set (`Sergey Dmitriev <113930457+serjdmitri@users.noreply.github.com>`). On request, the history was rewritten: 78 commits authored as `Claude <noreply@anthropic.com>` and 172 `Co-authored-by: Claude` lines were removed, and the Mac-hostname emails were mapped to your account. File trees, commit dates and commit counts are identical on every branch and tag (verified), all 5 branches and 69 tags on GitHub were force-pushed, and `v0.38.19` and its release assets were kept. A mirror backup of the old history is at `~/Downloads/relay/Relay-github-backup-before-rewrite.git`.

## E. Performance (measured)

- **F1:** a tool request that "answered" at 6.3 s with nothing done now answers at 6.3 s with the action done.
- **Fast mode:** it no longer reliably turns thinking off. Each configuration was run once with Claude Haiku on the installed CLI:

  | Request | Fast mode | `--effort low` |
  |---|---|---|
  | Simple note | No thinking, answer at 1.9 s | No thinking, answer at 1.8 s |
  | Longer note | 1.4 s of thinking, tool call at 2.4 s, answer at 4.0 s | No thinking, tool call at 0.9 s, answer at 2.5 s |

  Not changed: one sample per configuration is not enough evidence.
- **Not measured:** startup time and idle CPU and memory. They need the running app, and I did not relaunch or rebuild it.

## F. Security

- **Fixed:**
  - F5: the injection-shield flag now restricts acting tools.
  - F8: the running request can no longer lose its confirmation, Stop button and action log to a warm-up session.
  - F6: a plugin can no longer crash the app through its pipe.
- **Checked and judged sound:**
  - Phone pairing and auth.
  - IPC frame check.
  - Firefox origin check.
  - OAuth loopback (state, PKCE, host check).
  - Claude tool server (127.0.0.1 only, bearer token, Host-header check against DNS rebinding).
  - Claude runs with no built-in tools, no user settings and no session saving.
  - Codex runs read-only with the user config ignored.
  - Confirmations from the phone are refused for Mac-only questions.
  - CSP is present on all main renderer pages.
- **Also fixed after the security agent's review:** F10 (AppleScript code execution without a question), F11 (`fetch_page` could read your local network), F12 (symlinks out of dropped folders), F13 (IPv6 address forms).
- **Open, confirmed in code by the security agent, not fixed (each needs a design decision or a runtime check):**
  - **Plugin sandbox is `(allow default)`** (`plugins/sandbox.js:13`). It denies network and home-folder files only, so a plugin with "no permissions" can still start other programs and send Apple Events. Proposed: deny `process-exec` except its own command, and deny `appleevent-send`. Needs a runtime test on macOS that real plugins still start.
  - **A plugin file permission of `~/.` can re-open the secret folders.** The secret-folder deny comes before the per-permission allow lines, and the sandbox language takes the last match. The manifest also accepts `~/.` and `/Users`. Proposed: write the deny last and refuse paths that resolve to the home folder or above.
  - **Relative paths skip the home guard and the file-risk rating** (`filePermissions.js:29`, `homeGuard.js:12`). They are rated "inside" and resolved against the process's working folder, which is `/` for an app started from Finder. Proposed: refuse paths that are not absolute and do not start with `~` in the path tools.
  - **The approval text for shell and AppleScript is cut at 300 characters** (`tools.js:273, 281`), so a long command's tail is never shown. Proposed: show it all, or say it was cut.
  - **Codex's own command execution is not switched off** (`codexCli.js:77–92`). It runs read-only with no approval prompt, and only a prompt sentence says "do not run shell commands", so under failover it could read files the sandbox allows and pass them on. Proposed: fail the run on a command-execution event, as is already done for file changes. The exact event name needs a runtime `codex exec --json` capture.
  - **Late events from an early-answered Claude turn can reach the next request** on a kept conversation (`claudeCli.js`, `stale` only skips the `result` event). F1 narrows this but does not close it. Proposed: ignore `assistant` and `stream_event` while `stale > 0`, and decline tool calls in that window.
  - **Codex escalation reuses the same tool-server token** while the first process may still be alive (`askController.js:3805`). Proposed: wait for `close`, or use a fresh token per run.
  - **Background agents skip the spend limit.** `budgetGate` is only called from `execute`; `AgentManager` was not checked.
  - **The injection flag belongs to the whole controller.** A page a background agent reads switches on questions in your foreground request. It errs on the safe side.
  - **Background agents do not get F5's ask-first rule.** `agentSafe` drops `confirm`. Their tool set has no typing, clicking or opening tools, so the effect is limited to notes and reminders.
  - Five phone pages and two small renderer pages have no CSP. Their dynamic text uses `textContent`, so this is P3 defence in depth.
- No secrets were read, printed or logged during the audit.

## G. Remaining problems

- **Confirmed but unresolved:**
  - Fast mode (`MAX_THINKING_TOKENS=0`) no longer fully disables thinking on Claude CLI 2.1.325 (see E). This needs a decision on `--effort low` plus more samples.
- **Confirmed in code, not fixed (need a design change and hardware testing):**
  - **One speech helper is shared** by the wake word, barge-in, meeting notes and the ask key, and its `start` is silent when a session is already open (`relay-speech.swift:462`). Real overlaps include Relay speaking while the speech-based wake word is armed, and a key press while the wake word is arming. Each costs a 4 s wait and a helper kill. The fix needs session ids on `start` and `cancel`. Always sending `cancel` first would break the other owner.
  - **The controller has no `error-event` listener.** A microphone failure after "listening" leaves the state at listening with system audio still ducked, until the next action.
  - **Kokoro, OmniVoice and cloud voices flip "talking" off and on between sentences** (`voice.js:286, 293`). That closes and reopens the barge-in microphone per sentence. On Bluetooth headsets it likely flips them in and out of call mode.
  - **A replacement speech helper does not get the language and vocabulary again** (`speech.js` `ensure()`). Non-English users may get English recognition after a restart.
  - **No `powerMonitor 'suspend'` handler.** The camera and microphone are only reset after wake. It is not known whether a held hand drag is released before sleep.
  - **Possible data race in `Mic.recover()` in the Swift helper** (notification thread against the audio thread) on a route change.
- **From the memory and frontend reviews, not fixed:**
  - **Lessons are put into every matching prompt as "follow them"** with no injection scan (`lessons.js:101`, `parseLesson`). A lesson written from a reply that quoted a malicious page would persist for weeks. Proposed: drop lessons the shield rates high, and frame them as data.
  - **Lessons and "noticed" facts may still be learned while memory is off** (`askController.js:2231, 3871` check only the `memoryV2` flag). Plausible; the surrounding code was not read.
  - **Editing a lesson skips the secret filter** (`memoryV2Act('lesson-edit')`).
  - **Skill import overwrites changes made while it downloads** (`askController.js:1205`).
  - **A queued task interrupted by a crash stays "running" for good** (`queue.js`). Proposed: report it for review, as schedules already do.
  - **Settings page:** several buttons do not handle a failed call (Stop active work, Add schedule, toggles), and `toggleRow` can throw on a missing nested setting.
- **Not confirmed (checked and rejected):** the voice agent's suggestion that saying "forget my face" or "turn owner recognition off" bypasses authorization. They are gated by `trustedPeople.authorize()` (main.js:2124). Still open: `unlearn`, `seconds`, `photos-off` and `away-off` are not gated, and whether Hey Jarvis accepts commands while the screen is locked was not checked.
- **Needs physical hardware:**
  - The speech-helper overlaps above, and AirPods or Bluetooth route changes during listening.
  - Hand-gesture misclassification, camera recovery after sleep, and Bluetooth microphone switching.
- **Needs external credentials:** live Google, Notion, Twilio and Bland flows. Nothing was sent or edited.
- **Needs your approval:**
  - Rebuilding and installing over `/Applications/Relay.app`.
  - Switching fast mode to `--effort low`.
- **Not yet investigated:** the second-pass agents' areas, unless their findings appear in the addendum below:
  - Security (the agent did not reach these): `registerIpc` and the `state:set` allowlist, encryptKey/decryptKey, all of `connectors/`, custom panels (`panelWindow.js`, `renderer/panel.*`), the unattended code agents (`selfImprove`, `nightRunner`, `nightClaude`, `codeAgent`, `skillImport`), and `save_files` path cleaning.
  - AI engine (the agent did not reach these): `council.js`, `debate.js`, `workModes.js`, `research.js` (cancellation, timeouts, whether fact-checking verifies independently), `budget.js`, `AgentManager`. The agent judged these sound: providers' request and response formats (Anthropic, OpenAI-compatible, Ollama), the router, failover, `use_tool` (cannot skip a tool's confirm) and the tool-server checks. Model ids in `presets.js` (`gemini-3.8-flash`, `gpt-4.1-mini` and others) could not be verified offline; the in-app Test button is the check.
  - Voice (the agent did not reach these): `wakeModel.js`, the renderer wake engine, all of `tts/*`, the native helpers other than `relay-speech`, all of `hands/*`, camera, presence, `ownerGuard` and intruder-photo storage.
  - Frontend: `app.js` HTML sinks, holograms and CAD export, window geometry.
  - Memory and automations (the agent did not reach these): `when.js`, `proactive.js`, `overnight.js`, `nightRunner.js`, `nightClaude.js`, `selfImprove.js`, `scenes.js`, `pageWatch.js`, `clutter.js`, `notes/*`, `drive/*` (file moves and undo), `documents/*` (Office XML escaping), `calls/service.js`, CI on Node 22 vs 26, `scripts/startup-check.js`, and a list of untested modules.
  - Frontend (the agent did not reach these): `app.js` lines 521–1906 apart from the grep (only line 545 was a real HTML sink, now fixed), all phone pages (`src/remote/*`), hologram and CAD export, and window management.

## H. Production readiness

- **Everyday use on your own Mac:** good. The core paths have strong defensive design, and this audit found real but narrow defects in the request path. Nine of them (F1, F2, F5, F8, F10, F11, F14, F17, F20) affected whether actions were confirmed, counted, stoppable, able to reach your local network, whether the microphone stayed on, or whether "forget everything" really forgot.
- **Wider distribution:** not ready yet. The release DMGs are ad-hoc or locally signed, not notarized. CI covers unit tests only, with no packaged-app smoke test. Several subsystems (voice, camera, holograms) are only verifiable on hardware.

## I. Final changes

- **Source files modified:**
  - `src/main/wakeScheduler.js`
  - `src/renderer/app.js`
  - `src/renderer/shared.js`
  - `src/main/meeting.js`
  - `src/main/speech.js`
  - `src/main/agent/codexCli.js`
  - `src/main/agent/safety.js`
  - `src/main/agent/web.js`
  - `src/main/agent/files.js`
  - `src/main/safeFetch.js`
  - `src/main/agent/claudeCli.js`
  - `src/main/askController.js`
  - `src/main/main.js`
  - `src/main/plugins/host.js`
  - `src/main/remote/server.js`
  - `src/main/store.js`
  - `src/renderer/ui-es.js`
- **Tests extended:**
  - `test/claude.test.js` (6 new tests)
  - `test/store.test.js`
  - `test/google-easy.test.js`
  - `test/injection-shield.test.js` (1 new test plus extended assertions)
  - `test/plugins.test.js`
  - `test/remote-server.test.js`
  - `test/mac.test.js`
  - `test/web-fetch-ssrf.test.js` (new, 4 tests)
  - `test/confirm-binding.test.js` (new, 3 tests)
  - `test/codex-cli.test.js` (1 new test; the fake process now also emits `close`, like a real one)
  - `test/meeting.test.js` (1 new test)
  - `test/speech.test.js` (2 new tests)
  - `test/wake-scheduler.test.js` (2 new tests)
  - `test/memory-controller.test.js` (1 new test)
  - `test/settings-page-fixes.test.js` (new, 3 tests)
- **New dependencies:** none.
- **Branch:** `audit/full-audit-2026-11-16` (worktree `~/Downloads/relay/relay-audit`), commits `2d81a8c` (fixes), `95be255` (report) and the release commit on top of `2397e75`, fast-forwarded into `main`.
- **Rollback:** discard the worktree with `git -C ~/Downloads/relay/relay-latest worktree remove --force ~/Downloads/relay/relay-audit && git -C ~/Downloads/relay/relay-latest branch -D audit/full-audit-2026-11-16`. Nothing else was changed.

## J. Top 10 next improvements

1. **Review this branch and merge it into `main`.** High benefit, low risk.
   - Then close the plugin sandbox holes listed in F (deny `process-exec` and Apple Events; write the secret-folder deny last). High benefit, medium risk; test with real plugins.
2. **Decide on fast mode:** measure `--effort low` over about 20 requests and switch if it holds. Medium benefit, low risk.
3. **Give each Claude session its own route on the tool server** (`/mcp/<session>`), so a future code path cannot repeat F8. Medium benefit, medium risk.
4. **Add a packaged-app smoke test in CI:** `npm run startup-check` on the built `.app`. High benefit, low risk.
5. **Finish the second-pass reviews listed in G**, starting with the shell and AppleScript deny-lists and file-permission path handling. High benefit, no code risk.
6. **Give speech-helper sessions an owner** (session id on `start` and `cancel`), add an `error-event` listener in the controller, and stop the per-sentence talking flip. Test on hardware. High benefit, medium risk.
7. **Add a CSP to the phone pages and `sticky.html` / `recent-tab.html`.** Low to medium benefit, low risk.
8. **Run CI on Node 26 as well as 22, matching this Mac.** Low benefit, low risk.
9. **Notarize release builds before wider distribution.** High benefit for distribution, medium risk.
10. **Trim `askController.js` (4,150 lines) by moving the phone and hologram helpers out.** This is a maintainability change, not a bug fix. Medium benefit, medium risk.
