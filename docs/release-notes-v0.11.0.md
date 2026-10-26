Schedule requests by asking.

## What changed
- **"Every weekday at 8, open my email."** Relay saves it and runs it by itself. Also "every Monday and Thursday at 9…", "every morning…", and "schedule … for tomorrow at 7am". Ask "what's scheduled?" or say "cancel the email schedule".
- **Settings > Routines > Scheduled:** add by typing, switch on or off, delete, see the next run.
- **Safe:** runs only when Relay is free. Anything that sends or deletes is declined unless you answer within 90 seconds. A run missed by more than 45 minutes (Mac asleep, Relay closed) is skipped and you get a notification.

Not tested by me: a schedule firing at its real time in the app (the parsing, saving, due and missed logic have unit tests).

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
