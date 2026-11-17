A bug-fixing and security release from a full audit of the code: 24 fixes, each with a test that fails without it. Nothing was removed.

## What changed
- **Questions can no longer be answered for the wrong request.** A "Yes" from the phone only counts for the question it was sent for. A new question closes the old one, and a request that ends (for example after a timeout) closes its question, so a late "Allow" cannot run its action. Answering No no longer drops the next request on the list.
- **Claude finishes the work before it answers.** A short sentence such as "Let me save that" was taken for the answer while the tool call was still being written; the action then ran after the request had been reported done. A request that times out is now stopped, not just reported.
- **Pressing the ask key while a request runs** no longer makes that request decline its own tool calls or ignore Stop.
- **AppleScript that runs code through Terminal** ("do script"), a built script, a raw event or typed keys now asks first.
- **`fetch_page` no longer reads your own network:** this Mac's local servers (the phone server included), your router and the cloud-metadata address are refused, also after a redirect. Other IPv6 forms that carry an IPv4 address count as private too.
- **`read_file` follows real paths,** so a link inside a dropped folder cannot lead out of it.
- **After the security check flags clearly hostile text in a page,** typing, clicking and opening things ask first.
- **Settings are never silently replaced.** If the settings file cannot be read, Relay keeps a copy (`relay.json.unreadable-<time>`) before starting on defaults.
- **"Forget everything" forgets everything:** lessons, things Relay noticed, session notes and the search index too, not only the facts list.
- **Meeting notes no longer leave the microphone on** when you end the meeting during a segment change.
- **Dictation recovers after sleep:** replacing a stuck speech helper is no longer reported as the helper stopping. Speech errors reach the request they belong to.
- **Overnight keep-awake:** two holds at once can no longer leave the Mac unable to sleep, and Relay does not hold the Mac awake when its safety file cannot be written.
- **Codex fallback** reads its result when the process closes, so a usage-limit message that arrives last is not missed.
- **Smaller fixes:** "Connect Google" by voice no longer errors; History > Dictation Remove works; a plugin that dies mid-write can no longer crash Relay; words with accents and other alphabets are no longer broken when split across network chunks.

Known and not changed: the plugin sandbox is permissive, Codex's own command execution is not switched off, the speech helper is shared without an owner, and fast mode no longer fully turns thinking off on the current Claude CLI. See `AUDIT-REPORT.md`.

Not tested by me: the new build on other Macs, Intel (x64), and anything that needs a microphone, camera or phone. The Mac (Apple silicon) build was installed and started here.
