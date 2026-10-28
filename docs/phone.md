# Your phone and Relay

Turn on **Settings > Remote > Relay Remote** on the Mac, press **Pair a phone**, scan the code, tap Pair, then in Safari press Share > **Add to Home Screen**.
(Away from home Wi-Fi, install Tailscale on both the Mac and the phone, sign in with the same account, and turn on Tailscale in the same Settings page.
It also gives the phone page the secure address its microphone needs.)

## Quick actions

The big padlock at the bottom of the phone page locks the Mac (open padlock: the Mac is open; closed amber padlock: it is locked; the phone cannot unlock it). The keyboard button in the bottom right corner opens the full-screen hologram keyboard: type, press SEND, and the question stays at the top while Relay answers. The page works sideways too. The row of buttons above the padlock (What's playing, Pause, Play, Next song, Previous, Quieter, Louder, Mute, Focus 25 min,
End focus, Screen off) each send one instant command to the Mac: no model, so they answer at once. You can also open `http://<your Mac>:47900/?say=lock%20my%20mac`
(a bookmark, or a Shortcut's "Open URL") and the phone page sends that phrase as soon as it is up.

## Push to talk from the lock screen

A web page cannot open from a locked iPhone, so the lock screen uses a Shortcut, which can. On the Mac: **Settings > Remote > Save “Hey Siri, Relay” Shortcut**
(the file is made and signed by the Mac), AirDrop it to the phone and tap Add. It listens when you start it, sends what you said to your Mac, and speaks the answer.
Then put it where your thumb is:

- **Lock screen widget** (iOS 16 and later): press and hold the lock screen > Customize > Lock Screen > tap the row under the clock > add the **Shortcuts** widget > choose Relay.
  One tap on the lock screen starts listening.
- **Action Button** (iPhone 15 Pro and later): Settings > Action Button > Shortcut > Relay. Press it to talk.
- **Control Center / lock screen control** (iOS 18 and later): Customize the lock screen's bottom buttons, add a **Shortcut** control, choose Relay.
- **Back Tap**: Settings > Accessibility > Touch > Back Tap > Double Tap > Relay.
- **Hey Siri**: say “Hey Siri, Relay”.

The Shortcut has its own key (a paired “Siri Shortcut” in the list of phones). Unpair it in Settings > Remote to cancel it.
The phone and the Mac must be on the same Wi-Fi, or both on Tailscale.

## Messages when a long job finishes

**Settings > Remote > Tell my phone when a long job finishes.** Two ways:

- **ntfy** (free): install the ntfy app on the iPhone, tap +, subscribe to the topic Relay makes for you. The topic is the only secret.
  Messages go through ntfy.sh (or a server you run: put its https address in the settings file). Only “Done: …” and the first words of your request are sent.
- **iMessage**: Relay texts you from the Mac to your own number or Apple ID. macOS asks once whether Relay may control Messages.

You are told when a request takes more than 30 seconds, and when a background agent finishes. Requests you made from the phone itself are not repeated to it.
