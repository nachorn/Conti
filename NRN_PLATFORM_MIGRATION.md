# NRN Play: shared account and game subdomains

Chosen addresses:

| Address | Application |
| --- | --- |
| `nrnplay.com` | NRN Play catalog, central profile and sign-in |
| `conti.nrnplay.com` | Conti, using the existing Vercel client project |
| `pocha.nrnplay.com` | Pocha, using the same existing Vercel client project |
| `football.nrnplay.com` | FootballChampion, using its existing Cloudflare Pages project |

The selected brand is the revised option 10: geometric NRN, lime chevron, Play. Production assets use the `nrn-play-selected` filenames in `client/public/brand/`; the earlier concepts remain available separately.

## Account model

All games reuse the existing Conti membership service and account IDs. No second user database or password system is created. Conti and Pocha keep their existing results and leagues. FootballChampion gains optional NRN Play sign-in; its simulated player's profile and local career remain separate from the real account.

Different subdomains have separate browser storage. A game creates a temporary PKCE verifier and state in its own tab, redirects to the central `/connect` page, and receives a short-lived authorization code. Only that game tab can exchange the code for its own session. Codes expire after 60 seconds and can be consumed once; existing source-session revocation also invalidates pending sign-ins. Access tokens never travel in URLs. Account responses and the central sign-in page are not cached.

The central profile stays outside the game socket owner so signing in cannot reconnect or replace a saved room seat. Guest play remains available. Signing into FootballChampion does not upload or claim a local career, and does not create cloud saves. Each game's sign-out ends its own session.

## Activation order

1. Deploy the game server with the shared-account endpoints and preserve the existing membership store, auth secret, game store and email configuration.
2. Preserve the existing `CLIENT_ORIGINS` entries and approved previews, then add `https://conti.nrnplay.com`, `https://pocha.nrnplay.com`, `https://football.nrnplay.com` and `https://footballchampion.net`. These are the clients that need the existing membership API. Do not change unrelated credentials or mail settings.
3. `MEMBERSHIP_GAME_ORIGINS` defaults to the three chosen game subdomains, `https://footballchampion.net` and `https://nrnplay.com`. If overriding, provide a complete comma-separated list of exact HTTPS origins with no paths, trailing slashes or wildcards. Local HTTP origins are development-only.
4. Attach `conti.nrnplay.com` and `pocha.nrnplay.com` to the existing Vercel client project. Attach `football.nrnplay.com` to the existing FootballChampion Cloudflare Pages project. Obtain the exact required DNS and ownership records from each provider, set them at the authoritative DNS provider, then verify DNS and HTTPS. Preserve the root site and all MX/TXT records for Zoho and Resend.
5. Deploy both clients with their existing backend/hosting settings. The card client uses the existing `VITE_SOCKET_URL`; FootballChampion uses `VITE_NRN_API_URL=https://conti-server.onrender.com` and both clients use `VITE_NRN_AUTH_URL=https://nrnplay.com`.
6. Verify direct loads of all three game subdomains and central sign-in, then set the catalog client's `VITE_GAME_SUBDOMAINS_ENABLED=true` and rebuild. Until that switch is enabled the existing `/conti`, `/pocha` and `footballchampion.net` destinations remain in use. Host routing is already prepared independently of the link switch.

## Preserve existing games

Do not redirect `footballchampion.net` or the earlier Conti addresses away immediately. Their guest seats, account credentials and local careers belong to those origins. Old card-game room links and `/conti`, `/pocha`, `/game` and `/room/:roomId` routes remain available. The new game subdomains point players back to old saved rooms when needed.

FootballChampion already supports JSON export/import and portable career codes. Keep those tools available on the old and new addresses so players can deliberately transfer careers. A shared account does not move browser storage by itself.

## Advertising decision

AdSense will be managed around the parent domain `nrnplay.com` and its games. No live advertising, new placements, consent changes or publisher settings are activated in this migration. Plan formats and placements separately later.

Both current projects use the same publisher ID in `ads.txt`, so keep the root authorization file consistent. Google's current ordinary-domain site management includes subdomains; this does not guarantee approval or revenue. Original games can contribute useful content, while empty ad space and navigation cards do not substitute for that content.

Sources: [Google: subdomain management](https://support.google.com/adsense/answer/12170421?hl=es), [content and navigation](https://support.google.com/adsense/answer/7299563?hl=es), [ad/content balance](https://support.google.com/publisherpolicies/answer/11169917?hl=en-GB), [ads.txt FAQ](https://support.google.com/adsense/answer/9785052?hl=es).
