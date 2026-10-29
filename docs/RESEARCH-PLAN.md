# Research → plan → implementation

## Goal

An office-safe Undercover-style browser game for colleagues physically together, using their own iPhone or Android phone on the same Wi-Fi. No app-store installation or sign-in. Deliver working source to `BAKUGOS1/ofc`.

## Primary sources reviewed

- [Official Undercover rules](https://www.yanstarstudio.com/undercover-how-to-play): related secret words, unknown identities, description/discussion/voting loop and eliminated players. The full official game supports more roles; this version deliberately uses one Undercover.
- [Socket.IO server initialization](https://socket.io/docs/v4/server-initialization/): attach the multiplayer server to the same HTTP server serving the client.
- [Socket.IO handling disconnections](https://socket.io/docs/v4/tutorial/handling-disconnections/): transport reconnect alone does not restore application state. Restore a player with an opaque session token and resend an authoritative, player-specific snapshot.
- [Chrome local network access](https://developer.chrome.com/blog/local-network-access): local browser access can involve permission and browser-version restrictions. Verify real devices; don’t promise universal router/browser behaviour.

## Decisions

| Requirement | Implementation |
|---|---|
| Safari + Chrome | Plain HTML, CSS and browser JavaScript; touch-size controls; responsive single-column mobile layout |
| Same Wi-Fi, no runtime internet | Laptop hosts Node.js HTTP + Socket.IO on `0.0.0.0`; all assets and QR generation local |
| Easy joining | Six-character random room code, invite URL and QR |
| Confidential words | Server assigns roles using cryptographic randomness; project only the requesting player’s word |
| Quick office break | 4–10 players, one Undercover, final-three house rule |
| Reconnect | Per-tab sessionStorage token; same-player resume; connected-host failover |
| Predictable votes | One vote per alive player, no self-votes; one runoff; repeated tie skips elimination |
| Scope | In-person spoken clues; no voice chat, accounts, cloud database or paid services |

## Build sequence

1. Inspect the repository and research rules/network constraints.
2. Implement and isolate the authoritative game state machine and original word packs.
3. Add HTTP serving, rooms, join/resume, private snapshots, timers and QR invites.
4. Build landing, lobby, private reveal, clues, discussion, voting, verdict and replay screens.
5. Validate rules and real multi-client networking; test the rendered DOM flow where possible.
6. Document local setup, firewall/router constraints, hosting limits and verification limits.
7. Commit and push the tested source to the requested GitHub repository.

## Design direction

A playful office-club dossier: dark charcoal, lime actions, lavender and peach player accents, CSS secret-agent cards. Text, native system fonts and inline/local assets keep it fast and completely local. No personal office questions or employee ranking.

## Vercel readiness revision

The first local-only version used Socket.IO and a process-local map. The deployment-ready version uses a stateless HTTP API plus shared Redis room records and atomic version checks. Current [Vercel WebSocket docs](https://vercel.com/docs/functions/websockets) support WebSockets, but reconnects have no guaranteed instance affinity: keeping durable rooms only in process memory is still incorrect. Short snapshot sync is a deliberate simplification for a spoken, turn-based game.

[Upstash EVAL](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval) executes the room compare-and-set atomically. Redis TTL expires idle rooms without cron. Public output contains only static assets; Vercel routes `/api/*` to a Node function. Real Redis and deployment smoke checks are documented in DEPLOYMENT.md and remain release checks.

UI changes: original SVG agent illustration, invitation-first lobby, guest seats, host-only settings, sticky readiness controls, clear disabled-start reason, automatic private-word hiding, speaker progress, locked vote feedback, smaller spectator UI, keyboard focus management, reduced-motion support and 16px inputs to avoid iPhone input zoom.
