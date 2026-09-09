# Private player dashboard

Open `/dashboard` on the game website, or use **Owner dashboard** at the bottom of the lobby. The dashboard supports English and Spanish and shows:

- Online player seats, games in progress, waiting rooms, and offline saved rooms.
- Each room's game, code, players, host, round, next player, and last update.
- Search by player name or room code, game filters, and an option to include offline rooms.

The page refreshes every five seconds while visible. A failed refresh keeps the last successful result with a clear warning. Viewing it does not join a room, reclaim a saved seat, write game data, or extend a room's lifetime. Names are the names players entered, not verified identities. Offline rooms expire after 72 hours of inactivity; this is not a permanent player history.

## Enable access

1. Generate a random access key with a password manager (32–256 characters), or run `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` locally.
2. Set **`ADMIN_DASHBOARD_KEY`** to that key in the **game server's** environment, then restart/redeploy the server. For local development, set the environment variable in the terminal that runs the server.
3. Deploy the updated client as well. Its existing `VITE_SOCKET_URL` points both gameplay and dashboard requests to the game server. The included Vercel rewrite supports opening `/dashboard` directly.
4. Open `/dashboard` over HTTPS on the deployed site and enter the key. Keep the key private. **Lock dashboard**, reloading, or closing the page clears its in-memory access.

Do not put this key in any `VITE_` variable, a URL, a committed file, or client code. The endpoint is disabled when the server key is missing, shorter than 32 characters, or longer than 256 characters. Rotating the server key revokes existing dashboard access on its next refresh.

## Data and checks

The authenticated `GET /api/admin/dashboard` endpoint returns only an allowlist of room and player metadata. It never includes cards, decks, scores, recovery tokens, session hashes, or saved snapshots. Online status comes from live player connections, not open dashboard tabs or stale saved connection flags. Responses, including errors, use `Cache-Control: no-store`.

Server tests cover access control, field redaction, real joins and departures, recovery, both game types, expiry, and storage failure. Run the existing server and client tests and production builds before deploying.
