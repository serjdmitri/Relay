A security audit, and security warnings on their own. Ask anything short about your Mac's security ("check my security", "is my Mac safe", "has anything been compromised") and Relay opens a screen that says what is at risk and what is fine, worst first, with why and how to fix each. It covers your desktop, phone access, stored credentials, permissions, file operations and common signs of compromise, and it cannot prove a Mac is free of malware. Relay also checks by itself a minute and a half after it starts and every six hours, and tells you about a new Medium or worse problem without being asked; say "turn off security warnings" to stop it. Relay now saves its settings file readable by you alone.

The full test suite passes (1004 tests). The audit screen was checked in a browser preview and a real audit was run on one Mac; the spoken and notification warnings and the opened window have not been tried in the packaged app.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
