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
Supported options are an API key from one of the services above, or a local Ollama model. Relay also includes an unsupported, personal-use path that runs a Claude Code you have signed in to yourself. Anthropic does not allow apps to offer Claude.ai login or use a plan on behalf of other people, so use it at your own risk.

## Testing status
136 unit tests pass. Real calls to the new model services (OpenAI, Gemini, Groq, Mistral, xAI, DeepSeek) were not made: they are covered by tests with fake servers, so check the model name with the Test button. Live microphone dictation, music control, permission prompts and AppleScript against every app have only been tried by hand. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
