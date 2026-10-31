# Conti security

## Application safeguards

- Player seats require server-issued random recovery tokens; stored tokens are hashed and opponents' cards are redacted.
- Admin cookies are signed, HttpOnly and SameSite=Strict, with Secure enabled in production. Existing sessions and logout remain available when anonymous admin requests are throttled.
- Production requires explicit `CLIENT_ORIGINS`. WebSocket and polling handshakes reject unapproved browser origins. Native clients may omit or forge Origin, so seat authentication remains mandatory.
- Debug game actions are disabled in production regardless of `ENABLE_DEBUG_ACTIONS`.
- Security headers prevent framing, disable MIME guessing and restrict browser capabilities. The website CSP permits the current Render server, Google Fonts, Vercel analytics and Cloudflare Turnstile. A different backend, advertising or other external scripts require an explicit CSP review before enabling them.

| Operation | Budget |
| --- | --- |
| Admin login | 10 requests per peer per minute |
| Other unauthenticated admin requests | 120 per peer per minute |
| Public room invitation lookups | 120 per peer per minute |
| Initial Socket.IO connections | 120 per transport peer per minute |
| Room creation and joining combined | 10 per socket and 60 per transport peer per minute |
| Registered game events | 120 per socket per 10 seconds, before entering the save queue |

HTTP limits return `429`, `Retry-After` and `Cache-Control: no-store`; socket limits return `rate_limited`. Counters are bounded, live in process memory and reset on server restart. They are baseline abuse controls, not a distributed DDoS defense.

Forwarded client IP headers are not trusted automatically. HTTP counters use Express's configured trust policy; transport counters use the socket peer. Behind Render/Cloudflare several legitimate users may share a peer budget. Do not blindly enable trust for `X-Forwarded-For` or `CF-Connecting-IP`: verify the proxy topology and test a controlled client-IP solution before changing attribution or limits. Review budgets against legitimate traffic before rollout.

Room codes have four digits and are invitation locators, not secrets. Private-room PINs or host approval would be a separate feature.

## Cloudflare

Turnstile can protect `conti-six.vercel.app` without buying a custom domain or placing another proxy in front of Vercel. A Managed widget named `Conti — acceso a partidas` has been created for that hostname only, with pre-clearance disabled. Its public site key is `0x4AAAAAAFuQsozSD2ZQ9F6Z`. The secret remains in Cloudflare; it has not been committed or added to the public frontend.

The local implementation checks new room creation and joining. It validates tokens server-side with a five-second deadline, a maximum of 20 concurrent provider requests, the approved hostname, the `room_entry` action and token age. Cloudflare enforces single use. Verification happens before the shared game queue; one slow check cannot stall existing tables. Authenticated seat recovery and regular game actions do not require a new check. The privacy notice describes the optional verification.

Set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` privately on the game server to enable it. Both absent means disabled; a partial configuration fails startup. Production rejects Cloudflare's dummy keys. Never commit the secret or use a `VITE_` variable for it. `/api/security/config` exposes only the public site key or `null`, with no caching.

Cloudflare's WebSocket WAF checks the initial handshake; application event limits are still needed after connection. Cloudflare headers on the Render hostname do not establish that this application's rules are configured in the owner's Cloudflare account.

## Release and verification

Deploying the game server restarts it; check current play and follow the existing durable-storage and single-writer deployment process. Confirm the live service has `CLIENT_ORIGINS=https://conti-six.vercel.app` before deploying. Keep Turnstile disabled until the compatible frontend and backend are live and the production widget has been checked in a normal browser. The frontend supports an older backend's missing configuration endpoint (HTTP 404); an enabled new backend always requires a valid proof. Other configuration failures stop the entry attempt. Older clients cannot supply a proof and must refresh before creating or joining after activation. Verify headers, allowed and rejected origins, login throttling, two-player play and authenticated reconnection after release.

Local QA: 223 server tests and 84 client tests pass. The browser's Cloudflare dummy widget returned provider error `300030`, including on a separate minimal HTML page without React. The integration handles that failure and offers retry/cancel. Live Turnstile activation remains pending a successful browser check; do not treat widget creation as active protection.

The bilingual terms identify Ignacio Rodriguez Novas Catala, describe conduct, availability, voluntary support and the current free service, and preserve mandatory rights. They are a simple project notice, not a certification of legal compliance. Jurisdiction-specific operator disclosures and future sales require a separate review.

References: [Socket.IO origins](https://socket.io/docs/v4/handling-cors/), [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/), [WebSocket filtering](https://developers.cloudflare.com/network/websockets/), [Vercel proxy guidance](https://vercel.com/kb/guide/can-i-use-a-proxy-on-top-of-my-vercel-deployment), [Spanish consumer rights, article 86](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a86).
