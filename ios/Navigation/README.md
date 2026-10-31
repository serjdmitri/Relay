# Navigation component

This is an iOS 17+ SwiftUI route-preview component. It searches for a place and requests a driving route from MapKit using a coordinate supplied by its caller. It displays the first search match, so the user must verify the destination. It does not provide live navigation, rerouting, background location or spoken turns.

Relay Remote is currently a web app. These files are not yet wired into a native iPhone app, voice intent, location permission flow or pairing. A native app target with a location usage description and a user-approved location flow is required before this can run on a phone. Do not treat a successful typecheck as a device test.

For an SDK-only check on a Mac with Xcode installed:

```sh
xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios17.0-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" ios/Navigation/NavigationModel.swift ios/Navigation/NavigationView.swift
```
