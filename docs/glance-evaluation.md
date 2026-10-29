# Glance evaluation for Relay

Reviewed Glance commit `b97f521397ec1197ba17768ba797cae1e628848d`.

Glance is a separate macOS application with on-device face enrollment, ArcFace matching, liveness checks, an opt-in authorization session and lock-screen detection. It stores an encrypted macOS password and uses Accessibility to type that password at the lock screen. This is not Apple's Face ID: Glance's own documentation says that ordinary Mac cameras lack depth hardware and that it does not reliably defeat replayed video.

Relay currently counts faces for presence and can optionally lock when nobody has been seen for a configured period. It does not recognize an enrolled identity or unlock the Mac. Glance's session auto-lock expires its credential authorization; it is not evidence that the Mac locks when an unknown face appears.

Glance code is MIT licensed, but its conversion script identifies InsightFace `buffalo_s` weights. InsightFace states that its distributed trained models are for non-commercial research, with separate licensing for recognition models. Confirm the license and provenance of the exact model before copying or distributing it. Do not assume the Glance code license applies to model weights.

Before any integration, assess camera sharing with Relay Hands and Presence, secure biometric enrollment and deletion, liveness and spoof limitations, credential handling, lock-state verification, false matches and denials, permissions, and recovery. Prefer keeping Glance's password and encryption keys inside Glance rather than giving them to Relay. No integration or claims of secure face unlock are made by this evaluation.

Sources: https://github.com/jonnyoo/glance and https://github.com/deepinsight/insightface#license.
