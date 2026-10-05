# Private player dashboard

Open `/dashboard` on the game website, or use **Owner dashboard** at the bottom of the lobby. The dashboard supports English and Spanish and shows:

- Online player seats, games in progress, waiting rooms, and offline saved rooms.
- Each room's game, code, players, host, round, next player, and last update.
- Search by player name or room code, game filters, and an option to include offline rooms.

The page refreshes every five seconds while visible. A failed refresh keeps the last successful result with a clear warning. Viewing it does not join a room, reclaim a saved seat, write game data, or extend a room's lifetime. Names are the names players entered, not verified identities. Offline rooms expire after 72 hours of inactivity; this is not a permanent player history.

## Enable access

1. Generate a random access key with a password manager (32–256 characters), or run `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` locally.
2. Set **`ADMIN_DASHBOARD_KEY`** to that key in the **game server's** environment, then restart/redeploy the server. For local development, set the environment variable in the terminal that runs the server.
3. Deploy the updated client as well. Admin requests use the website's own `/api/admin` path: the included Vercel rewrite proxies it to `conti-server.onrender.com`. If hosting a different server, update this destination. For local development, Vite proxies it to `VITE_SOCKET_URL` or `http://localhost:3001`. The server's allowed origins must include the website. Gameplay continues to use `VITE_SOCKET_URL` directly.
4. Open `/dashboard` over HTTPS and enter the key. **Remember me for 30 days** is selected by default; turn it off on a shared device. Remembered access survives reloading and closing the browser for up to 30 days. Without it, the browser receives a session cookie with a maximum server lifetime of 12 hours. **Sign out** removes access from that browser.

Do not put this key in any `VITE_` variable, a URL, a committed file, or client code. The endpoint is disabled when the server key is missing, shorter than 32 characters, or longer than 256 characters. Rotating the server key revokes existing dashboard access on its next refresh.

The password is sent only during login and is never saved in browser storage by the app. The server issues a signed, expiring `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/admin`, with `Secure` enabled in production. Same-origin proxying avoids relying on third-party cookies in Safari. Sessions have a fixed expiry and survive server restarts while the access key stays the same. Sign-out clears the browser cookie; rotating the key invalidates every session.

The form uses named username/password controls and `autocomplete="current-password"`, following [Apple's Password AutoFill guidance](https://developer.apple.com/documentation/security/enabling-password-autofill-on-an-html-input-element). For iPhone Passwords, save the credential against the game website domain (`conti-six.vercel.app`), not the Render server or a temporary preview URL. The username is `admin`; the existing access key remains the password. Actual AutoFill suggestions depend on the device's password settings.

## Data and checks

The authenticated `GET /api/admin/dashboard` endpoint returns only an allowlist of room and player metadata. It never includes cards, decks, scores, recovery tokens, session hashes, or saved snapshots. Online status comes from live player connections, not open dashboard tabs or stale saved connection flags. Responses, including errors, use `Cache-Control: no-store`.

Server tests cover access control, field redaction, real joins and departures, recovery, both game types, expiry, and storage failure. Run the existing server and client tests and production builds before deploying.
