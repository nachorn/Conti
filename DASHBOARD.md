# NRN Play administration

Open **https://nrnplay.com/admin** while signed into an authorized NRN Play account. The Administration link appears in the header and personal dashboard only for that account. `/dashboard` and administration URLs on Conti or Pocha redirect to the central panel. Administration never joins a game or reclaims a saved seat.

The panel contains Overview, Users, Conti, Pocha, FootballChampion and Plus. Users supports search, pagination, per-game results and Plus gifts lasting 30 days, one year or permanently. Existing Plus access opens the full Plus management tools instead of replacing it with a quick gift.

## Account permissions

1. Enable the existing membership service and verified email delivery.
2. Set `ADMIN_ACCOUNT_EMAILS` privately on the **server** to a comma-separated list of authorized account emails. Addresses are trimmed and normalized to lowercase. Do not put the list in client code, a `VITE_` variable or committed configuration.
3. Restart the server and deploy the client. Users keep their normal account sessions; no separate administration password is needed.

Every administration request verifies the current membership Bearer token and its account role. Guests receive 401; authenticated accounts outside the list receive 403. Revoked or expired sessions lose access on their next request. An explicitly configured empty list denies all administration access. Configuring the list while memberships are disabled prevents startup.

In account-only mode, old master-key Bearer tokens, admin cookies and password login cannot bypass account permissions. The backend retains legacy authentication only for installations without `ADMIN_ACCOUNT_EMAILS`; the current client has no legacy password form. Keep the private `ADMIN_DASHBOARD_KEY` for the scoped Football report bridge; it is never sent to the browser.

Administration uses same-origin `/api/admin` requests, proxied by Vercel to `https://api.nrnplay.com`. Local Vite proxies to `VITE_SOCKET_URL` or `http://localhost:3001`. Writes require `X-Admin-Request: 1` and a trusted origin when supplied. Responses use `Cache-Control: no-store`; administration pages are excluded from service-worker navigation fallback and search indexing.

## Statistics and privacy

- Rooms refresh every five seconds while the page is visible. A failed refresh retains the last result with a warning.
- The overview refreshes every 15 seconds. Conti and Pocha recorded results come from the durable account-linked ledger; guest seats remain visible in live rooms. Offline rooms expire after 30 days of inactivity.
- Football reports aggregate activity from the last 30 UTC dates. Both servers cache the report for five minutes. Individual careers remain in each player's browser.
- Account listings contain names, emails, creation dates, Plus status and game totals. They exclude passwords, password hashes, challenges, session tokens and payment details. Room listings exclude hands, decks, recovery credentials and snapshots.

## Selected-room cleanup

`POST /api/admin/rooms/cleanup` removes an explicitly reviewed list of offline rooms. Send `rooms: [{ roomId, expectedUpdatedAt, expectedPhase }]` from a fresh dashboard response, together with the account authorization and write-protection headers.

The server rechecks the entire selection in the gameplay queue. Missing, changed or connected rooms reject the whole request with `409 rooms_changed`. A successful durable save returns `{ ok: true, deletedRoomIds }`; unselected rooms stay unchanged. A storage failure returns 503 and pauses writes. After an uncertain response, inspect the original selection before retrying. Cleanup permanently removes those saved games and recovery seats.

## Verification

Run the server and client tests and production builds. Authorization tests cover both allowed accounts, ordinary accounts, guests, email verification, obsolete credentials, session revocation, storage outages and write protection. Platform tests check account-field redaction, pagination, game aggregates and the bounded Football report bridge.
