Everything since 0.35.1: a network radar with a **Scan network** button that finds and names the devices on your Wi-Fi, phone calls with Bland, a storage map, floating menus and weather, local voice, a welcome-back briefing, and a long list of fixes.

The full test suite passes (984 tests). Most of it has not been tried on a real Mac by voice, by hand gesture or from a phone. For the network radar, allow Relay under System Settings > Privacy & Security > Local Network if it shows no devices.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build this time: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
