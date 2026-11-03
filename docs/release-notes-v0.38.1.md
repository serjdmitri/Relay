Everything since 0.38.0: six features inspired by OpenJarvis (a Stanford local-first personal AI project), each checked against its own code and tests.

- **Injection shield:** text Relay reads from outside (web pages, search results, email, notes, Notion, calendar, clipboard) is scanned for wording aimed at an AI. If found, the model gets a notice and risky actions ask first. Keys, tokens, passwords, card and ID numbers are blocked from leaving through a search or page fetch. "What did the shield catch?"
- **Import skills from GitHub:** "import skills from github.com/owner/repo" brings in agentskills.io skills as playbooks, text only, scanned, pending until you approve them in Settings > Memory.
- **News, GitHub and Obsidian (read-only):** "what's on Hacker News", RSS feeds ("add news feed …", "my news"), "my GitHub notifications" (through `gh`), "find my Obsidian vault", "my recent Obsidian notes".
- **Deep research:** "deep research on X" runs a background research method, searches your own notes first, saves a Note with numbered sources, and checks afterwards that every cited link was really opened or seen.
- **Search by keyword and meaning:** "search my notes for X" covers memory, session notes and your Obsidian vault; with Ollama and `nomic-embed-text` it also searches by meaning.
- **Safer feeds:** RSS feeds are fetched with private-network, DNS-rebinding and redirect checks.

The full test suite passes (1290 tests). None of it has been tried against the real network, Ollama or your own notes yet.

## Requirements
**macOS 26 or later.** Apple Silicon (`arm64`) build attached below. There is no Intel (`x64`) build: the native helpers must be built on an Intel Mac. The app is ad-hoc signed, so the first time you open a downloaded copy, right-click it and choose Open.

Full list of changes: [CHANGELOG.md](https://github.com/serjdmitri/Relay/blob/main/CHANGELOG.md)
