# Jarvis native iPhone navigation

Open `ios/RelayNavigation.xcodeproj` in Xcode, choose your signing team and connected iPhone, then Run. The app is separate from the existing Relay Home Screen web icon. Device signing and iPhone permission prompts require you. No App Store submission is required for a development-device build; provisioning limits depend on your Apple account.

1. Tap **Use my location** (explicit when-in-use access).
2. Type a destination or tap **Speak destination**, say “take me to NSU University School”, then pause or tap Send. Choose a matching place to avoid silently routing to the wrong result.
3. Choose driving or walking, then select the place. The map stays inside Jarvis and displays a route line, ETA, distance and maneuver list. Voice-originated requests receive a British English system-voice summary where available.
4. Change travel mode to recalculate the selected route. **Start in Apple Maps** opens live navigation in Apple Maps. Refresh location, Cancel, End route or Cancel voice stop the relevant work. Backgrounding the app stops recording and speech. Recording is bounded to 30 seconds, with a 1.4-second pause to send.

From Relay's phone web page, a typed or spoken navigation request offers **Open Apple Maps** (usable immediately) and **Preview in Jarvis Navigation** (requires this native app). Both pass only the destination and transport. The native link uses `relay-navigation://navigate?destination=...&transport=driving`. The native link does not transmit the Mac/phone pairing token, and this screen needs no paired Mac. It also works as an Open URL action in a user-created Siri Shortcut. Ambiguous destinations still require selection.

Speech recognition is explicitly on-device. If the current language/device does not support it, the app asks you to type; it does not silently upload audio. Native speech output uses the iPhone system voice, not Mac OmniVoice. Map search/routing and map tiles use Apple services, including the requested origin/destination. This app is not wholly offline.

This is a route preview, not live turn-by-turn navigation. It does not track maneuvers, reroute in the background or replace a dedicated navigation app while driving.

Verified: unsigned iPhone-simulator build with Xcode (BUILD SUCCEEDED), seven parser/deep-link assertions, and launch in the installed simulator runtime. The deep link reached the iOS “Open in Jarvis Navigation?” prompt; this Xcode installation has no Simulator app window for interacting with it, so actual Apple route response remains unverified. iPhone microphone/location permission, system voice and physical-device installation still need device testing. No simulator runtime was downloaded.
