# Relay 0.38.6

- God’s Eye globe floats over the desktop with transparent space; approaching Earth fades into a full map, and zooming out restores transparency.
- World view has no rectangular title frame. The reactor remains bottom-right; credits stay visible.
- Side controls can stay visible or reveal on hover/focus using the new gear setting. Fixed clipped rail tabs and kept controls within the viewport.
- Natural camera, place and layer commands route directly to the map for either Claude or Codex. Public camera availability depends on the source; nearest means relative to the current map view or named place, not an inferred physical location.
- Includes the 0.38.5 startup checks and earlier combined updates.

Verified with the real local engine in Electron: transparent WebGL, globe/terrain zoom transition, hover and pinned controls, settings bridge, place/layer/public-camera actions. Remote-page bridge isolation and the full automated suite also checked. Voice hardware and every external feed were not retested.
