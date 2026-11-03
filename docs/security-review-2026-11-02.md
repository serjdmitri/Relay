# Security review — November 2, 2026

Scope: local Electron frontend/preload/main-process boundaries, camera identity enrollment, Remote HTTP API, encrypted credentials/public state, file organizer guardrails, plugin host, proposal verification and npm dependency advisories. This is a source review and automated regression pass, not an independent penetration-test certification.

## Fixed

- Privileged IPC now rejects remote URLs, traversal, non-HTML resources and child frames. Windows with preload cannot navigate or attach webviews/popups. Existing panel-specific ownership checks remain.
- Generic settings cannot edit owner-recognition policy, calling permissions or allowed file roots. Only Settings/onboarding windows can use generic settings. Disabling Presence while owner recognition is on requires macOS owner authentication.
- Storage paths reject prototype/constructor segments; previously a crafted settings path could modify inherited objects.
- Camera recognition/enrollment messages are accepted only from the current camera webContents. Face templates are excluded from public state.
- Remote requests have a bounded per-address rate limit (240/minute) and bounded SSE connections (4/device, 32 total), with no-sniff, no-referrer and frame-denial headers. Existing hashed tokens, pairing lockout, custom request header, device revocation and private-address restrictions remain.
- Proposal test approval now binds to file content, including untracked regular files, rather than just dirty filenames. Files changing during a test invalidate it. Oversized or nonregular untracked content fails closed.
- macOS plugins now use the existing sandbox-exec profile when available; their environment already strips API credentials. This profile is coarse: declared network access permits networking generally, not per-domain enforcement.
- Updated Electron from 33 to 45.2.1 and electron-builder to 26.18.0. Audit afterward: zero high/critical advisories; zero production-library advisories. Fifteen moderate build-chain findings remain, all from the minimatch <11 dependency chain. npm's suggested remediation is a major downgrade, so it was not applied blindly.

## Verified / limitations

1,221 tests passed after fixes. Targeted IPC, owner/profile, Remote and content-fingerprint tests reject the malicious or interrupted cases. Native authentication helper compiled. Signature-based scan of tracked source/native/scripts found no matching private keys or common API-token signatures; this cannot prove no secret exists in every format or historic commit.

File organization reuses selected-root realpath checks, no symlink moves, preview, source identity checks and exclusive moves; it does not erase drives or empty Trash. No personal files were moved in testing.

Remaining risks: generic IPC is restricted to local top-level app pages but is not yet a per-panel capability allowlist for every channel. A compromised approved plugin can still be dangerous; sandbox-exec is deprecated and filesystem/network declarations are not a complete isolation boundary. Remote plain HTTP on a LAN is not confidential against network observers; prefer the existing HTTPS Tailscale path and avoid untrusted Wi-Fi. Webcam recognition is not secure biometric authentication or macOS unlock. No authenticated external service, paid call, real face enrollment or adversarial network scan was exercised. Moderate build dependencies need upstream remediation. New Electron runtime must pass native smoke/build checks before installation.
