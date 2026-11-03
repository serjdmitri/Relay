# Integrated God’s Eye workspace

Say “open God’s Eye view”. Relay starts the registered local engine if necessary, waits for a healthy God’s Eye page, and opens a full-work-area workspace. The real globe begins in whole-Earth view, blends into Jarvis blue at the edges and keeps the source’s side controls. The existing Jarvis reactor animates to the bottom right and stays there until the workspace closes. Use the gear for the local server URL/reload/browser fallback. Closing restores the usual reactor behavior.

The downloaded God’s Eye source is a separate upstream checkout, not copied into Relay's source bundle. For this setup it is at `~/Downloads/relay/gods-eye-view`, pinned to upstream commit `f3adccd01af410519324d516a0cac276af98f085`. Its source/data licenses and attribution are preserved. Provider features still depend on their own access and availability; no paid keys were configured.

Runtime setup on this Mac:

- Separate official Node 26.13.0 arm64 runtime under `~/Library/Application Support/Relay/integrations`; the system Node was not changed. Official download SHA-256 was verified: `d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6`.
- Upstream locked dependencies installed using `npm ci --ignore-scripts` with `PUPPETEER_SKIP_DOWNLOAD=true`; no extra browser was downloaded. Checkout plus dependencies occupy about 722 MB.
- `scripts/configure-gods-eye.cjs /absolute/repo /absolute/node` registers paths in a local, owner-only `gods-eye-runtime.json` under Relay's application data. That file is not committed and contains no keys.
- Relay launches the registered Vite CLI on `127.0.0.1:4173` with strict port selection and a minimal environment. It never inherits Relay provider credentials. It reuses an already healthy server rather than launching duplicates and stops its own child on Relay exit. A custom server address must be started separately.

The visual skin and first-view integration are applied only in the isolated local map renderer. No Relay bridge, filesystem API, Node integration, microphone or location permission is exposed there. Source attribution remains visible. The transition preserves upstream map controls rather than pretending feed data belongs to Relay.

Verification: upstream setup doctor passed; actual server startup and live Esri/Cesium imagery rendered in an Electron native window; native checks confirmed the globe reset, isolated map bridge and corner reactor. Startup errors no longer show an empty white rectangle. Unit coverage includes healthy-server reuse, concurrent startup, loopback/strict-port selection, missing runtime and credential-free process environment. Physical voice activation and every external feed are not exhaustively verified.

## Natural commands

“Closest camera”, “next camera”, “show cameras in London”, “show flights over Miami”, “show satellites”, “show earthquakes”, “show ships near London”, “fly to Tokyo” and “zoom out” route directly to the local globe, identically for Claude/Codex. They reuse upstream God’s Eye actions, not its paid voice session. Nearest means nearest to the current map view or the named place, not GPS location. Only available public cameras are considered; missing catalogs/feeds are reported as failures. Local/private mode still blocks online layers. Stop cancels an active command.

Native checks successfully flew to London, enabled live flights and selected the public camera “Old Kent Rd/Preston Cls”. This verifies selection/control, not uninterrupted availability of every public feed.

### Desktop globe and side controls

God’s Eye now occupies a frameless transparent workspace. At Earth-scale zoom, space outside the globe is transparent and clicks there pass through to the desktop. Zoom toward Earth to blend into the full-screen map; zoom out to return. The Jarvis reactor remains bottom-right. Credits remain visible.

Use the small **gear** at top-right, then **Side controls** to choose **Show on hover** (default) or **Always visible**. Hover or focus the Layers/Context edge tabs to reveal controls. The setting persists across launches. Expanded panels keep upstream controls and scrolling, with rails inset to avoid clipped tabs. The × closes the world workspace.

The remote view has a dedicated sandbox preload that enables transparent WebGL at context creation and forwards only visual layout/settings/close messages. It exposes no Relay APIs, credentials, microphone, location, filesystem or general IPC. Main-process handlers accept only that view's main frame. Private/local model mode still disables online maps.
