# Undercover · Office Club

A mobile-first multiplayer word deduction web app for 4–10 colleagues. Open a browser, join a room, keep your word secret, and find the outsider. No accounts or app installation.

## Play on the same Wi-Fi

Install **Node.js 22 or newer** on a laptop, then:

```bash
git clone https://github.com/BAKUGOS1/ofc.git
cd ofc
npm ci
npm start
```

1. Connect the laptop and every phone to the same Wi-Fi.
2. Open the **Wi-Fi address printed in the terminal**, such as `http://192.168.1.25:3000`, on the laptop. Do not use `localhost` for an invite: it refers to each phone itself.
3. Create a room, choose a pack, and share its QR code or invite link.
4. Every player opens that link in iPhone Safari or Android Chrome, enters their name, and taps **I’m ready**. The host also marks ready, then starts.
5. Keep the laptop awake and the terminal running throughout the game.

Internet is needed for the initial `npm ci`. After installation, local play has **no external requests, CDN assets, fonts, analytics, or cloud database**. Speech happens in the room; no microphone access is requested.

**Windows:** if no Wi-Fi address is printed, run `ipconfig` and find the Wi-Fi adapter’s IPv4 address. Allow Node.js through Windows Firewall on your trusted **Private** network. Do not disable the firewall. Guest/office Wi-Fi may isolate devices; use an approved network that permits devices to communicate. A browser may ask for local-network permission.

## House rules

- One random player is Undercover. Civilians receive one word; Undercover receives a related word. Roles remain unknown to everyone, including Undercover, until elimination/results.
- Reveal and memorise your word privately. Confirm once you have it. The first clue round starts when everybody confirms.
- Each alive player says one hint out loud, in the displayed order. Clue timers are configurable (30/45/60 seconds). The host can skip a stalled turn.
- Discuss for up to 60 seconds; the host can open voting early.
- Every alive player casts one irreversible, private vote. No self-votes. Voting ends once everyone votes or after 45 seconds; missing votes abstain.
- A tie triggers one 30-second runoff among tied players. All alive players vote again. A second tie, or no votes, eliminates nobody.
- The eliminated player’s role and vote totals are revealed, but surviving players’ words stay private. Eliminated players spectate and cannot vote.
- Civilians win when Undercover is eliminated. Undercover wins by surviving to the final three. **This is a deliberate short office-game variant**, not a claim to reproduce every official rule.
- Winners each earn one point. Scores persist across games in the room. The host can return to the lobby and play another game.

Four original packs: **Office life, Food & drinks, Everyday things, Hinglish mix** (80 word pairs total). No copied artwork or proprietary word lists. This is an independent project, not affiliated with the commercial Undercover game.

## Connection behaviour

Refresh the same tab to recover the same player using an opaque token stored in that tab’s `sessionStorage`. Display names alone cannot claim a player. Opening the same session elsewhere replaces the earlier connection. Words hide when the tab loses visibility or disconnects.

The host role transfers to a connected player when the host disconnects. Disconnected players remain in the game; turn/vote timers prevent those phases from blocking. The reveal phase requires everyone to confirm; if someone permanently leaves there, the host can end the game, remove them from the lobby, and restart. Players can leave or be removed in the lobby. New players join only between games.

Rooms and scores live **in server memory**. Restarting the server clears them. Empty disconnected rooms expire after two hours. Use one server process; horizontal scaling and persistent storage are not implemented.

## Development and tests

```bash
npm run dev    # restart server when source changes
npm run check  # JavaScript syntax checks
npm test       # game rules + real network integration + DOM flow tests
```

The server owns role assignment, timers, phase transitions and vote validation. Per-player state projections omit other players’ words, role assignments and session tokens. User names are escaped before rendering. Requests have size and frequency limits. All dependencies are locked in `package-lock.json`.

- `lib/game.js` — rules, transitions, private state projections
- `lib/words.js` — server-only original word pairs
- `server.js` — HTTP, room/session handling, Socket.IO, QR codes
- `public/` — responsive web client, no build step
- `test/` — automated validation
- `docs/RESEARCH-PLAN.md` — research, design decisions and implementation plan

## Optional internet hosting

Deploy as a **long-running Node.js service with WebSocket support**, using `npm ci --omit=dev` and `npm start`. Configure the platform’s `PORT` variable and optionally `PUBLIC_URL=https://your-domain.example` for QR links. Use HTTPS for internet play. The same link can then work without a laptop or shared Wi-Fi, but requires internet.

A static-only host (including GitHub Pages) cannot run this multiplayer server. This repository is not configured as Vercel serverless functions. No online deployment is included; the GitHub source is ready to run locally or host on a compatible service.

## Verification scope

Automated checks cover private state, host restrictions, readiness, turn order, both win conditions, scoring, invalid/duplicate/self votes, ties, timeouts, HTTP/QR endpoints, real multi-client play, reconnect and host transfer. Browser-device testing on physical iPhones/Android phones and a real office router remains necessary. A cloud-browser preview could not reach the execution environment’s local server.
