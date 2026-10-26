"Hey Siri, Relay": talk to Relay from the iPhone on plain Wi-Fi.

## What changed
- **iPhone Shortcut.** Settings > Remote > Hey Siri, Relay makes a key and shows the six steps to build a Shortcut: Dictate Text, send it to your Mac, speak the answer. Then say "Hey Siri, Relay", or use the Action Button, Back Tap or a Home Screen icon. It works on plain home Wi-Fi, because Shortcuts does not need a secure address (Safari's own hold to talk does, so that needs Tailscale).
- **Waiting asks:** the server can return the answer in the same call (`wait: true`), which is what makes the Shortcut simple.
- Away from home, use the Tailscale address in the same Shortcut.

Tested: the waiting call (answer, and a polite message if the Mac never answers), and the settings page. Not tested by me: building and running the Shortcut on a real iPhone.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
