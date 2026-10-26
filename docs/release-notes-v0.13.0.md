Usage after every ask (never spoken), speed controls, Try again, and answers that appear as they are written.

## What changed
- **Usage line:** model, time, tokens, cost at API prices and your Claude 5-hour limit, small and dim under the answer. Never read aloud. Off switch in General. Also kept in History.
- **Speed:** "use the fast model", "use the smarter model", "use deep", "use auto", or Model Speed in the menu bar.
- **Try again:** reruns the last request on the next model up (Haiku, Sonnet, Opus).
- **Streaming:** long answers show up as they are written.

Tested against the real Claude CLI: tokens, streamed text, cost and the plan limit all came through. Not tested by me: the on-screen look in the live app, and usage with the OpenAI-compatible and Ollama services (they have unit-level support only).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
