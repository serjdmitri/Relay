Everything since 0.36.3:

- **Owner recognition ("this is not your computer"):** say "enroll my face". If a face that is not yours is in front of the camera while you are not, every display turns into a blurred red Jarvis reactor with a siren and a spoken warning, and the Mac locks after a countdown (default 20 seconds, adjustable 5 to 120). If you come back first, it stops. Your face is kept as encrypted numbers; no picture is saved. It only locks, never unlocks, and a photo of you can fool it.
- **Viewer guard:** a second face that stays in view starts a countdown and then locks (opt-in).
- **Assignment dashboard** (filter by class, due date, priority), **session review** (save only the facts you pick), **folder clutter suggestions** with an organization preview, and an **agents dashboard** (several jobs at once, a waiting line, per-job cancel).
- **Overnight tasks survive interruptions:** a task interrupted before it changed anything is tried again; one that had changed something is handed back with exactly what was done.
- **Self-improvement workspace:** proposals for changes to Relay's own code in a separate git worktree, tested there and saved as one revertable commit. It never merges, pushes or installs. Off until a source checkout is set.

The full test suite passes (1184 tests). Most of it has not been tried on a real Mac with a real camera. Face recognition accuracy in particular is untested; try "test the access denied screen" first. See the changelog for details and limits.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
