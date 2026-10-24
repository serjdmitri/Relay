More model services, a calmer look and a sidebar you can collapse.

## What changed
- **More model services:** OpenAI (the ChatGPT API), Google Gemini, Groq, Mistral, xAI (Grok), DeepSeek, or any OpenAI-compatible address, next to the Anthropic API key and Ollama. Pick one under Account > Model service. Each service has its own key (stored encrypted with your Keychain), an editable model name and a Test button. The OpenAI API is billed separately from a ChatGPT subscription.
- **Calmer look:** a neutral gray interface with one indigo accent. Each page only tints the soft glow at the top and bottom of the window and the selected sidebar item.
- **Collapsible sidebar:** hide it to the left from the top bar, or with ⌘\, so the page gets the whole window. Relay remembers the choice.
- Website, README, diagram, charts and screenshots updated.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Models and sign-in
**No API key by default:** Relay runs your own Claude Code, signed in to your Claude plan (Pro or Max). Relay never sees your password. Relay is an independent project, not made or endorsed by Anthropic, and Anthropic's rules for third-party apps can change; if they do, an API key (Anthropic, OpenAI, Gemini, Groq, Mistral, xAI, DeepSeek or any OpenAI-compatible address) or a local Ollama model keeps Relay working. ChatGPT plans are not supported (use an OpenAI API key).

## Testing status
136 unit tests pass. Real calls to the new model services (OpenAI, Gemini, Groq, Mistral, xAI, DeepSeek) were not made: they are covered by tests with fake servers, so check the model name with the Test button. Live microphone dictation, music control, permission prompts and AppleScript against every app have only been tried by hand. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
