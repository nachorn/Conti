# NRN Plus and Buy Me a Coffee

The integration uses BMC's signed membership state as the authority of access,
including BMC's payment grace. It does **not** claim that `membership.updated`
is an independently verified paid invoice. BMC's published schema has no
membership-refund event or payment-status field. Refunds and disputes require the
owner procedure below. Ordinary donations never activate Plus.

The configured level offers USD 10/year and USD 1/month. BMC's localized pricing
uses currency conversion; it must not be described as an independently fixed
EUR 10 offer. All new purchases remain disabled until the actual level, both
prices, no-trial setting, signed lifecycle and refund workflow are checked.

## Configuration

Use the BMC section in `membership.env.example`. The endpoint is
`POST /api/membership/bmc-webhook`, with raw JSON, a 256 KiB limit and
`x-signature-sha256` HMAC-SHA256 verification. Keep the signing secret only in
server environment/private files. No API bearer token or abandoned BMC REST API
is needed. `BMC_AMOUNT_UNITS` records the observed provider payload units for
readiness checks; it does not calculate exchange rates or authorize an entitlement.

`BMC_VALIDATION_CONFIRMED=true` confirms the access lifecycle has been tested;
it does not certify individual invoices as paid. Enable it only after testing
the configured membership level. The readiness API also requires the monthly
price, external PostgreSQL, a valid buyer management URL and
`BMC_REFUND_MODE=manual`.

To transfer a signing secret locally on Windows, copy the provider's actual
secret, then run `server/scripts/store-bmc-secret.ps1 -FromClipboard`. It writes
to a new Git-ignored `.cache/bmc-private-.../webhook.env`, with access restricted
to the current user, and clears the clipboard. It prints the path only. Running
without that switch uses a private secure prompt. Do not paste secrets into chat,
command arguments, source files or screenshots. No helper generates a replacement
provider secret.

## Lifecycle and identity

- Active, eligible signed periods grant access only to a verified NRN account
  with the matching normalized email. A webhook never creates an account.
- The first binding is retained: a later provider-email change cannot transfer
  the right to a different NRN account. A receipt may arrive before registration;
  email proof is still required before that account receives access.
- Only the configured signed level qualifies. BMC owns its checkout pricing,
  localized currency conversion, higher contributions and any price adjustments;
  the webhook has no documented canonical/base-amount field. Its amount must be
  finite and positive and its currency must have a three-letter code, but neither
  is compared with the displayed base price. Zero is rejected because the approved
  level has no free trial. Monthly periods are bounded to 27–32 days; annual
  periods to 364–367. This is provider access verification, not invoice verification.
- A newer eligible active period can renew access. Older events cannot rewind
  or resurrect state. Conservative same-time ordering gives cancellation
  precedence. Attempts and delivery IDs do not create duplicate entitlements.
- Period-end cancellation or pause retains only the current accepted period;
  it cannot extend expiry. Immediate cancellation/pause cuts access at the event
  or cancellation time, even if the payload carries a later period end.
- Expiry is evaluated on the server whenever an account is authenticated.
  Checkout clicks, query parameters and browser return URLs grant nothing.
- Legacy permanent purchases and active owner gifts remain independent. The
  public account exposes the longest currently effective right; permanent
  rights retain a null expiry.
- Selecting BMC as the primary provider disables new legacy one-time Stripe
  checkout offers. It does not revoke any existing permanent purchase or gift.

## Refund/dispute procedure

1. Locate the exact BMC subscription and transaction in the provider dashboard.
   Complete the refund/dispute handling and cancellation there as appropriate.
2. Open the authenticated NRN owner dashboard or use the authenticated private
   API. Confirm the exact subscription, then submit
   `POST /api/admin/plus/revoke` with
   `{ "subscriptionId": "provider-numeric-id", "reason": "refund" }`.
   Allowed reasons are `refund`, `dispute` and `provider_correction`.
3. The request requires the existing owner authentication and
   `X-Admin-Request: 1`. It saves an audited, irreversible tombstone for that
   subscription ID. Later BMC updates cannot restore it. A separate new
   subscription may qualify; unrelated gifts/permanent purchases are preserved.
4. This NRN action **does not refund money or cancel BMC billing**. Verify both
   systems. If storage fails, the API returns failure and grants nothing from
   uncertain memory; restore/restart from the durable state before retrying.

Private reads: `GET /api/admin/plus/readiness` returns configuration checks and
the last authenticated test timestamp without secrets. `GET
/api/admin/plus/subscriptions` returns the minimum identity/expiry fields needed
for the owner's reconciliation and the latest 100 audit entries. Do not publish
these responses. Full external payment reconciliation remains an owner operation;
the integration does not poll the abandoned BMC API.

## Storage and rollback

Production billing requires the existing external `DATABASE_URL`. Render's local
filesystem is never accepted for enabling this provider. The membership writer
continues to save atomically and waits for durable acknowledgement before
publishing a changed right. Back up accounts and game state together.

Legacy membership snapshots (v1) are accepted. Once a live BMC subscription is
stored, the snapshot is v2. A pre-Plus server refuses v2 rather than silently
denying or erasing paid rights. Roll back only to a build that preserves this
schema; never replace the store with an older snapshot just to start an old build.
Test-event diagnostics alone do not upgrade the schema or grant rights.

## Official references

- [Webhook setup, signatures and supported events](https://help.buymeacoffee.com/en/articles/15743173-how-to-setup-and-use-buy-me-a-coffee-webhooks)
- [Published OpenAPI payload definitions](https://cdn.buymeacoffee.com/assets/integrations/bmc-webhooks-openapi.json)
- [Membership periods and payment grace](https://help.buymeacoffee.com/en/articles/4368555-things-you-should-know-before-subscribing-to-a-membership-plan)
- [Cancellation applies to future periods](https://buymeacoffee.com/terms)
- [Refunding a member](https://help.buymeacoffee.com/en/articles/7257231-how-to-refund-a-supporter-or-a-member)
- [Currency and localized pricing](https://help.buymeacoffee.com/en/articles/10202407-buy-me-a-coffee-advanced-settings-explained)
- [Platform and payment processing fees](https://help.buymeacoffee.com/en/articles/8105744-how-to-calculate-charges-on-your-payment)
- [Old REST documentation's deprecation notice](https://developers.buymeacoffee.com/)
