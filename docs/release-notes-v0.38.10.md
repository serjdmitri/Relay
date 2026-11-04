# Relay 0.38.10

- Three hands-free modes in General settings: wake phrase, two claps followed by the phrase within five seconds, and two claps alone. Claps alone begin fresh command listening. Stopped speech helpers recover instead of remaining falsely armed; microphone retries use bounded backoff.
- Clap detection uses native acoustic peaks and validates both short impulses. Actual claps and wake recognition still require physical testing on the selected microphone.
- School connection accepts canonical trailing slashes, marks limited assignment views incomplete, and does not mistake a clock time for a due date. Signed-in Blackbaud was readable; its week view showed only five of fourteen active assignments.
- Phone reactor remains centered independently of smaller music controls; verified at two portrait sizes and landscape.
- Phone navigation offers Apple Maps immediately and a separate native Jarvis preview app. Native route mode changes recalculate the selected destination. Unsigned simulator build and seven parser/link checks passed; live routing, iPhone permissions, voice and device signing still need testing.
- External hand dragging ignores invalid coordinates and late helper output. Six-hand slot matching and release protections pass automated checks; multiple people and real app/tab dragging need camera testing.
- Nightly maintenance preserves completed proposal checkpoints if a later step fails. Local self-improvement needs a running Ollama and configured source/task. Generated patches still require review before execution; this change does not enable autonomous merging, pushing or installing.
- Includes the latest committed Claude changes through 2ed74ec without changing their calling or trusted-person behavior.

Google login still needs this app's OAuth client configuration; no connected Google accounts were present. Memory typing was confirmed working by the user.
