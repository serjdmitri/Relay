Everything since 0.36.2:

- **Today's priorities menu** ("show my priorities") and a Settings switch for security warnings.
- **File permission levels:** every file operation is rated Low to Critical, with an approval rule per level and Mac-only approval for Critical.
- **Overnight tasks:** hand Relay work for the night ("tonight, organize my Downloads"); it runs unattended inside a window and writes a morning report that says what was checked and what was only reported.
- **Jarvis phone calls:** faster replies (Fast reply), and a Twilio fallback that reads the message aloud when Bland cannot place the call.
- **Quick answers through Groq's free tier:** plain, timeless questions skip the Claude CLI for a faster reply; nothing personal is ever sent. Needs a free Groq key.
- From the other Claude session: saved skills, the council, Gemini voices, email and notification readers, YouTube voice control and work modes.
- Guided Google sign-in and weather menu updates.

The full test suite passes (1114 tests). Most of it has not been tried on a real Mac, a real phone call, a real Groq or Twilio account, or a real night. See the changelog for the details and the limits.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
