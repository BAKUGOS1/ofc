# Vercel deployment checklist

## Import settings

| Setting | Value |
|---|---|
| GitHub repository | BAKUGOS1/ofc |
| Root directory | repository root |
| Framework preset | Other |
| Node version | 22.x |
| Install | npm ci |
| Build | npm run build |
| Output | dist |
| API entrypoint | api/index.js |
| API duration | 15 seconds |

`vercel.json` owns the build, routing and security settings. Do not select the `public` directory as the project root, or deploy only the static files: multiplayer needs the API.

## Required server variables

Install Upstash Redis through Vercel Storage/Marketplace and connect it to the project/environment:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional: `ROOM_NAMESPACE` (unique environment prefix), `PUBLIC_URL` (canonical HTTPS origin). Never prefix credentials with `NEXT_PUBLIC_` or expose them in browser code. Keep separate databases or namespaces for previews and production. Review pricing during provisioning; this preparation did not create any billed resources.

## Before release

1. Run `npm ci`, `npm run check`, `npm test`, `npm run build`.
2. Confirm `dist/` contains only browser files, not `lib/words.js`, `.env` or API source.
3. Deploy a preview after connecting Redis. Check `/api/health` returns shared mode and HTTP 200.
4. Open four separate phones/browser profiles. Join from the QR; confirm the URL is HTTPS and points to that deployment.
5. Finish a game, verify both win paths, and replay.
6. Refresh a player during a game: same name, word and vote status must return.
7. Background the host for at least 45 seconds. Verify another active player becomes host, and the old host can rejoin as a player.
8. Verify no horizontal overflow on 320px/390px screens, portrait/landscape, large text, Safari and Chrome. Inspect reveal, voting and results, not just the home page.
9. Check Vercel/Upstash error logs and command/invocation usage before production release.

## Troubleshooting

- **503 / setup needed**: storage variables missing, permissions invalid or Redis unavailable. Connect storage and redeploy. The server never falls back to in-memory production rooms.
- **404 on `/api/health`**: confirm project root and rewrite in `vercel.json`.
- **Room not found after switching URLs**: production and previews intentionally use separate namespaces. Share the same deployment’s invite.
- **Player went offline while using another app**: iOS/Android can suspend web tabs. Return to the original tab. Presence restores on the next sync.
- **Game moved on**: a timer/other action advanced the state before an old button click arrived. Sync updates the screen; try the current action.
- **Large groups/usage limits**: inspect Redis/Vercel usage; polling is suitable for small office groups, not a claim of massive-scale load testing.
