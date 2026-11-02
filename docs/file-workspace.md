# File workspace

Settings → Permissions → Folders & connected drives lists mounted volumes and checks folders you explicitly choose. Listing a volume does not authorize it. Choose the actual folder, not an alias. New folders start read-only; choose “Allow organization with preview” separately when you want to organize one. Remove access to revoke it.

These scopes belong to the file workspace. They do not disable the existing home-folder guard for other model tools, grant macOS Full Disk Access, or prove access to every file. macOS can still deny a child folder. Disconnected or replaced folders/drives must be selected again. Access checks read directory metadata only, not document contents.

## Organize a folder or external drive

Enable organization for a chosen folder, then click **Preview organization**. Relay proposes up to 150 loose files into `Organized/` beneath that same folder, grouped by type. It reuses the Downloads classifier: files modified in the last three hours, partial downloads, unknown types, hidden files, directories and code projects are left alone. No cloud model or file-content reading is involved.

**Apply these moves** is the explicit approval for the displayed plan. Previews expire in 30 minutes and can be applied only once. Moves use Relay's exclusive native mover. Conflicts or files changed after the preview are left in place. Organization does not delete anything, overwrite anything, or move across drives.

Undo buttons persist across restarts in Relay's local `workspaceMoves` journal. Failed undo entries remain available for retry; changed files and occupied original names are protected. Keep the folder access entry to retain its undo controls, and reconnect its original drive before undoing. Removing access does not remove the journal or undo moves. The journal records paths, timestamps and file identities, not document contents. Empty destination folders may remain after undo.
