A colour update, plus a website for Relay.

## What changed
- New colourful app icon and in-app logo. The interface accent colour is now the logo's indigo.
- Website: https://serjdmitri.github.io/Relay/
- README now has screenshots, a diagram and charts.
- No change to how the app signs in or picks a model.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Models
Use an Anthropic API key or a local Ollama model. Signing in with a Claude account is meant for your own use on your own Mac: Anthropic does not allow third-party apps to offer claude.ai login to others, so if you share a build, use an API key or Ollama.

## Testing status
129 unit tests pass. Live microphone dictation end to end, music control, permission prompts and AppleScript against every app have only been tried by hand. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
