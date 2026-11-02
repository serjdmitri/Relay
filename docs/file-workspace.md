# File workspace

Settings → Permissions → Folders & connected drives lists mounted volumes and checks folders you explicitly choose. Listing a volume does not authorize it. Choose the actual folder, not an alias. New folders start read-only; choose “Allow organization with preview” separately when you want to organize one. Remove access to revoke it.

These scopes belong to the file workspace. They do not disable the existing home-folder guard for other model tools, grant macOS Full Disk Access, or prove access to every file. macOS can still deny a child folder. Disconnected or replaced folders/drives must be selected again. Access checks read directory metadata only, not document contents.

## Organize a folder or external drive

Enable organization for a chosen folder, then click **Preview organization**. Relay proposes up to 150 loose files into `Organized/` beneath that same folder, grouped by type. It reuses the Downloads classifier: files modified in the last three hours, partial downloads, unknown types, hidden files, directories and code projects are left alone. No cloud model or file-content reading is involved.

**Apply these moves** is the explicit approval for the displayed plan. Previews expire in 30 minutes and can be applied only once. Moves use Relay's exclusive native mover. Conflicts or files changed after the preview are left in place. Organization does not delete anything, overwrite anything, or move across drives.

Undo buttons persist across restarts in Relay's local `workspaceMoves` journal. Failed undo entries remain available for retry; changed files and occupied original names are protected. Keep the folder access entry to retain its undo controls, and reconnect its original drive before undoing. Removing access does not remove the journal or undo moves. The journal records paths, timestamps and file identities, not document contents. Empty destination folders may remain after undo.

## Storage map

Say **“Show me the storage map”**, **“What's filling up my space?”** or **“whats taking up my storage”**, or click **Storage map** in Permissions. These commands run locally regardless of the selected cloud model. Spoken/text storage requests open the map immediately and start scanning an already authorized folder. With no readable authorized folder, a native folder chooser opens; selecting a folder grants read-only access and starts its scan. Cancelling leaves the menu open. The panel’s Choose folder button switches scope directly; Scan manually refreshes it. The panel floats above the reactor, has a draggable title bar, supports resizing and hand movement, and reuses menu momentum/trash-to-dismiss behavior. Dismissing the map never deletes files.

Click a block or folder row to drill down, use breadcrumbs to go back, and use **Show in Finder** or a row's Finder button to inspect an item. The blocks compare the 30 largest items in the selected view; the list includes the rest of the scanned items, 100 at a time. Selected eligible files can be moved to Trash only after a native confirmation preview; permanent deletion and emptying Trash remain unavailable.

Scanning reads local names, types and file sizes, never document contents or cloud services. It runs in a separate worker and can be cancelled. It is limited to 20,000 entries, 24 levels and approximately 15 seconds; a nonresponding drive is stopped after 20 seconds. Symbolic links, protected folders/packages and other mounted filesystems are excluded. Errors and limits produce visibly incomplete results. Cancelling discards the current scan. Maps live only in memory until closed or rescanned.

Reported sizes are logical file lengths, not exact physical space: compressed, shared, sparse and hard-linked files can differ from actual disk usage. Chosen folders show a scoped map. The Entire computer option shows main-volume capacity and a bounded metadata-only filesystem map, with visible partial results rather than claiming a complete disk audit. Finder reveal rechecks the selected root and item identity. A disconnected or changed drive must be selected again; no automatic access escalation occurs.

Validation used temporary fixture files only: native preview/move/undo, storage worker scanning, cancellation, drill-down, Finder-target verification, rejected unrelated-window requests, and narrow/wide native UI checks. The packaged archive's scan worker was also exercised. Actual external-drive hardware, macOS permission prompts, spoken microphone input and hand-camera gestures still require physical testing.

## Natural menu requests

Built-in menus now share keyword detection across voice and typed requests. You can say “my computer is out of space,” “I could use a calculator,” “how is my RAM looking,” “my Wi-Fi is slow,” “how much battery have I got,” “bring up system stats,” or “can I see the activity centre.” Weather requests can appear in longer sentences, including “could you bring up the weather for Paris please” and “how hot will it be in Miami tomorrow.” Weather still needs a city or the configured briefing city.

Storage, weather, calculator, CPU, RAM/memory usage, battery, network, system metrics and Activity Center use existing menus and sources. Requests for multiple topics open separate menus; a weather lookup does not block the others from appearing. Detection is local for both Claude and Codex. Existing Live panels settings and window limits still apply. “Again” repeats the last menu request.

Keywords do not replace instructions to move/organize/delete files, send messages, save memories, change settings, close menus or explain a topic. Cloud-drive requests and connected-drive inventories keep their existing paths. Complex or unsupported requests continue through Relay's existing model/tools rather than being silently reduced to a single menu.

Voice reliability update: wake recognition retains an inline command (for example “Hey Jarvis, open Notes”) instead of discarding it and inserting a separate greeting. A brief handoff window collects words arriving with the wake phrase. Clap gating adapts to quiet-room microphone levels while still requiring two separated impulses and the wake phrase. Playback has a timeout and Stop settles a stuck audio subprocess. Automated audio-lifecycle and synthetic wake/clap tests pass; real microphone, room-noise and output-device behavior still need physical verification.

Memory field focus update: clicking an already-focused text field reactivates the native window and renderer, including after switching apps. Keyboard navigation still activates fields. The isolated native regression reproduced the missing repeated-click activation before the fix, then passed repeated-click activation, typing, draft preservation during a state refresh and saved-memory disk persistence after it. This test used temporary app data and exported no personal memories.

## Network radar

Ask “show my network,” “my Wi-Fi is slow” or “open network radar.” The native panel shows cached ARP neighbors, active local interface addresses, the default route, traffic-counter rates, firewall/FileVault status and TCP services visible to Relay. Select a dot or row to inspect it; recognized labels are stored locally by MAC address. They are convenience labels, not identity verification, and private/randomized addresses may change.

The layout is illustrative, not physical location. Cached neighbors may be offline and may omit devices that have not communicated with the Mac. This is not a complete network discovery or router audit. No probes, packet capture, router changes or network uploads are performed. Firewall and encryption checks are read-only; unknown/failed checks remain visible. Listening services do not by themselves prove internet exposure. Wi-Fi encryption and router security were not audited. Automatic local refresh runs only while the menu is open.

Validation includes parser/error/recognition/routing tests, real passive commands on this Mac, and native wide/narrow UI checks with fixture devices. The live Mac check found the application firewall off and FileVault on; Relay changed neither setting.


## Whole computer, file types and confirmed Trash

The storage selector includes **Entire computer** for a read-only metadata scan of accessible internal areas and main-volume capacity/available/used space. It does not grant the organizer access to `/`, bypass macOS permissions, or promise a complete scan: entry/time/depth limits, hidden folders, duplicate system mounts and separately mounted drives are visibly excluded. Choose external drives explicitly. APFS volume capacity is separate from logical file-size totals.

The default **By file type** view groups actual scanned files into Photos, Videos, Audio, PDFs, Documents, Spreadsheets, Presentations, Archives, Code and Other. Click a box to list its matching files; **By folder** restores folder drill-down. Category bars compare measured bytes, and each box shows file count. Files can remain selected while you move between categories.

Select eligible files and press **Trash selected**, or say **“delete the selected files”** while the storage menu is open. Both paths use the same native preview of exact file paths and default to Cancel. No file moves until that prompt is approved. The backend checks file identity, modification time, current access, symbolic links and scan identity before each move. Files changed after scanning are rejected. System/protected/hidden/package paths cannot be trashed through this view; the computer view limits file actions to eligible personal files. This does not widen organization permissions.

Trash uses macOS Trash and never permanent deletion or emptying Trash. Restore files from Finder's Trash. Cancellation keeps files in place, partial failures are shown, and voice Trash refreshes the menu. Tests used only temporary fixture files with a simulated Trash destination; no personal files or the real Trash were modified during testing.
