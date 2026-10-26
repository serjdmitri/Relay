Realistic holograms: researched, and made from real photos.

## What changed
- **No more cubes for real things.** For a specific thing (a VEX robot, a car, a building) Relay researches what it looks like, then uses a ready-made real 3D model if one clearly matches, otherwise **turns a real photo into a realistic textured 3D model**, and builds from shapes only for abstract things and diagrams, with no labels unless you ask.
- **Tested on a real VEX robot photo:** a recognizable VEX robot (wheels, metal frame, red and blue pieces) in about 4 seconds.
- **Options are real choices:** the arrows step through ready-made models and models from other photos. Each model is made once and cached.
- **Looks:** real colors, drawn solid with the hologram glow and scanlines over them.
- **Honest limits:** one photo means hidden sides are guessed. The free Hugging Face service can be busy or out of its daily limit. Off switch in General.

Tested against the real services (Commons, Wikipedia, Stable Fast 3D) and rendered in real Electron. Not tested by me: asking for it by voice in the app, and a request when the free service is out of quota.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) and Intel (`x64`) builds are attached below.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
