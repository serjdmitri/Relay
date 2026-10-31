# Navigation component

This is an iOS 17+ SwiftUI route-preview component. It searches for places and requests a driving route from MapKit after the user chooses a result, using a coordinate supplied by its caller. It does not provide live navigation, rerouting, background location or spoken turns.

Relay Remote is currently a web app. `ios/RelayNavigation.xcodeproj` is a standalone native route-preview target; it is not yet connected to Relay, voice intent or pairing. The entry view requests location only after a tap, and the target supplies `NSLocationWhenInUseUsageDescription`. Do not treat a successful build as a device test.

For an SDK-only check on a Mac with Xcode installed:

```sh
xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios17.0-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" ios/Navigation/*.swift
```

To build the unsigned simulator app without installing it:

```sh
xcodebuild -project ios/RelayNavigation.xcodeproj -target RelayNavigation -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO SYMROOT=/tmp/relay-navigation-build/Products OBJROOT=/tmp/relay-navigation-build/Intermediates build
```
