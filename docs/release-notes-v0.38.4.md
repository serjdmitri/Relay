# Relay 0.38.4 — integrated God’s Eye

God’s Eye now runs locally through a registered Node runtime; opening its workspace starts the loopback-only server if needed. Missing/failed startup is shown on a blue recovery surface instead of a white rectangle.

The map fills the work area, begins at the whole globe and fades into Jarvis blue. God’s Eye’s real side controls remain available. The existing Jarvis reactor animates to the bottom right and stays visible until the workspace closes, then normal positioning returns. The gear keeps server/reload/browser settings accessible. External map permissions remain isolated from Relay.

Installed setup: separate verified Node 26.13.0, upstream God’s Eye f3adccd, locked npm dependencies without browser download, local runtime registration. No paid keys configured. Details and reproducibility are in gods-eye-integration.md.

Validation: 1,302 Relay tests pass; upstream setup doctor ready; real native Electron server startup, globe/imagery rendering, bootstrap to whole Earth, absent Relay bridge, corner-reactor bounds and restore-on-close checked. External feed completeness and actual voice activation are not exhaustively tested.
