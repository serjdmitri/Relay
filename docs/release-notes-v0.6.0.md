The Jarvis ring becomes the interface, you can wake it by voice, name a task once and repeat it, and pick a more natural voice.

## What changed
- **The ring is the interface:** it stays beside your pointer, moves with your voice, spins while Relay works and pulses while it speaks. What Relay hears and answers shows in a small card beside it. The pill still opens for typing (⌥T) and for Allow / Cancel questions. General > Look > Classic brings the old pill back. The arrow sits outside the ring.
- **"Hey Jarvis":** off until you turn it on (General, or the menu bar icon). It listens on this Mac with the same on-device speech engine as dictation, plays the chime, takes your request and ends by itself. You can change the phrase. The orange microphone dot is on while it listens.
- **Remember a task by name:** "remember this as morning setup", then say "morning setup" to repeat the exact actions with no model. Sends and deletes still ask first. "Forget morning setup" removes it.
- **Better voices:** OpenAI and ElevenLabs with your own key, or a free on-device voice (Kokoro, Apple Silicon, downloaded on demand with a pinned hash check). If an online voice fails, your Mac voice answers.
- **Fix:** the menu bar icon did not change while listening or working in 0.3.0 to 0.5.1.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below. The on-device voice needs Apple Silicon.

## Install
Download the `.dmg` for your Mac and drag Relay to Applications. It is not notarized, so the first time, right-click Relay and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Relay.app`. You will approve Microphone, Accessibility, Screen Recording and Input Monitoring once.

## Testing status
191 unit tests pass. Not yet tried by the author: the on-device voice end to end (downloading and running it), the online voices with a real key, and "Hey Jarvis" in a noisy room. If something fails, open an issue with what History > Actions shows.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
