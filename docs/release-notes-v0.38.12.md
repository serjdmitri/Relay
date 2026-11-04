# Relay 0.38.12

The reactor restores its current state after an overlay renderer reload and retries unexpected renderer termination with a bounded recovery budget. Closed overlay windows release their border timers, and late border geometry callbacks ignore destroyed windows, fixing the reported “Object has been destroyed” exception.

A separate Electron diagnostic confirmed the idle reactor returns after forced renderer termination. Automated regressions cover state restoration, recovery limits, and destroyed-window cleanup. Claude’s latest pushed trusted-person, enrollment and call-provider changes were already included in the combined main branch; no additional unmerged remote changes were found.
