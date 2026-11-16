# Guide Display preparation · 15 November 2026

Implemented locally; advertising is **OFF**. No CMP installation, provider approval, external setup or deployment was performed by this change. Game H5 nonce/CSP integration is separate and remains pending; no game advertising is enabled here.

Only canonical `/learn/{es,en}/{continental,pocha}/` and their slashless forms route to `api/editorial.js`. Its fixed four-entry file whitelist reads bundled `public/learn/**`; it cannot select other files. All other pages, including account, dashboard, game and room routes, retain the existing restrictive global policy. The direct endpoint accepts GET/HEAD and the same whitelist. `/index.html` aliases remain static and ads off.

With no active pilot, the endpoint serves the original static guide with a single **hidden** unit after the worked example and the baseline CSP. The first-party controller returns before reading storage, CMP or making a network request. Nothing becomes visible or downloads Google code.

Pilot settings are server environment variables, never request parameters. All must be explicitly configured after actual approval and hosted validation:

- `EDITORIAL_ADS_ENABLED=true`, `EDITORIAL_ADS_APPROVED=true`;
- `EDITORIAL_ADS_CONSENT_READY=true`, `EDITORIAL_ADS_CMP=external`;
- real `EDITORIAL_ADS_CLIENT` and `EDITORIAL_ADS_SLOT`;
- `EDITORIAL_ADS_CMP_SCRIPT_URL`: reviewed HTTPS script for the installed certified CMP integration;
- `EDITORIAL_ADS_ALLOWED_HOSTS`: comma-separated approved hostnames;
- `EDITORIAL_ADS_RESOURCE_ORIGINS`: reviewed explicit HTTPS origins required by that CMP and ad unit, without paths or wildcards;
- `EDITORIAL_ADS_CSP_REVIEWED=true` after validating those resource needs in the actual hosted pilot.

These settings are all absent/off by default. No real publisher, slot or CMP URL is invented in source. Fake values occur only in isolated tests and are never requested.

An active response creates a fresh 128-bit random nonce, adds it to each initial script and the Google loader, and sets a scoped `strict-dynamic` policy. The provider evaluation permission exists only in this reviewed opt-in mode. Script `unsafe-inline`, static nonces and general HTTPS resource wildcards are not used. Every endpoint response is private/no-store at browser and CDN layers. Early exact routes let the function supply complete headers without changing the global CSP. Actual Vercel routing/bundled-file behavior still requires hosted preview verification.

The real CMP integration must install `window.__tcfapi` and `window.nrnAdPrivacy` before the guide controller, including `openPreferences`, `canRequestAds` and a real `subscribeChanges` unsubscribe. No banner or CMP is fabricated. The controller requires loaded TCF state; Google vendor 755 and purposes 1, 3, 4 for GDPR; no explicit refusals in any region; and the bridge's affirmative complete regional decision. Non-GDPR TCF alone is insufficient. Withdrawal hides the unit and pauses requests. The labelled privacy-preferences button reopens the real installed CMP.

Before any Google download, a stored NRN account session is checked against the shared account service. Only credentials are read from `conti-membership-session`; cached premium flags are ignored. Verified `account.adFree` suppresses ads. Storage errors, malformed/expired sessions, account errors, session changes and offline checks suppress ads. Signed-in visitors are checked again before queueing; focus rechecks an existing unit. Account changes, leaving the page, withdrawal and no fill close it. No automatic refresh or artificial impression/view reporting is implemented.

Local validation: eight focused security/contract tests passed; the combined client suite and production build passed. Tests cover exact route scope, unchanged global CSP, hidden slot position, file traversal, query flags, random matching nonces, no-store, TCF parity and independent regional permission, server entitlement checks and default-off browser behavior. Live fill, actual CMP behavior, provider approval and real hosted headers remain unverified until an approved pilot.

References: [Vercel file bundling](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions), [Vercel routing configuration](https://vercel.com/docs/project-configuration/vercel-json), [Google nonce CSP guidance](https://support.google.com/adsense/answer/16283098).
