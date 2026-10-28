Languages, study and school tools, meeting helpers, a robotics helper, Spanish menus, and a rebuilt phone page.

## What's new
- **Languages:** say "speak Spanish" (15 languages); answers and voices follow, and everyday commands work in 5 languages. Menus and settings can be switched to Spanish.
- **School and security:** study mode ("quiz me on this"), explain this error, a phishing check that runs on your Mac, a password breach check (only a 5-character hash prefix is sent), and workshop mode for teaching younger students with hologram demos, a class quiz and printable handouts.
- **Every day:** morning briefing, clipboard history, an evening recap of what Relay did with one-tap undo, and an "ask before leaving my home folder" switch (on by default).
- **Meetings:** meeting notes (on-device listening, then a Note and reminders), and private meeting answers: Relay notices a question put to you, shows a short answer within a second or two and checks it online, in a window kept out of screen sharing.
- **Google:** Drive, Docs and Sheets tools. Reconnect your Google account to grant the new permissions.
- **Robotics:** what is plugged in (Arduino and other boards, serial ports), what is on an SD card or drive, voice checklists, "log this" to a Google Sheet, and WPILib and Arduino error hints.
- **Phone:** the reactor is centered, a big padlock shows whether the Mac is locked (and locks it), a keyboard button opens your normal keyboard upright and a full-screen hologram keyboard sideways, and the page rotates. Remove and re-add the page on your Home Screen to get rotation.

Tested with 565 unit tests and a headless browser. Microphone, USB and drive reads, screen-share hiding, the lock state, the PDF handout and the phone page have not been used on real hardware yet. Use private meeting answers only where AI help is allowed, and tell people if you record.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
