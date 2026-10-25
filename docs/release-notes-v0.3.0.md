A buddy cursor and show-me tools: Relay can now point at things on your screen.

## What changed
- **Buddy cursor:** a small helper follows your pointer while Relay listens (a mic meter), works (a spinner) and finishes (a check). Switch it off in General > Buddy cursor.
- **Show me:** Relay can point at an exact element (`point_at_element`, found through the accessibility tree, so it works even with models that cannot see images), draw boxes, circles, arrows and labels (`draw_on_screen`), and walk you through a task with a step card (`guide_step`; say "next" to go on). Marks stay about 30 seconds, or until you press Esc or start a new request.
- **Every display:** marks and the buddy work on all your screens, and screenshots now capture the display you are on. They are hidden while a screenshot is taken so the model never sees them.
- Docs and site now lead with "No API key: it runs on the Claude plan you already have", with API keys and Ollama as options.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
149 unit tests pass. The overlay was run for real in an Electron window on **one display only**. Not yet tried: two or more displays, full-screen apps, a real model choosing the coordinates, and the downloadable `.dmg`. Real calls to the OpenAI, Gemini, Groq, Mistral, xAI and DeepSeek services were still not made (covered by tests with fake servers). If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
