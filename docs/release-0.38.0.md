# Relay 0.38.0

- Fitbit: local step goals/progress, cloud-synced calorie totals and heart-rate ranges.
- Trusted people: named, encrypted local face profiles with macOS owner-authenticated enrollment/removal; webcam recognition only, never macOS unlock.
- Security: top-level local IPC checks, navigation restrictions, protected owner policy, prototype path rejection, Remote request/SSE bounds and content-bound proposal test approval. Electron 45.2.1/build tools updated; 15 moderate build advisories remain.
- Overnight: assigned tasks → planned tasks → proposal checks/local Ollama drafts. Generated changes need a diff review before any tests execute them. Tested commits stay isolated; live app is not self-replaced.
- Maps: movable, isolated Argos and local God’s Eye viewers; no Relay bridge or privileged permissions inside map pages.
- iPhone: separate native MapKit route preview with driving/walking, on-device voice, destination handoff from Relay Remote, ETA and directions. Device signing/install required.

Validation: 1,227 Node tests; native Fitbit goal fixture; native Electron map sandbox/resize fixture; native authentication helper compilation; Swift 6 typecheck, unsigned iOS simulator build and seven intent/deep-link assertions. External account data, real face enrollment, real voice/location, full external map feeds and iPhone device installation remain setup/physical checks. No personal files moved and no paid test calls.

Details: fitbit.md, trusted-people.md, security-review-2026-11-02.md, nightly-maintenance.md, world-maps.md, ../ios/Navigation/README.md.
