# Relay "Trust First" Spec

Status: draft for review. Nothing in this file is built yet.
Audience for this release series: Sergey and a few friends who install the DMG (not a public launch).

## 1. Why this exists

Sergey compared Relay with Torvis (heytorvis.com, paid, Windows/Linux) and three public repos by pranithvelar (`Jarvis`, `jarvis_experiment`, `Friday_mark2`). Reading only their READMEs and structure docs (none were run), Relay already covers most of the Torvis surface: it opens apps, handles files, clicks through UIs, runs background agents, has a phone page, MCP connectors, holograms, memory facts, schedules and Claude/Codex failover.

What the others have that Relay lacks, and that matters for friends using it:

| Idea | Source | Relay today |
|---|---|---|
| Self-diagnostics and feature flags | jarvis_experiment `core/health`, `core/flags` | none; permission, mic and keychain problems are debugged by hand |
| Learning from corrections, memory with decay | Friday_mark2 reflection and 6-layer memory | `src/main/memory.js` is a flat list of 150 facts |
| Fewer tools shown to the model per request | jarvis_experiment category dispatch | one list in `src/main/agent/tools.js`, growing each release |
| Commands from anywhere, queued while the Mac sleeps | Torvis phone bot, Jarvis Telegram | phone page needs the Mac awake plus Tailscale or LAN |
| User plugins | Torvis | MCP connector only (`src/main/connectors/mcp.js`) |
| Live panels | Torvis | cards and holograms are static |
| Folder question answering | Jarvis, jarvis_experiment | none |
| Proactive monitor with importance scoring | jarvis_experiment `background/` | `src/main/assist.js` for meetings only |
| Offline fallback | jarvis_experiment | Ollama provider exists, no connectivity detection |

The order is "trust first": fix the pain Sergey actually hit (permission prompts, keychain asking every update, phone mic) before adding new surface.

## 2. Principles

1. Nothing risky happens unseen. Send, delete, run code, purchase and anything that leaves the Mac asks first (existing `agent/safety.js` rules stay).
2. Everything new ships behind a feature flag, off by default until its tests pass and Doctor reports green.
3. Optional means optional: the app works fully with every new feature off.
4. User options over hard-coded behavior wherever the interview said so (called out below as **Option**).
5. Untested-on-hardware parts are labeled as such in the changelog, as before.

## 3. Release order

Each item is its own minor release.

1. Relay Doctor + feature flags
2. Memory v2
3. Tool categories
4. Queue while asleep + inbound iMessage
5. User plugins
6. Live panels
7. Folder Q&A
8. Proactive monitor + offline mode

## 4. Feature specs

### 4.1 Relay Doctor + feature flags

**Goal.** One place that says exactly what is broken and how to fix it.

**Checks** (each returns `ok | warn | fail`, a plain-English cause, and an optional fix):
- Claude CLI present and signed in; Codex CLI present and signed in (if failover is on)
- Microphone, Accessibility, Input Monitoring, Screen Recording, Speech Recognition, Automation, Full Disk Access (only if inbound iMessage is on)
- Code signature: ad-hoc vs the stable "Relay Local Signing" certificate vs Developer ID; explains why the keychain prompt returns after updates when ad-hoc
- Phone server: running, reachable address, Tailscale state, paired devices
- Speech: on-device recognition available; TTS voice installed
- MCP connectors reachable; Ollama reachable (if offline mode on)
- Disk: store file readable, free space
- Recent errors from the activity log

**Fixes.**
- Small, safe fixes may run automatically: restart Relay's own phone server, remove stale lock files, recreate missing Relay folders.
- Bigger fixes always ask first: open a specific System Settings pane, run the signing setup (`scripts/setup-signing.sh`), re-login prompts.
- **Option** (Settings > Doctor): `Ask before fixing` (default) / `Auto-fix small things only` / `Never fix, report only`. Permissions and signing are never auto-changed in any mode.

**Support.**
- `Copy report` produces a plain text report: app and macOS versions, check results, last errors. Home paths are replaced with `~`, tokens, keys, URLs with secrets and message text are removed. Nothing leaves the Mac unless the user pastes it.
- `Report a bug` / `Request a feature` buttons open the browser at `https://github.com/serjdmitri/Relay/issues/new` with a short prefilled title and body, and the full scrubbed report is put on the clipboard (URLs have length limits, so the body says "paste the report here"). The user presses submit on GitHub. Relay never holds a GitHub token.

**Feature flags.**
- Settings > Experimental lists each new feature with a toggle, a one-line description and a link to Doctor results for it.
- Stored in `store.js` under `flags.<name>`. Code asks `flags.on('name')`. Unknown flags are false.
- A flag cannot be turned on if its required permission check is `fail`; the toggle explains why.

**Edge cases.** Doctor must never hang: each check has a 3 second timeout and reports `warn: timed out`. Running Doctor twice at once returns the in-flight result. A check that throws becomes `fail` with the error name only.

**Tests.** Pure check functions with injected fakes (same pattern as `test/failover.test.js`); report scrubber tests with paths, tokens and emails; flag gating test.

### 4.2 Memory v2

**Goal.** Relay gets better from use without guessing wrongly about Sergey.

**Kinds.**
- `stated`: said directly ("remember that...") or set in Settings. Used immediately. Today's behavior; existing facts migrate as `stated`.
- `inferred`: Relay noticed a pattern. Goes to a review list, **not used until approved**. Unapproved items expire after 30 days.
- `lesson`: learned from a correction ("that's wrong", "not what I asked", "I meant the other one"). A regex gate runs first (zero model cost); only on a match does one small model call extract `{trigger, fix}`.

**Use at request time.** Facts as today. Lessons: pick the most relevant by keyword and tool-category match, inject at most 8 and about 300 tokens, newest and most reinforced first. Lessons that contradict a newer stated fact lose.

**Decay.** Approved inferred facts and lessons carry `confidence` and `lastUsed`. They fade with a 45 day half-life unless reinforced; below a threshold they stop being injected but are not deleted until the user removes them. Stated facts never decay.

**Control.**
- Settings > Memory shows three tabs: Facts, Learned about you (review list: Approve / Edit / Delete), Lessons (Edit / Delete).
- The same lists appear on the phone page (Safari) under a Memory section, with delete and approve over the existing authenticated remote API. No other memory editing on phone in this release.
- "What do you remember about me?" reads stated plus approved items.
- The existing secret filter in `memory.js` (`SECRET` pattern) applies to every kind before saving.

**Edge cases.** Never learn from text that came from a plugin, a web page or a panel (it is untrusted, see 5.5). Two corrections in quick succession produce one lesson (30 second dedupe window). Corrections about a one-off ("not that file, the other one") should not become permanent lessons: the extractor returns `scope: once|always`, and `once` is dropped.

**Tests.** Gate regex true/false cases, injection cap, decay math, migration of the old flat list, secret filter on all kinds, remote API auth on the memory endpoints.

### 4.3 Tool categories

**Goal.** Fewer tools in front of the model: faster, cheaper, less confused.

**Design.**
- Tools in `src/main/agent/tools.js` get a `category` (mac, files, web, drive, homework, hardware, holograms, schedule, memory, messages, plugins). Built-in no-model commands (timers, maths) are unaffected.
- Pre-filter: before a session starts, a cheap keyword/intent pass picks 1 to 3 categories for the request. Only those tools are exposed over MCP for that session.
- Safety net: every session also gets one extra tool, `load_more_tools(category)`. If Claude cannot find what it needs it calls this, the group appears, and it continues. This costs one extra step only on a wrong guess and is invisible to the user.
- Doctor logs every `load_more_tools` call (category requested, request text hash) so the classifier can be improved.
- If the pre-filter is unsure (no category matches), all tools load as today.

**Constraint to verify before building.** MCP tool lists are fixed per session in the Claude CLI path; confirm that `load_more_tools` can add tools mid-session via `tools/list_changed`, or fall back to ending the turn with a "load" result and resuming the same session. Codex path (`agent/codexCli.js`) needs the same check. This is the main technical risk of 4.3.

**Edge cases.** Follow-up turns reuse the previous categories plus any newly matched. Phone and typed requests use the same filter. Plugin tools belong to category `plugins` and are always listed by name only until loaded.

**Tests.** Classifier table tests ("lock my Mac" loads mac; "write my essay" loads homework and files; ambiguous loads all); `load_more_tools` adds the category; unchanged behavior when the flag is off.

### 4.4 Queue while asleep + inbound iMessage

**Goal.** Message Relay from the phone; it answers when it can, even if the Mac was asleep.

**Hard limit stated up front.** Relay is an app on the Mac. If the Mac is fully off or asleep, nothing runs. Queued items run when it wakes.

**Inbound iMessage (Option: off by default).**
- Setting `Command Relay by text`. Turning it on explains Full Disk Access (needed to read `~/Library/Messages/chat.db`), and Doctor checks it. macOS resets this permission when the app's signature changes (see 4.1 signing check).
- Trust: only the self-chat thread with the user's own Apple ID. Pairing: Relay shows a one-time code (valid 10 minutes, single use); the first text must contain it. After pairing, messages from any other chat or sender are ignored and logged only as a count.
- Replies go back through Messages via AppleScript. A text longer than a limit is shortened with "see the Mac for the rest".
- Messages are read by polling the database (about every 5 seconds while awake); no content is stored beyond the queue item.

**Queue.**
- While the Mac is asleep or Relay is busy, inbound commands are saved to a queue (`store.js`, with arrival time).
- On wake, items run in order. A later message can cancel an earlier one: "cancel the email one", "forget what I said about the report". Matching is model-judged against the pending list, and Relay replies with what it cancelled, or asks which one if two match.
- `queue` command: "what's queued?" lists items.
- Replies to the phone say "Your Mac was asleep, running that now" so it is clear when something was delayed.

**Confirmations for queued risky items.**
- Risky items (send, delete, run code, purchase, anything the existing safety rules would confirm) ask on **both** the Mac and the phone (iMessage). First answer wins and the other prompt closes ("already answered"). An answer must come from the paired thread.
- **Option** (Settings): when nobody answers: `Expire after 30 minutes` (default) / `Re-ask every hour, 3 times` / `Stay until I answer`. Expired items are dropped with a "skipped" notice.
- Read-only and safe items just run.

**Edge cases.** Same command sent twice within 60 seconds is deduped. Wake storms (Mac sleeps and wakes repeatedly) never run an item twice (items carry a state: queued, running, done, cancelled, expired). An item older than 24 hours is shown for review instead of run, whatever the option says. Prompt injection: text in the iMessage is user input from the paired self-chat, but links or attachments in it are untrusted content (5.5).

**Tests.** Pairing code validity, expiry and single use; sender filter; queue ordering, cancel matching with fakes; first-answer-wins race; expiry options; idempotency across wake storms.

### 4.5 User plugins

**Goal.** Add abilities without editing Relay, safely enough for friends.

**Format.** A plugin is a folder: `plugin.json` (name, version, description, tools with JSON schemas, permissions, optional panels) plus an executable entry. Permissions are declared: `network` (list of hosts), `files` (list of folders, read or write), `shell` (yes/no), `reads_screen`, `acts` (can change things vs read-only).

**Runtime.** Each plugin runs as its own process and speaks MCP over stdio. Relay mediates every call. No shared memory with Relay, no access to the store, keys or keychain. Enforcement is by Relay's mediation and macOS sandbox profile where possible (sandbox-exec is deprecated; spec an honest note that this is best-effort, not a hard security boundary, and that approval at install is the real control).

**Install.**
- Source: a URL or GitHub repo. Relay fetches it, shows the manifest, the requested permissions in plain English, and a code summary (file list, size, entry command). It pins the exact commit hash. User approves or cancels.
- Updates never apply silently: a new commit shows a diff of the manifest and file list and asks again.
- Plugins live in `~/Relay/plugins/<name>/` (the home-folder switch from 0.30 applies).
- Disable and remove from Settings > Plugins. Removing deletes the folder.

**Untrusted output rule (applies to every plugin tool call).** See 5.5.

**Edge cases.** Plugin crashes: restarted once, then marked failed with the stderr tail shown in Doctor. Plugin hangs: 30 second per-call timeout. Name clash with a built-in tool: rejected at install. Two plugins asking for the same tool name: namespaced `plugin.tool`. A plugin asking for `shell` plus `network` is shown with an extra warning.

**Tests.** Manifest validation; permission rendering; hash pinning and update diff; timeout and crash handling with fake child processes; namespacing.

### 4.6 Live panels

**Goal.** Floating panels with live data, like "show my Mac's load".

**Three kinds, all in scope:**
1. **Fixed**: CPU, memory, battery, network throughput, disk, and a running job or agent's progress. Updated every 1 to 2 seconds from the main process through a read-only data API.
2. **Plugin-fed**: a plugin declares a panel and a data feed in its manifest; Relay rate-limits updates (min 1 second).
3. **Model-built**: "show a panel of X" generates panel code (HTML/JS).

**Model-built panel safety.**
- Runs in an isolated frame with no Node, no access to Relay's APIs except a read-only `panel.data(source)` call, no file access.
- The panel declares its data sources; before it first appears the user sees "This panel reads: CPU, battery" and approves.
- **Network** is allowed per panel (chosen in the interview): a panel may declare host names (weather, stocks). Each host is approved once per panel, shown in plain English, and enforced by a content security policy limited to those hosts. Data from the network is untrusted (5.5).
- Panels are saved with their approved sources and hosts; editing the code re-asks.
- Panels cannot call tools, speak, type, or read the screen.

**UI.** Panels open as small floating windows like holograms, draggable, pinnable, closable with "close the panel". A list lives in Settings > Panels.

**Edge cases.** CPU cost: panels pause when hidden or when the Mac is on battery below 20%. At most 4 panels open. A panel that throws repeatedly is closed with the error shown.

**Tests.** Data API returns only declared sources; CSP generated from approved hosts; panel without approval does not open; update rate limiting.

### 4.7 Folder Q&A

**Goal.** "Ask my notes" over a folder of PDFs, text, markdown, docs.

- Embeddings: Apple on-device `NLEmbedding` through a small Swift helper (like `relay-speech`, `relay-ax`), so there is no install and everything stays on the Mac. Quality is lower than dedicated models; the spec accepts this for zero setup.
- Index: per-folder, stored under `~/Relay/index/<folder-hash>/` (chunks of about 800 characters, vector plus source file and offset). Built on demand and updated by file modification time.
- Answering: top chunks are retrieved locally, then sent to the model as `<material>` data with file names; the answer cites files. Nothing is uploaded except the retrieved chunks needed for that question.
- Scope: only folders the user adds in Settings > Folders; the home-folder guard still applies. Secrets filter skips files named like keys or `.env`.
- Limits: 5,000 files or 500 MB per folder; larger folders ask before indexing. PDF text extraction uses macOS PDFKit; scanned PDFs without text are reported as skipped.

**Edge cases.** File changes during indexing; unreadable files are skipped and listed; deleting a folder deletes its index. Retrieval below a similarity threshold answers "I did not find that in your notes" instead of guessing.

**Tests.** Chunker, index update on mtime, retrieval with fake vectors, threshold behavior, size limits.

### 4.8 Proactive monitor + offline mode

**Proactive monitor.**
- Signals (each toggleable): calendar event starting soon, a long job or agent finished, battery low, a watched folder changed, a plugin event.
- Each event gets an importance score 0 to 1 from simple rules (a pure function, no model call by default).
- **Option** (Settings > Proactive): how loud Relay may be. `Silent pill, speak only urgent` / `Always silent` / `Speak everything important`. Default: silent pill, speak only urgent, max 3 spoken per hour, quiet hours respected, phone push when the user is away. Quiet hours and the spoken cap are also options.
- Never interrupts during a meeting recording or screen share; never interrupts while the user is speaking.

**Offline mode.**
- Detection: two consecutive failed probes (a lightweight request to a Claude endpoint and a second public host) 10 seconds apart means offline; two successes means back online. Hysteresis avoids flapping.
- When offline: Relay answers chat and runs only the built-in no-model commands (timers, maths, open an app, window layouts, lock) using a local Ollama model if present. Anything needing multi-step tools says "That needs the internet" and, if scheduled, queues for when it returns.
- Never a full agent on the local model (a small model can take wrong actions).
- Doctor shows whether Ollama is reachable and which model.

**Tests.** Scoring function table; cap and quiet hours; detection with fake probes and hysteresis; offline command allow-list.

## 5. Cross-cutting

### 5.1 Settings
New sections: Doctor, Experimental, Memory (tabs), Plugins, Panels, Folders, Proactive, Queue and Messages. All strings go into `src/renderer/ui-es.js` for the Spanish UI.

### 5.2 Storage and migration
Everything lives in the existing store (`src/main/store.js`) except indexes and plugins (files under `~/Relay`). Store version bump with a one-way migration: old `memory.facts` become `stated`. A backup of the previous store is written once before migrating.

### 5.3 Permissions and signing
Doctor reports the signing state. Friends installing the release DMG get ad-hoc signed builds, so Keychain access, Accessibility, Microphone, Full Disk Access and Screen Recording may be asked again after every update. This spec does not fix that. The fix is a paid Apple Developer ID plus notarization, which is out of scope here but listed as the top recommendation for anyone beyond a few friends.

### 5.4 Confirmation model
One shared confirmation service replaces ad-hoc prompts: a pending item has an id, text, source (Mac, phone, iMessage, plugin) and expiry. Mac pill, phone page and iMessage all render the same item; the first valid answer resolves it.

### 5.5 Untrusted content rule
Anything read from a plugin, a panel, a web page, a file, or an iMessage attachment is data, not instructions. If a turn has read such content, any send, delete, code run or purchase in that same turn always asks for confirmation, even where it normally would not. Normal turns are unchanged. This rule is enforced in the tool wrapper (like `homeGuard.js`), not left to the model.

### 5.6 Privacy
No telemetry. No automatic crash reports. Reports are copied by the user. Issue links open in the browser only.

### 5.7 Testing approach
Same as the rest of the repo: pure modules with injected fakes under `node:test`, headless Chromium for UI and the phone page, and a clear changelog line for anything that needs real hardware (iMessage, Full Disk Access, real plugin processes, Swift embedding helper, offline detection on a real network drop). The 3 container-only failing tests (bridge, remote-service, remote-tailscale) stay out of the signal.

## 6. Open questions

1. Can `load_more_tools` add tools mid-session for both Claude CLI and Codex CLI paths, or does it need a resume-the-turn fallback? (Spike first, 4.3.)
2. Is polling `chat.db` every 5 seconds acceptable for battery, or should it wake only on a Messages notification?
3. Can the Swift `NLEmbedding` quality handle PDFs and notes well enough, or does Folder Q&A need Ollama embeddings as an optional upgrade later?
4. Plugin sandboxing on macOS: how much can be enforced without deprecated `sandbox-exec`? The spec assumes install-time approval is the main control.
5. Do friends want Telegram later? It was dropped from this release.

## 7. Out of scope

- Telegram and WhatsApp bots, and WhatsApp through the browser.
- Automatic crash or usage reporting.
- A plugin store, curated plugin list, or auto-updating plugins.
- Running while the Mac is fully off or asleep (items queue instead).
- Windows and Linux.
- Licence keys, paid tiers, Relay-hosted AI servers.
- A full agent on a local model.
- Apple notarization and Developer ID signing (recommended separately, $99 per year).
- Cloud memory sync and multi-device memory.
- Editing memory from the phone beyond approve and delete.
- Per-project auto documentation (Friday's Project Chronicle) and calendar conflict extraction from chat.
- Torvis-only plugins that depend on Windows (game updater) or hardware not on the Mac (3D printer control).
