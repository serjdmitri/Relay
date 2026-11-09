# Review fixes — November 9, 2026

Combined with the latest owner-guard work on main. Changes were committed separately.

- Preserve sleep-restoration state and the watchdog until recovery succeeds; retry failures and check the shutdown result.
- Count every new/renamed proposal file, reject binary/symlink/submodule changes, actually remove rejected generated worktrees, and display the complete review or refuse oversized diffs.
- Generate overnight changes through bounded worktree-only file tools, using the existing strict Claude session (no built-in tools, inherited settings/hooks/MCP or session persistence). Strip unrelated environment credentials, cap turns/runtime, and stop cloud generation in private mode. This constrains model tools; it is not a claim of full OS-level isolation of the trusted CLI or of user-approved tests.
- Propagate battery/thermal cancellation to active scheduled work, tests, local review and cloud generation. Skip unsafe awake holds rather than running the job anyway.
- Give God's Eye startup a wall-clock deadline, cancellation and bounded health reads.
- Bind Firefox requests/results to the connection that owns them, including disconnect/shutdown cleanup.
- Bound Google Drive previews, preserve useful truncated content, enforce deadlines and support cancellation. Parse bounded MCP streams incrementally so a completed reply does not wait for connection closure.
- Move directory metadata scans into a cancellable worker with entry/time limits.
- Keep cancelled queued speech out of OmniVoice; bound its queue and prioritize replies over warming without unloading the model on every interruption.
- Share secure defaults across six utility menus while retaining each feature's geometry and behavior. Add slow-tail (95th percentile) latency reporting.
- Resolve the minimatch build-tool advisory through a scoped override, preserve older incompatible major versions for their existing consumers, and add clean regression CI on pushes/PRs.

Validation: 1,512 tests passed after merging the latest main; fresh `npm ci --ignore-scripts`; zero known npm audit vulnerabilities; JavaScript syntax and whitespace checks; updated minimatch matching and Electron Builder consumer loading checked. Regression tests cover the reproduced failures with temporary repositories, fake workers and injected power/network failures. No personal file operations, real power changes, cloud generation, calls, live account writes or app installation were used as tests.

Physical voice/wake/camera/iPhone behavior still needs device testing. Active OmniVoice generation can finish before a fresh request starts; queued cancelled work is now omitted. A complete process sandbox, Firefox installation-bound authentication, per-device phone permission redesign, and decomposition of the entire main/controller modules are broader follow-up work, not claimed complete by this patch series.
