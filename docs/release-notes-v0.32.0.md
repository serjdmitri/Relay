Codex as the silent backup when Claude runs out of usage.

## What changed
- **Account > "Backup when Claude runs out":** sign in to Codex with your ChatGPT account (Relay runs `codex login`; it never sees the login). When Claude stops a request for its usage limit, that same request is finished by Codex with no message, sound or question, and later requests go to Codex until Claude's reset time, then back to Claude.
- Codex gets Relay's own tools through the same local tool server, so confirmations, the home-folder switch and the never-delete rules apply the same way. Codex's own tools are held to a read-only sandbox.
- A Claude usage limit no longer triggers a pointless retry on a stronger Claude model first.

To use it: `npm install -g @openai/codex`, then Account > Sign in with ChatGPT.

Tested against a fake Codex and a fake Claude only. Not tried with a real Codex sign-in: the way Codex connects to Relay's tools may need a fix.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
