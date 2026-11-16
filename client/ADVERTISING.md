# Advertising preparation

Advertising and direct payments remain disabled. Site verification, a pending
review and these feature flags do not grant permission to serve ads.

## Game readiness and real impressions

Each connected, authenticated room seat receives a private, one-use attempt for
the next game cycle. The server accepts shown/closed interstitial outcomes as
`ready`. No fill, frequency caps, SDK errors or declined/missing consent instead
produce `skipped`. Both allow that seat to continue; a skipped opportunity never
becomes `viewed`, an impression, a reward or an ad-free entitlement. Other pending
seats still finish their own opportunity. Successful start/rematch resets the
cycle; reconnect preserves a completed or skipped seat.

The SDK callbacks are browser reports, not signed proof of a view. Do not use
this game-readiness state as advertising revenue or antifraud evidence.

## Consent: disabled by default

Server: `ADS_PROVIDER=disabled`, `ADS_CONSENT_READY=false`.
Browser: `VITE_ADS_CONSENT_READY=false`, `VITE_ADS_CMP=disabled`.

The prepared external-CMP adapter requires all of:

1. An actual certified CMP installed and configured for the approved domains,
   with its own working ES/EN consent UI and standard TCF v2 `__tcfapi`.
2. An integration that sets `window.nrnAdPrivacy.openPreferences` to the CMP's
   documented method for reopening its real preferences. This is a bridge, not
   a new CMP. Install it before rendering the app. The footer and pre-game panel
   show the preference button only when that integration exists.
   The same bridge must supply `canRequestAds(): boolean`, returning true only
   after the CMP has checked every applicable regional consent/opt-out decision
   for the requested ad use. Missing, denied or failing decisions block the SDK;
   a non-GDPR TCF result alone is insufficient. TCF does not replace GPP or other
   regional privacy requirements. Feed any such choices into this method and
   supply `subscribeChanges(listener): unsubscribe` using the CMP's documented
   change event, including GPP/regional changes that do not emit a TCF event.
   The SDK pauses immediately on that notification and checks `canRequestAds`
   afresh before loading or playing. A missing subscription disables the adapter.
   No polling or fabricated regional consent is used.
3. `VITE_ADS_CMP=external` and `VITE_ADS_CONSENT_READY=true` after validation.
4. The server's independent `ADS_CONSENT_READY=true`, valid publisher and
   `ADS_PROVIDER=google-h5`, after provider approval and the hosted pilot pass.

No Google ad tag is downloaded by this adapter before positive, loaded CMP
signals. Unknown or denied signals, missing CMP, timeout and withdrawal skip
the opportunity without preventing play. For GDPR traffic the adapter requires
a nonempty TCF string, Google vendor 755 consent and purposes 1, 3 and 4; it is a
conservative personalized-ad gate, not a complete legal compliance assessment.
An explicitly non-GDPR result can proceed only with the bridge's affirmative
regional decision; an unknown jurisdiction cannot. Explicit vendor/purpose
refusals remain blocking even when the CMP reports a non-GDPR jurisdiction.
Revocation pauses further SDK requests. At the end of an opportunity requests
are paused again. Do not add a Google CMP bootstrap to this path without a
separate reviewed integration: Google's own tag-first bootstrap differs from
the external-CMP flow.

## CSP and activation remain blocked until hosted verification

The normal `vercel.json` deliberately retains its restrictive production CSP;
it does not allow Google advertising. Do not weaken it globally or add
`unsafe-inline` to script permissions to make a pilot work.

For an approved pilot, supply a server-generated, unpredictable nonce per HTML
response, apply it to the initial scripts and the advertising loader, and use
the provider's current documented CSP. Vercel's static HTML cannot generate a
fresh nonce by itself. The hosting integration must handle that before enabling
ads; a fixed nonce or a placeholder in a static config is not a solution. Scope
the advertising policy to the approved game pages; account, dashboard and legal
routes retain their stricter policy. Validate the CMP's actual resource needs
and the SDK's frames/connections in report-only mode, then enforce the tested
policy. Do not use general `https:` wildcards as an unreviewed shortcut.

Current sources: [Google CSP](https://support.google.com/adsense/answer/16283098),
[H5 callbacks](https://developers.google.com/ad-placement/apis/adbreak),
[certified CMP requirements](https://support.google.com/adsense/answer/13554116).

Before activation, test actual hosted desktop/mobile flows: consent accept,
deny and reopen; non-GDPR; no fill; frequency cap; blockers; offline/reconnect;
late callbacks after leaving; new seats; rematch; table-wide ad-free exemption;
and that a skipped opportunity never appears in impression reporting. Use the
provider's official test mode, never fabricated live views or clicks.

## Inventory

Start with a separated block in long public guides after a worked example,
with reserved space and no adjacent navigation/action controls. No Display units
are added by this change. H5 opportunities belong before the first deal or a
requested rematch, never between turns or rounds. Exclude chat, account screens,
private dashboard, invitations and errors. Keep Auto Ads disabled until route
exclusions have been tested. See the root advertising plan for domain approval
and ownership-verification evidence.
