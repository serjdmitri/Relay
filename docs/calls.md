# Phone calls

Bland is an external, separately billed AI calling service. This integration does not use a ChatGPT/Claude subscription or Relay's local OmniVoice model for phone audio.

The core uses Bland's official [Send Call](https://docs.bland.ai/api-v1/post/calls), [Account Details](https://docs.bland.ai/api-v1/get/me), [Call Details](https://docs.bland.ai/api-v1/get/calls-id) and [Stop Active Call](https://docs.bland.ai/api-v1/post/calls-id-stop) endpoints. Account testing reads account status and does not dial. Recording is explicitly disabled, but Bland can still retain call records and transcripts under its own policies. Report/transcript retrieval is explicit and not executed as Mac commands or imported into personal memory.

Calls target only the owner number configured locally. Each call requires a fresh review of its exact number, purpose and duration. Nothing dials merely because it was prepared or scheduled. The agent introduces itself as AI, asks before discussing private details, hangs up on voicemail, and receives no tools, transfer target, webhook, credentials, or automatically collected email/file content.

Default limits are two minutes per call, two calls per day and ten reserved minutes per day; duration can be configured up to five minutes. These are local call/minute limits, not a guaranteed dollar spending cap. Set account billing limits in Bland. Ambiguous outcomes reserve their full duration, block new calls and require provider-dashboard review; they are never automatically retried. State is flushed before an outbound request. Interrupted submissions become uncertain after restart.

Quiet hours and local/private mode prevent dialing. Each scheduled occurrence advances durably before creating one review request. Reviews expire after 15 minutes; check-ins missed by more than 45 minutes are skipped rather than unexpectedly run on wake. Relay must be running and awake to offer a scheduled review. Ending an active call sends Bland's stop request; a running provider-side call can continue if the Mac sleeps or Relay exits, up to its maximum duration.

Implementation tests use a fake provider and fictitious phone numbers. No live call has been placed. Core API, approval and scheduling tests pass; the UI and application integration are the next implementation step.
