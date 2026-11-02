A fix for the network radar in 0.36.0, which could show no devices at all. Scan network now also lists every device that advertises its name with Bonjour, even when macOS hides your Mac's neighbor list, and tells you how to unhide it: System Settings > Privacy & Security > Local Network > turn Relay on, quit Relay completely, open it again and scan.

The full test suite passes (985 tests). Tried on one real network from a terminal; not confirmed in the packaged app that allowing Local Network brings the neighbor list back.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
