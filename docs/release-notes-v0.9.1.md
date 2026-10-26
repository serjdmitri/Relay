Marking is quieter, clicks are visible, the overlay is out of Mission Control, and Firefox control is much better.

## What changed
- **Marking** shows "Marked" beside the cursor that follows you, not the whole reactor.
- **Mission Control** no longer lists the transparent overlay as a window.
- **Visible clicks:** the helper flies to the spot and a ring ripples before Relay clicks.
- **Firefox extension 0.2:** numbered page elements, scrolling, key presses, reload/back/forward, tab screenshots, background open that waits for the page, closer tab matching, closing by words or duplicates. Tested in a separate headless Firefox.
- **Tabs without the extension:** list and switch tabs through accessibility.
- **Heads up:** Firefox forgets a temporarily loaded extension when it quits. `scripts/sign-firefox.sh` makes it permanent once you add free Mozilla API keys.

Not tested by me: the extension inside your own Firefox (it is not loaded there right now), and the click ripple on a real click.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
