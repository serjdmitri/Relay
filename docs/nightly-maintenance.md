# Overnight maintenance

Settings → Shortcuts/automation → Overnight tasks: save up to three planned tasks and an optional maintenance plan. The overnight window must be enabled; Relay and the Mac must remain awake. Assigned tasks run first, planned tasks second, then maintenance once per window. Existing unattended approvals still apply; uncertain/interrupted mutations are reported for review rather than replayed.

Maintenance checks up to three existing source proposals. Passing reviewed work becomes an isolated branch commit. Changed content invalidates a test pass. It never merges, pushes, installs or restarts Relay automatically.

Optional local improvement: set the absolute source checkout, one JavaScript file under src/main or src/renderer (under 32 KB), and a short instruction. Your existing local Ollama configuration generates one bounded replacement. Relay validates it against the original, writes only into a separate proposal worktree and records the reason. Generated code is NOT executed until you review its diff in Settings and explicitly approve testing. This review is necessary because running generated JavaScript tests gives that code process access; a prompt is not an isolation boundary. After approval, the next overnight check can test and commit it. No cloud fallback or model download occurs.

The status/report remains in Relay state and is exported through the existing local output exporter when available. Say “what happened overnight” for the usual morning report. A run interrupted after its durable start marker is left for review; it is not silently repeated that night. There is no automatic rollback of the running app because it is never changed.

Verified with fixtures: order/once-per-window logic, failed-test commit refusal, interrupted-run handling, generated draft review requirement, and one replacement confined to a temporary proposal. No live model request, overnight physical sleep/wake cycle or personal source modification was performed during these checks. Configure a local model and source checkout to use drafting.
