# Undercover · Office Club

A mobile-first word deduction game for 4–10 colleagues. Create a private room, share its QR code, give clues out loud, and vote for the outsider. No accounts or app installation.

## Deploy to Vercel

1. Import **BAKUGOS1/ofc** into Vercel. Use the repository root, **Other** framework, and **Node.js 22.x**. Build/output settings are in `vercel.json`.
2. In the project’s **Storage / Marketplace**, connect **Upstash Redis**. Choose a plan appropriate for your usage. It supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Legacy `KV_REST_API_URL` / `KV_REST_API_TOKEN` variable names are also accepted.
3. Enable the credentials in the intended environment, then deploy/redeploy. A deployment created before adding them must be redeployed.
4. Open `/api/health`: it must return **HTTP 200** and `{"ok":true,"mode":"shared"}`. A 503 means storage is missing or unreachable; the app deliberately refuses to create unreliable in-memory production rooms.
5. Open the site on four separate phones or browser profiles, create/join a room, and complete a game before sharing it widely.

No migrations, public database keys or client secrets are needed. **Redis credentials are server-only.** Never add them to `public/` or commit `.env` files.

The static client is built to `dist/`; `api/index.js` handles `/api/*`. Secret word packs, tokens and backend source are excluded from the static output. Online play needs internet; players can use any network. Being together on Wi-Fi is useful for spoken clues but no longer required for connectivity.

**Environment isolation:** preview deployments use a namespace based on the Git branch, separate from production. Use separate Redis databases for stronger preview/production isolation. Optionally set `ROOM_NAMESPACE` explicitly per environment. Rooms from the same branch share state across its deployments. Set `PUBLIC_URL` only if you need a canonical HTTPS invite origin; otherwise invites use the visited hostname.

This repository is prepared for Vercel; no live deployment or Redis provisioning was performed as part of preparation.

## Local Wi-Fi, without runtime internet

Install Node.js 22 or newer:

```bash
git clone https://github.com/BAKUGOS1/ofc.git
cd ofc
npm ci
npm start
```

Connect every phone and the laptop to the same Wi-Fi. Open the terminal’s **Wi-Fi URL** (for example `http://192.168.1.25:3000`), create a room and share the QR. Do not use `localhost` for a phone invite. Keep the laptop awake and terminal running.

Without Redis variables, development uses an in-memory store. Restarting it clears rooms and scores. Internet is needed for initial installation, but all game assets, fonts and QR generation are local afterward. If testing Redis locally, set variables from `.env.example`, then use `node --env-file=.env.local server.js` (Node does not load that file automatically).

On Windows, use `ipconfig` to find the Wi-Fi adapter’s IPv4 address if the server cannot print it. Allow Node.js on your trusted Private network in Windows Firewall. Guest/office Wi-Fi may isolate devices; use an approved network that permits peer communication. A browser may ask for local-network permission.

## How to play

- Every player joins and taps **I’m ready**. The host chooses one of four original word packs and 30/45/60 seconds per clue, then starts.
- One random player gets a related but different word. Nobody knows their role. Reveal your own word, memorise it and continue. Words auto-hide after 8 seconds and when the tab is hidden. Revealing another player’s word is never part of the client payload.
- Everyone confirms before clues start, or the game moves on after two minutes so a disconnected player cannot block it.
- Take turns giving short hints out loud. Don’t say the word! The host can skip a stalled speaker, and expired turns move on.
- Discuss for up to 60 seconds; the host can open voting early.
- Every alive player gets one private, locked vote. No self-votes. Missing votes abstain after 45 seconds.
- A tie triggers one 30-second runoff among tied players. A repeated tie or no votes eliminates nobody.
- Civilians win by eliminating Undercover. Undercover wins by surviving to the final three. This is our deliberate short office-game house rule.
- Eliminated players spectate. Winners earn one point; scores stay in the room for the next game. The host can end an unfinished game without awarding points.

Packs: **Office life, Food & drinks, Everyday things, Hinglish mix** — 80 original word pairs. Independent project; no affiliation with the commercial Undercover game.

## Reliability and performance

- Authoritative server state is stored in Redis with a **two-hour idle expiry**. Session tokens live in each player’s tab. Refresh the same tab to rejoin; names alone cannot recover a player.
- Redis version checks use a Lua compare-and-set operation: concurrent readiness, joins and votes cannot overwrite each other. Recently processed action IDs prevent duplicate mutation; phase keys reject outdated clicks.
- Short HTTP sync is intentional for this turn-based game: about every 1.5 seconds in-game, 3 seconds in the lobby, and 15 seconds for a hidden tab. No long-running daemon, server interval, WebSocket affinity, pub/sub adapter or cron is needed.
- Unchanged views do not rebuild the UI. Timers render locally using server-clock correction. Secrets auto-hide on tab switches.
- Presence expires after 45 seconds without a successful sync. The host role transfers on the next request when the host is away. Phone operating systems may suspend background tabs; returning to the same tab restores its identity.
- Deadlines are checked on requests. If everyone goes offline, the next request advances the expired phase and gives a fresh deadline for the next phase, rather than silently completing a game with nobody present.
- API data is never CDN-cached. Request sizes, entry attempts and action/sync rates are limited. Names are escaped, cross-origin browser POSTs are rejected and CSP blocks third-party scripts.
- Polling and rate limiting consume Vercel invocations and Redis commands. Check your selected plans and usage; this project does not promise unlimited free hosting.

## Development

```bash
npm run dev
npm run check
npm test
npm run build
```

`npm test` covers game rules, privacy, concurrent clients, stale clicks, idempotency, host failover, HTTP security, Redis adapter command contracts and a full four-client rendered DOM game through replay. CI runs checks, tests and static build.

`Dockerfile` supports a long-running deployment with the same Redis environment variables. It does not replace the Vercel function setup.

## Verification limits

The full flow is tested with real HTTP requests and independent rendered DOM sessions. The Redis adapter is contract-tested with a simulated SDK; a real Upstash instance and deployed Vercel routing have **not** been exercised. Physical iPhone/Android testing, router behaviour and final visual/browser QA remain necessary. The cloud browser could not reach the local execution server in this environment.

See [deployment checklist](docs/DEPLOYMENT.md) and [research and decisions](docs/RESEARCH-PLAN.md).
