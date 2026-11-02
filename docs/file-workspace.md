# File workspace

Settings → Permissions → Folders & connected drives lists mounted volumes and checks folders you explicitly choose. Listing a volume does not authorize it. Choose the actual folder, not an alias. New folders start read-only; choose “Allow organization with preview” separately when you want to organize one. Remove access to revoke it.

These scopes belong to the file workspace. They do not disable the existing home-folder guard for other model tools, grant macOS Full Disk Access, or prove access to every file. macOS can still deny a child folder. Disconnected or replaced folders/drives must be selected again. Access checks read directory metadata only, not document contents.

## Organize a folder or external drive

Enable organization for a chosen folder, then click **Preview organization**. Relay proposes up to 150 loose files into `Organized/` beneath that same folder, grouped by type. It reuses the Downloads classifier: files modified in the last three hours, partial downloads, unknown types, hidden files, directories and code projects are left alone. No cloud model or file-content reading is involved.

**Apply these moves** is the explicit approval for the displayed plan. Previews expire in 30 minutes and can be applied only once. Moves use Relay's exclusive native mover. Conflicts or files changed after the preview are left in place. Organization does not delete anything, overwrite anything, or move across drives.

Undo buttons persist across restarts in Relay's local `workspaceMoves` journal. Failed undo entries remain available for retry; changed files and occupied original names are protected. Keep the folder access entry to retain its undo controls, and reconnect its original drive before undoing. Removing access does not remove the journal or undo moves. The journal records paths, timestamps and file identities, not document contents. Empty destination folders may remain after undo.

## Storage map

Say **“Show me the storage map”**, **“What's filling up my space?”** or **“whats taking up my storage”**, or click **Storage map** in Permissions. These commands run locally regardless of the selected cloud model. Spoken/text storage requests open the map immediately and start scanning an already authorized folder. With no readable authorized folder, a native folder chooser opens; selecting a folder grants read-only access and starts its scan. Cancelling leaves the menu open. The panel’s Choose folder button switches scope directly; Scan manually refreshes it. The panel floats above the reactor, has a draggable title bar, supports resizing and hand movement, and reuses menu momentum/trash-to-dismiss behavior. Dismissing the map never deletes files.

Click a block or folder row to drill down, use breadcrumbs to go back, and use **Show in Finder** or a row's Finder button to inspect an item. The blocks compare the 30 largest items in the selected view; the list includes the rest of the scanned items, 100 at a time. There is no file-deletion control.

Scanning reads local names, types and file sizes, never document contents or cloud services. It runs in a separate worker and can be cancelled. It is limited to 20,000 entries, 24 levels and approximately 15 seconds; a nonresponding drive is stopped after 20 seconds. Symbolic links, protected folders/packages and other mounted filesystems are excluded. Errors and limits produce visibly incomplete results. Cancelling discards the current scan. Maps live only in memory until closed or rescanned.

Reported sizes are logical file lengths, not exact physical space: compressed, shared, sparse and hard-linked files can differ from actual disk usage. This is a folder map, not an audit of the entire disk. Finder reveal rechecks the selected root and item identity. A disconnected or changed drive must be selected again; no automatic access escalation occurs.

Validation used temporary fixture files only: native preview/move/undo, storage worker scanning, cancellation, drill-down, Finder-target verification, rejected unrelated-window requests, and narrow/wide native UI checks. The packaged archive's scan worker was also exercised. Actual external-drive hardware, macOS permission prompts, spoken microphone input and hand-camera gestures still require physical testing.

## Natural menu requests

Built-in menus now share keyword detection across voice and typed requests. You can say “my computer is out of space,” “I could use a calculator,” “how is my RAM looking,” “my Wi-Fi is slow,” “how much battery have I got,” “bring up system stats,” or “can I see the activity centre.” Weather requests can appear in longer sentences, including “could you bring up the weather for Paris please” and “how hot will it be in Miami tomorrow.” Weather still needs a city or the configured briefing city.

Storage, weather, calculator, CPU, RAM/memory usage, battery, network, system metrics and Activity Center use existing menus and sources. Requests for multiple topics open separate menus; a weather lookup does not block the others from appearing. Detection is local for both Claude and Codex. Existing Live panels settings and window limits still apply. “Again” repeats the last menu request.

Keywords do not replace instructions to move/organize/delete files, send messages, save memories, change settings, close menus or explain a topic. Cloud-drive requests and connected-drive inventories keep their existing paths. Complex or unsupported requests continue through Relay's existing model/tools rather than being silently reduced to a single menu.
