# Changelog

## 0.16.0

- **Relay Remote: use Relay from your phone.** A new Settings > Remote page. Turn it on, press **Pair a phone**, scan the QR code (or open the address) in Safari, tap Pair, then Share > Add to Home Screen. The phone page shows your Jarvis reactor: type, or hold the reactor and talk, and your Mac does the work with Claude exactly as it does today. You see PROCESSING, the task bullets and background agents, and the answer comes back as text and speech from the phone (the usage line stays silent). No app, no App Store, no developer account, no reinstalling.
- **Everything runs on your Mac,** so the phone can have it open apps, write notes, read Gmail and Calendar, run background agents and more. It cannot control the phone's own apps. Anything that sends or deletes still asks for approval on the Mac.
- **Security:** nothing listens until you turn it on. Pairing uses a six-digit code that works once for five minutes (five wrong guesses lock it), and each phone then holds a long random token (only a hash is kept on the Mac). Only phones on your own network or Tailscale may connect; anything else is refused. A request from a web page cannot drive it. Unpair a phone any time.
- **Hold to talk** uses the phone's own speech recognition, which needs a secure connection: use Tailscale's https address. On plain home Wi-Fi, type or use the keyboard microphone. **Tailscale helper:** if Tailscale is installed, Relay can make the secure link for you with one button (you also need MagicDNS and HTTPS certificates turned on in the Tailscale admin page). Tailscale is not installed on the Mac I built this on, so that button is untested.
- On plain home Wi-Fi the connection is not encrypted, so the pairing token travels in the clear on your network; pair at home on a network you trust, and use Tailscale away from home.

## 0.15.2

- **The left menu pops out faster.** It opens after resting the pointer on the edge for about a seventh of a second (it was over a third), the pointer is checked twice as often, and the pop-out and tuck-away animations are about twice as quick.
- **A small black tab sticks out of the left edge** (one per screen, level with the middle of it), so you can see the menu is there, like Voice OS. Resting the pointer on the tab opens the menu too, and the tab slips away while the menu is open and comes back when it closes. It never blocks a click.

## 0.15.1

- **Every card result is clickable.** Each option in a list now has an arrow and opens something in your own browser: the link the model gave, else its Wikipedia page, else a web search for it (DuckDuckGo, no account). A single-thing card always has a "Search the web" button next to its Wikipedia link, so you can keep researching on your own. The model is told to leave out a link unless it is sure it is real.

## 0.15.0

- **Answer cards with pictures.** Ask "who is Gustave Eiffel?", "what does the Eiffel Tower look like?", "tell me about Boston" or "show me things to see in Boston", and a black glass card pops out on the right with a picture, a short summary, key facts and link buttons, while Relay says one short sentence. For a list of options (hotels, places, products) the card shows each with a small picture, a line of detail and a link. Click a link to open it, the × or Esc to close it, or let it go by itself after 30 seconds (it stays while you hover). Turn it off in General > Answer cards with pictures.
- **Pictures come from Wikipedia and Wikimedia Commons** (free, with the photographer and license shown under the picture). Relay downloads the picture itself and gives the card the file, so the card never contacts the web. Things without a Wikipedia page, like a local cafe, get a card without a picture.
- **Fix: the Recent menu on the left edge did not appear the first time.** Its page was told to show before it had finished loading, so the message was lost (and a second message went to the wrong channel name, so it never slid out or tucked away properly). It now waits for the page and uses the right channel. Found by running both windows in real Electron.

## 0.14.0

- **Connectors.** A new Settings > Connectors page lets Relay work in your Notion, Gmail and Google Calendar, each connected by you and kept on this Mac (the secrets are encrypted).
- **Notion:** paste an integration token and share pages with it in Notion. Then "search Notion for the trip plan", "read my packing page", "add this to my meeting notes", "make a new page under Projects". Relay only sees what you shared.
- **Gmail and Google Calendar, several accounts:** sign in once per account with your own Google app (the page walks through making one), and Relay talks to Google directly. "Any unread email from Anna?", "read my last email from the bank", "what is on my Google calendar this week?", "add dentist Friday at 3", "draft an email to Sam saying I'll be late". Reading is free, drafts are saved in Gmail without sending, and sending an email always asks you first. With more than one account, reading looks in all of them and writing needs you to say which.
- Background agents can use the read and write tools (Notion, Gmail reading and drafts, Calendar), but never send email.
- I looked at using the claude.ai connectors you already have in Claude, but the Claude CLI only loads them together with all your own settings, plugins and hooks, which would slow every request, so Relay connects directly instead.

## 0.13.0

- **Usage after every ask, never spoken.** A small dim line under the answer: the model, how long it took, tokens in and out, what it would cost at API prices (a Claude plan does not bill you per request), and how much of your Claude 5-hour limit is used. The cost arrives a moment after the answer and is added to the line. It is also kept under each request in History. Turn it off in General > Show usage after each ask. Other model services show the model, time and tokens they report.
- **Speed controls.** Say "use the fast model" (Haiku), "use the smarter model" (Sonnet), "use deep" (Opus) or "use auto", or pick Model Speed in the menu bar. The Account page keeps the same choice.
- **Try again.** "Try again" (or "think harder", "that's wrong") runs the last request once more on the next model up: Haiku to Sonnet to Opus. "Do it again" still repeats it as it was.
- **Answers appear as they are written.** While Claude is writing a long answer, the text shows under the reactor as it comes instead of after it is finished.
- Behind the scenes: Claude's own CLI now reports partial text, usage and plan limits, which Relay reads. Replies are not spoken until they are complete.

## 0.12.0

- **Background agents.** Say "in the background, research the best noise cancelling headphones and save it in a note", or "start an agent to summarize my trip notes". Relay answers at once and the agent works by itself while you keep going. Its progress is in the top right of the screen: what it is on now, how long it has been running, then a short result when it is done (the card goes after 15 seconds, a notification and a History entry stay). "What are my agents doing?" lists them; "stop all agents" or "stop the agent working on headphones" ends them; the menu bar icon has Stop Background Agents.
- **Up to three at once, and they never fight you for the mouse.** An agent cannot see or control the screen and cannot send, delete or run commands. It can search the web, read pages and files you dropped, list folders, read and write Notes, add and read Reminders, and read the Calendar. Each runs in its own Claude process with its own tools (I tested two in parallel with the real Claude CLI: each used only its own tool).
- The main model can also start one when you ask for a big job that needs no screen (it asks you first).
- "Play jazz in the background" is not an agent: only "in the background, …" at the start, or "start an agent to …", is. Agents do not survive quitting Relay.

## 0.11.0

- **Scheduled requests, by asking.** "Every weekday at 8, open my email." "Every Monday and Thursday at 9, play focus music." "Every morning, read me my calendar." "Schedule open my email for tomorrow at 7am." Relay saves it, runs it by itself at that time, and says what it scheduled. "What's scheduled?" lists them, "cancel the email schedule" removes one, "cancel all my schedules" asks first. The model can also schedule something from a looser sentence (it asks you to confirm).
- **A Scheduled list in Settings > Routines:** add one by typing it, turn each on or off, delete it, and see when it runs next.
- **Safe by design:** a scheduled request runs only when Relay is free and the Mac is on. Anything that sends or deletes is declined unless you answer within 90 seconds, so nothing is sent or deleted while you are away. If the Mac was asleep or Relay was closed for more than 45 minutes past the time, that run is skipped and you get a notification instead of a surprise later.
- Plain reminders ("remind me to call mom at 5") still go to Reminders, and one-off requests like "open Notes at 5" are not turned into schedules unless you say "schedule".

## 0.10.0

- **Relay remembers you.** Say "remember that my sister is Anna" or "I'm vegetarian, remember that", and Relay keeps it and uses it in every later request (for example "text my sister" knows who that is). "Forget that I'm vegetarian" removes it, "what do you remember about me?" reads it back, and "forget everything" asks before wiping it all. The model can also save a lasting fact when you state one. It never keeps passwords, card or ID numbers.
- **A Memory page in Settings** lists everything it knows, lets you add or delete facts, forget all, or turn memory off completely.
- The memories live only on your Mac, in Relay's own data, and travel only as part of a request to the model you chose. "Remember to call mom at 5" is still a reminder, and "remember this as morning setup" still saves a routine.
- Fix: the file-drop and the new memory text were not reaching models other than Claude's own app runner; they are now part of every provider's prompt.

## 0.9.1

- **Marking just says "Marked" beside the cursor that follows you,** instead of bringing up the whole reactor. (With that cursor turned off it falls back to the old message.)
- **The invisible overlay no longer shows up in Mission Control** as a window called Relay. (That window is what draws the cursor, the reactor and the left menu; it is transparent and click-through.)
- **Clicks are visible.** When Relay clicks for you, the helper flies to the spot, a ring ripples out, and then it clicks.
- **Firefox, much better.** The extension is now 0.2: numbered buttons, links and fields on every page read (so clicking and typing use a number instead of a guessed selector), scroll, press a key, reload, back and forward, screenshots of a tab, opening in the background and waiting until the page has loaded, switching tabs by words (the closest title wins), closing tabs by words or closing duplicates (asks first, never pinned tabs, at most 25). I tested it in a real, separate headless Firefox: open, read, click, type, submit a form, navigate, go back, scroll, background open, switch, screenshot and close all passed.
- **Tabs work without the extension too:** Relay now reads the tab strip through accessibility, so "what tabs do I have" and "switch to the Gmail tab" work even when the extension is not loaded.
- **Heads up:** Firefox forgets a temporarily loaded extension every time it restarts, which is why it was not connected. `scripts/sign-firefox.sh` signs it with Mozilla (free, unlisted) so it stays; it needs your own add-ons.mozilla.org API keys.

## 0.9.0

- **The reactor stays in the middle while it works.** It no longer flies to the corner: Relay does the task in the background, shows the answer under the reactor, and the reactor goes away once the task is complete.
- **Ask for several things in a row.** While Relay works, tap the ask key and say the next request. They run one after another, and the ones from this round are listed as bullets on the middle left of the screen: the running one bright, the waiting ones dim, the done ones ticked. Esc stops the work and clears the waiting ones. (They run one at a time, not in parallel, so two tasks never fight over your mouse and keyboard.)
- **Interrupt Relay mid-sentence.** Esc, ⌥T or starting to talk stops a spoken reply at once (Esc used to do nothing when the reactor was already gone), and the menu bar icon has Stop Speaking.
- **Dictation learns your words.** After you dictate, Relay reads the same text in the field a few seconds later; a word you fixed by hand twice becomes a word fix in Vocabulary, and a notification says so. Only the changed words are kept, password fields are never read, and General > Learn my words from corrections turns it off.
- **Drop files on Relay.** Drag files or a folder onto the menu bar icon, or onto the Relay window, and it asks what to do with them. The model gets a `read_file` tool that reads text, PDF, Word/RTF/HTML and pictures, and only the files you dropped (they stay available for ten minutes).
- The top right captions from 0.8 are gone; the reactor's own line shows the step it is on.

## 0.8.3

- **Circling is back to the line trail** (the smoke puffs are gone), and the trail is shorter: it fades away about half as fast behind the pointer.

## 0.8.2

- **The reply now sits beside the reactor** in the top left corner, under the status ("COMPLETE"), instead of on the right. The top right keeps your request and the steps while Relay works.
- **Settings follow your Mac's light or dark appearance.** Every colour in the window is now a theme colour, with a clean light version, and the sidebar uses the native macOS sidebar material (the translucent blur you see in Finder and System Settings).
- The Look description in General no longer talks about the old indigo orb.

## 0.8.1

- **Circling now looks like Voice OS:** a smoke of soft blue puffs that follows the pointer, biggest at the pointer and thinning out behind it, instead of a drawn line. (No pen triangle either.)
- **The Recent menu is black and centered on the left edge,** like a Dock, in the same black as the notch. It pops out of the edge and tucks back in like liquid glass: it squashes, blurs and overshoots, with a bright rim and a sheen that sweeps across. Clicks pass through everything around it.

## 0.8.0

- **Recent asks on the left edge.** Rest the pointer on the left edge of the screen and a glass list of what you asked lately slides out (real macOS blur, a soft highlight that follows the pointer, items that swell toward it). Click one to ask it again. Turn it off in General > Recent asks on the left edge, or from the menu bar icon.
- **Circling leaves a comet, not a line.** While you hold the mark key, the stroke is bright where the pointer is and fades away behind it, so the screen stays clean but you still see what you are drawing.
- **If it heard nothing, the reactor just fades away.** After you stop talking it stays in the middle while it checks what it got, and when there was nothing it disappears there instead of flying to the corner with "I didn't catch that". It only goes to the corner once there is a request to work on.
- **The corner reactor glows like the big one.** Its glow used to shrink with it; now it is as bright as in the middle.
- **Captions in the top right while it works.** Your request, the step it is on, and then the answer appear in the top right corner next to the reactor in the corner.

## 0.7.3

- **The volume always comes back.** Relay lowers the volume to 30% while it listens (General > Lower the volume while I talk). It could be left low when listening ended in an unusual way, or when Relay quit mid-listen. Now the original volume is saved to disk before it is lowered, it is put back whenever listening stops by any route, again at launch and at quit if it was left low, and a volume you changed yourself in the meantime is left alone. The switch has a clearer name and description; off means your volume is never touched.

## 0.7.2

- The reactor now appears in the middle of the screen at once, with no sliding. It only slides when it goes from the middle to the top left corner to work. (Before, it could appear to drop in from the top left, because it started from where it was last left.)

## 0.7.1

- The reactor is brighter, with a soft cyan glow and a dark shadow so it reads on a white window too. In the top left corner there is no panel behind it any more, just a shadow behind the reactor and the text. (The dark blue veil behind the big reactor in the middle stays.)

## 0.7.0

- **A big Jarvis reactor in the middle of your screen.** When you ask by voice (Right ⌥, or "Hey Jarvis"), a large arc reactor appears in the middle of the screen, with no window behind it: spinning rings, scanners, tick marks and a core with the name in it. It swells and its bars follow your voice while you talk, shows your words under it, and when you stop it shrinks to the top left corner and keeps working there ("PROCESSING 3s") until the task is done. Then the answer appears beside it, and the reactor swells and throws off sparks while Relay speaks. It is drawn from the look of the reference J.A.R.V.I.S. HUD you attached. Typing a request (⌥T) and Allow / Cancel questions still use the pill, because they need the keyboard or the mouse; General > Look > Classic brings the pill back for everything.
- Typing a request (⌥T) and Allow / Cancel questions now use the reactor too, with a type-in line and two buttons under it, so the pill is gone in the Jarvis look. A 30% dark blue veil sits behind the reactor (the whole screen in the middle, a panel in the corner) so it is easy to see on any window.
- **The pointer buddy is now just an arrow**, like HeyClicky's cursor: a small arrow that follows your pointer (a tiny green dot on it while "Hey Jarvis" is listening) and flies to what Relay points at. Put it away with General > Cursor buddy or the menu bar icon's "Show the cursor buddy". The name in the reactor's core can be changed in General.
- **Move and resize windows.** "Snap this window to the left", "put Chrome on the right half", "move Spotify to the top right corner", "maximize this window", "center Notes", thirds ("right third"), and "other screen". Instant, no model; "undo that" puts the window back. The model can do it too (`arrange_window`). Tested on a real Finder window: placed within one point of the target.
- Flatter Settings and website: no glows, gradient tiles or emoji icons.
- Works with AirPods: when a Bluetooth headset is the default microphone, Relay now listens to the built-in microphone through a capture session, so the headset stays in its high-quality music mode (before, it either failed with "avfaudio error -10868" or dropped into low-quality call mode). If the built-in microphone cannot start, it falls back to the default one.
- Fix: asking by voice failed with "avfaudio error -10868" when AirPods (or another Bluetooth headset) were connected. If the built-in microphone cannot start next to the headset's speakers, Relay now uses the default microphone instead of failing.

## 0.6.0

- **The Jarvis ring is the interface.** The ring now stays beside your pointer all the time (switch it off in the menu bar icon or in General). It moves with your voice while you talk, spins while it works, and pulses while Relay speaks. What Relay hears, is doing and answers appears in a small caption card beside the ring instead of in the pill. The pill still opens for typing a request (⌥T) and for Allow / Cancel questions, which need the keyboard or the mouse. General > Look > Classic brings the old pill back everywhere. The cursor arrow now sits outside the ring.
- **"Hey Jarvis".** Turn on General > Listen for “Hey Jarvis” (or the menu bar icon's switch) and just say it. Relay listens on this Mac with the same on-device speech engine as dictation (nothing is recorded or sent), plays the chime, then listens for your request and ends it by itself when you stop talking. The phrase can be changed ("hey relay"). It is off until you switch it on, it pauses while Relay is busy or speaking, and the orange microphone dot is on while it listens.
- **Remember a task by name.** Say "remember this as morning setup" after Relay does something. Next time you say "morning setup", Relay repeats the exact actions it took, with no model and no waiting. Anything that sends or deletes still asks first. If a saved action stops working, Relay does it from your words and drops the saved actions after two misses. "Forget morning setup" removes it.
- **Better voices** (Speech > More natural voices): pick OpenAI or ElevenLabs voices with your own key (the provider bills you; Relay takes nothing), or an on-device voice (Kokoro, free, no key, Apple Silicon) downloaded on demand. Replies are spoken sentence by sentence so the voice starts quickly, and if an online voice fails Relay falls back to your Mac voice so you always get an answer. The on-device voice is a beta: it has not yet been run end to end by the author, so report anything odd.
- Fix: the menu bar icon stopped changing while Relay listened or worked in 0.3.0 to 0.5.1.

## 0.5.1

- **Mark the screen without clicking.** In 0.5.0 you had to hold the mark key and drag with the mouse, which does not work with Control held (macOS turns Control-click into a right click). Now you hold the key and just move the pointer round what you mean: a cyan trail follows it and fades, and when you let go Relay looks at what you circled. The mouse is never blocked, so nothing is clicked by accident. A pointer that only passes by (under about 28 points across) is ignored.

## 0.5.0

- **Mark the screen.** Hold the mark key (Left ⌃ by default, change it under Shortcuts), circle or scribble over anything on screen with the mouse, let go, then ask about it. Relay looks at that area specifically ("what is this?", "fix this"). A model without image support gets the text in the area instead. The mark stays for three minutes, so you can ask a few things about it. Esc cancels it.
- **A calmer look.** One cyan accent on dark navy everywhere: Settings, the logo and app icon, the pill, the buddy and guides. No purple, no green, no glow. The pill keeps its shape; its cyan accent is two short arcs that follow the pill's own outline.
- **The buddy is a small ring with a cursor triangle.** When Relay draws, the triangle moves along each stroke as it appears, then the label pops in.
- **Fix: drawings and guides sat about 40 points too low.** macOS kept Relay's full-screen overlay window below the menu bar, so marks were shifted down by the menu bar's height. The overlay now sits at the true top of the screen and positions are worked out from where the window really is.
- Settings: General > Look still switches between Jarvis (cyan) and Classic.

## 0.4.0

- **Jarvis look (new default):** a cyan HUD. The buddy is a rotating ring reticle (it pulses while listening, spins faster while thinking and closes into a check when done); the pill pops up with HUD corner brackets, a status readout (LISTENING, WORKING, COMPLETE) and a scanning bar; guides show as a HUD panel with a progress bar; drawings, rings and labels are cyan. Switch back under General > Look > Classic.
- **Guides are far more reliable.** Looking up an element used to go through System Events, which took 30 seconds or timed out in Notes, the Claude app and Xcode. A new native helper (`relay-ax`) walks the accessibility tree directly (0.2 to 0.6 seconds) and wakes up Electron apps' accessibility. If an element has no accessibility name, Relay now reads the text off the screen (Apple's on-device text recognition) and points at that.
- **Guides check what you do.** The highlight stays on until the step is done and follows the element if you move the window. Clicking the highlighted spot (or saying "next") moves on; if the next thing is not there, the highlighted element disappears, or you click somewhere else, Relay looks at the screen and rewrites the remaining steps.
- `ui_list` is much faster too (the same helper).

## 0.3.1

- Guides now move on by themselves. Relay outlines the element for the current step, and when you click it (or say "next") it goes to the next step and outlines that one. Before, "next" was heard as a new request (it skipped a Spotify song) and the model had to be asked again for every step. While a guide is up, "next", "back" and "stop" are for the guide; "next song" still goes to the music commands.
- Guides and drawings always show something on screen: an outline around the element, or a ring around a spot. `draw_on_screen` can now outline an element by app and name, exactly, with no screenshot, so it works with text-only models too.
- Buddy cursor: smaller, closer to the pointer, and the spinner is now centered on the orb.

## 0.3.0

- Buddy cursor: a small helper follows your pointer while Relay listens and works (a mic meter, a spinner, then a check), and flies to what it points at. New setting: General > Buddy cursor.
- Show me: Relay can point at an exact on-screen element (`point_at_element`, from the accessibility tree, so it works even with models that cannot see images), draw boxes, circles, arrows and labels (`draw_on_screen`), and walk you through a task with a step card (`guide_step`; say "next" to go on). Marks stay about 30 seconds or until you press Esc or start a new request.
- On-screen marks and the buddy work on every display, and screenshots now capture the display you are on. The buddy and marks are hidden while a screenshot is taken so the model does not see them.
- Docs and site: the main pitch is now "No API key: it runs on the Claude plan you already have" (through your own Claude Code). API keys and Ollama are options. No app changes.

## 0.2.0

- More model services: OpenAI (ChatGPT API), Google Gemini, Groq, Mistral, xAI, DeepSeek and a custom OpenAI-compatible address, each with its own key and model. Pick one under Account > Model service.
- Calmer look: a neutral gray interface with one indigo accent. Each page tints only the soft glows at the top and bottom of the window and the selected sidebar item; the rest of the sidebar stays gray.
- The sidebar can be collapsed to the left (button in the top bar, or ⌘\) to give the page the whole window. Relay remembers the choice.
- README, website, diagram, charts and screenshots updated to match. 136 unit tests.
- No change to how Sign in with Claude works. It stays an unsupported, personal-use path (see the README).

## 0.1.1

- New colourful app icon and in-app logo, and the interface accent colour is now the logo's indigo instead of blue.
- Website at https://serjdmitri.github.io/Relay/ (served from `docs/`), with live download links.
- README: screenshots, architecture diagram, charts, and a note on how the model options work.
- `npm run shots` works with the current interface and finds Chrome on macOS; new `npm run charts` and `npm run readme-images`.
- No change to how the app signs in or picks a model.

## 0.1.0

Distributed as ad-hoc signed `.dmg` files (arm64 and x64) built by GitHub Actions. Needs macOS 26 or later.

First public version.

- Ask pill: Right Option (tap or hold) to talk to Relay, `⌥T` to type a request, Esc to cancel. A pill that drops out of the notch, with real glass on macOS 26.
- Built-in on-device dictation (Apple SpeechAnalyzer through a small Swift helper): Right Command types what you say where your cursor is. Spoken "new line", "new paragraph" and "scratch that", word fixes, per-app dictation style, dictation history. Talkify is no longer required.
- Instant commands with no model call: open and quit apps, URLs and web search, music and media keys, timers and alarms, reminders and notes, volume, brightness, dark mode, lock screen, time and battery. "Undo that" and "do it again".
- Claude through your own signed-in Claude Code (local tool server on 127.0.0.1) with automatic Haiku/Sonnet routing, or an Anthropic API key, or a local Ollama model.
- Agent tools for apps, files, Finder, Notes, Reminders, Calendar, Messages, key presses, menu clicks, accessibility-tree clicks, screenshots, clipboard and selection, web search and fetch, AppleScript and shell.
- Confirmation card before sending messages, trashing files, running shell commands or destructive-looking AppleScript.
- Relay cursor overlay that glides to the target before a click. Routines. Optional spoken replies.
- Optional Firefox extension for tabs, page reading, clicking and typing (localhost only, extension origin only).
- Window with Home, History (requests, actions, dictation), Routines, Vocabulary, General, Account, Speech, Shortcuts and Permissions, plus a first-run flow.
- 129 unit tests.

Known gaps: live microphone dictation end to end, music control, permission prompts and some AppleScript flows have only been tried by hand. The end-to-end script and screenshot script predate dictation and the Claude sign-in. Claude account sign-in is for personal use only (see the README).
