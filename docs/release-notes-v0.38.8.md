# Relay 0.38.8 — latency fixes

- Keep only explicitly prepared short local greetings/acknowledgements as private WAV files in `~/Library/Application Support/Relay/voices/fixed-phrases`. Ordinary replies, conversations and audio input are not added to this cache. Rate, engine and voice select separate cache entries. All four day-part greetings are prepared in advance so crossing midnight does not cause a cold morning voice.
- Local speech no longer decrypts unrelated cloud-provider keys on every request. A missing quick greeting still uses the existing Mac-voice fallback instead of waiting for slow synthesis. No background cloud requests.
- God’s Eye readiness follows the actual engine rather than a fixed four-second gate. Initial globe positioning no longer starts a camera flight that can override the next command.
- Reuse the in-memory browser cache across map opens. A closed world is retained hidden for up to two minutes for quick reopening, then destroyed; quitting Relay destroys it immediately. This does not enable persistent browser storage or broaden permissions.
- Poll local-server readiness every 100 ms instead of every second and share in-flight starts.

## Measurements on this Mac (Apple M5, 24 GB)

Short OmniVoice greeting: cold synthesis 9,468 ms, warm synthesis 911 ms. Restarted Speaker with prepared audio: 1.06 ms to dispatch audio to the player (not a measurement of speaker hardware or audible output).

God’s Eye: baseline 6,176 ms to command-ready with an already running engine; changed runs 3,105–4,159 ms. Reopening a retained window dispatched in 0.62 ms without recreating its page; this does not measure display refresh or live-feed freshness. Map imagery and feeds still depend on their services. Concurrent GPU-heavy native test runs were unreliable; successful comparisons ran individually.

1320 automated tests passed, including durable greeting reuse/rate mismatch, no background cloud synthesis, engine readiness and server concurrency. Real local map place/layer/public-camera actions were also checked. Physical unlock-to-audible timing is not verified.
