Cut sections that turn with the model, no more rough photo-made 3D guesses, a homework helper, and answers that stay on screen.

## What changed
- **Cut sections turn with the model.** Switch the cut on (or change its axis) and the plane is tied to the model, so it turns with the piece; before, turning the model slid the section through it.
- **No more rough 3D guesses.** When there is no real model, Relay now shows a card with up to 3 of the clearest real pictures plus YouTube searches (overview, reviews, close-up or teardown) instead of a photo-made approximation. Ready-made Wikimedia models, and results from your Hugging Face token, still show as holograms. To bring the old behaviour back, set `settings.models3dApprox` to `true`.
- **Homework helper:** select an assignment and ask for a plan, the hard parts, or help with it.
- **Answers stay on screen** until you dismiss them (OK, Esc or the next request).

Not tested against the live Wikimedia and YouTube services, or on a real Mac.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
