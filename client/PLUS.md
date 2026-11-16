# NRN Plus web release

Plus is optional. Basic Conti/Pocha play remains free for guests. Active server-confirmed access enables local table colours/card backs and exempts a member's whole card table from game ads when advertising is actually enabled. It does not promise cloud careers, native apps or app-store purchases. Advertising remains disabled pending its separate approval/consent work.

## Buy Me a Coffee membership

- The intended published level is **USD 10 yearly**, with **USD 1 monthly** because BMC requires both prices. The UI favours annual access but explicitly tells players to choose the period on BMC's checkout page. It does not claim a query parameter preselects annual billing or invent a fixed EUR price.
- Purchase readiness, actual currencies/prices and provider URLs come from the server. Missing, unvalidated or disabled configuration shows “coming soon” and provides no working purchase button. Opening checkout does not grant access.
- Use the same verified email for BMC membership and the NRN Play account. The authenticated checkout request never places email or a session credential in an external URL.
- BMC is the authority for membership status/period, including its own failed-payment grace (documented as ten days). An active status is not represented as proof of an individually paid invoice. Cancellation at period end retains remaining access; immediate cancellation/pause removes access according to the provider update. Signed lifecycle validation remains a prelaunch requirement owned by the backend/operator.
- Set the validated management URL to `https://buymeacoffee.com/login`. The client explains **My Account → Payments → Memberships → NRN Plus → View details**. Management remains available for former BMC subscribers so revocation does not hide their route to stop external renewal. Signing out/deleting an NRN account does not cancel BMC billing.

## Manual refunds and owner access revocation

The owner must process cancellation/refund/payment actions in BMC separately. The private dashboard only revokes NRN access for the chosen subscription; it does not issue a refund or cancel a BMC payment. Before revocation it shows the subscription email/ID, requires a known reason (`refund`, `dispute`, `provider_correction`) and exact typed ID, and explains that this ID cannot be reinstated. The record and audit remain. Separate purchases/gifts remain independent. Consumer requests go to the existing public contact, `nacho@nrnplay.com`; no blanket refund exclusion is stated.

The dashboard uses the existing same-origin owner cookie and mutation header for `GET /api/admin/plus/subscriptions` and `POST /api/admin/plus/revoke`. It rejects malformed list responses, hides private data when the session ends and performs no automatic revocation.

## Appearance and verification

Only appearance IDs are saved in account-scoped browser storage. Saved preferences cannot grant Plus. Expiry, logout or account changes immediately fall back to classic styling. Table styles and card backs are applied to actual Conti and Pocha surfaces; Pocha's opponent badges use its existing public card count and never expose card values.

The release was checked with disposable local account/admin API fixtures: guest/active access, reset/logout, English/Spanish, 390px layout, provider URL rejection and exact-ID owner revocation. No real payment or production subscription was changed. Provider activation still requires the separate live setup/validation process.

Official provider references (checked November 16, 2026):

- [Membership and failed-payment grace](https://help.buymeacoffee.com/en/articles/4368555-things-you-should-know-before-subscribing-to-a-membership-plan)
- [Cancel a membership](https://help.buymeacoffee.com/en/articles/3364732-how-do-i-cancel-my-membership-to-a-creator)
- [Provider privacy policy](https://buymeacoffee.com/privacy-policy)

Public user-facing terms and privacy notice are in `public/terms.html` and `public/privacy.html`, in Spanish and English. Their price/benefit descriptions must stay aligned with the configured BMC level before release.
