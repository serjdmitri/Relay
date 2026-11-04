# Relay 0.38.11

Wake recognition now recovers from the actual speech helper error-event and preserves a final wake command that arrives before the partial-transcript handoff timer. A final recognition revision without the wake phrase cannot execute an earlier guess. Claps-only activation no longer depends on a nonempty wake phrase.

Verified: all 1,362 automated tests pass, including final-transcript delivery exactly once, rejected final revisions, and phrase-independent claps-only mode. Actual room-noise/clap recognition remains a physical microphone check.
