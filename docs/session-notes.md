# Session notes

In **Memory → Session notes**, choose **Start session notes**. Foreground requests and Jarvis replies completed after that point are saved locally until you stop notes, disable memory or quit Relay. You can also say “start session notes”, “stop session notes”, “show session notes”, “search session notes for robotics”, or “export my session notes”. Capture always starts off after a restart.

This is an explicit recording mode for text exchanges, which can include information retrieved in replies. It does not capture microphone audio, background-agent reports, scheduled tasks or phone-origin requests. Credential-like content is omitted, but review notes before exporting or sharing them. Notes are conversation records, not independently verified facts or automatic memory instructions.

Expand a session to review or correct each saved request and reply, rename it, export it or delete the local session. Corrections are marked as user edits. Search happens on this Mac without a model call. Voice recall shows matching local sessions in a card; it does not load all sessions into the model by default.

Notes live in Relay's owner-only local settings file, separately from its History and factual memories. They are fetched only by the protected main-window controls, not included in general app-state broadcasts. Twenty sessions and 100 entries per session are supported; reaching a limit stops capture rather than silently deleting old notes. Expand sessions to load their editors, so closed sessions do not create thousands of controls.

**Export to Desktop/memory** creates a new private `.txt` file using Relay's existing local output exporter. Import it into Sentient OS yourself; Relay does not claim it wrote to the vault. Deleting/correcting a session does not alter History, an earlier exported file or a Sentient OS note. Local deletion asks for confirmation with Cancel selected by default.

Tests use isolated fixture conversations and temporary export folders. No personal conversations were captured or exported during testing.
