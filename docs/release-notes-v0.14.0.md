Connectors: Notion, Gmail and Google Calendar (several accounts).

## What changed
- **Settings > Connectors.** Paste a Notion integration token; sign in to Google with your own app for Gmail and Calendar, one or more accounts. Secrets are encrypted on your Mac.
- **Ask by voice:** "any unread email from Anna?", "what is on my Google calendar this week?", "add dentist Friday at 3", "search Notion for the trip plan", "draft an email to Sam saying I'll be late".
- **Safe:** reading is free, drafts are not sent, and sending an email always asks you first. Background agents can use the reading and writing tools but never send email.

Not tested by me: a real sign-in with Google or a real Notion token (I have neither). The sign-in flow (including the browser round trip), the API calls, the email and event building, and the approvals are covered by tests against pretend servers. If your first connection fails, the error text says what to fix.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
