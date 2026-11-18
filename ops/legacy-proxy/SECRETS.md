# Scoped Render credentials

The proxy/KDF process can run without account storage, mail, payment or administrator credentials.

- `NRN_LEGACY_PROXY_KEY`: canonical lowercase hexadecimal HMAC-SHA256 of the existing account secret (trimmed), context `nrnplay:legacy-proxy:v3`. This is the existing Caddy transport value.
- `NRN_PASSWORD_WORKER_SIGNING_KEY`: canonical unpadded base64url HMAC-SHA256 of the same existing account secret (trimmed), context `nrnplay:password-worker:v1`. It decodes to exactly 32 bytes and is used directly as the existing request/response signing key.

Derive these offline from the existing private environment. Never place their values in source, command arguments, logs or this document. Do not rotate the original account secret: existing passwords, sessions and OTPs stay unchanged. Azure can continue deriving the worker key from its account secret, or use the optional scoped worker variable.

Migration order, performed by the operator:

1. Add both derived variables privately to Render while preserving its current environment. The old image ignores the additions.
2. Deploy this compatible image. It prefers explicit derived credentials even if the old secret is present. Verify proxy transport and a synthetic password derivation; real user credentials are unnecessary.
3. Remove the main account secret, database URL, email credentials, administrator credentials, payment/webhook credentials and unrelated application secrets from Render in one controlled environment update. Keep only the derived credentials and platform/runtime settings it needs.
4. Enable `NRN_REQUIRE_SCOPED_RENDER_SECRETS=true` after cleanup. Strict mode requires both derived values and rejects recognized account/database/admin/mail/payment credentials. It never falls back to the account secret.

During transition, missing scoped variables retain the previous derivation; an explicitly malformed scoped value always fails closed. Strict mode must not be enabled before step 3. The fixed upstream, HMAC bytes, KDF cost, one-active/eight-queued job budget and 32-body-reader limit are unchanged. No process is restarted or environment changed by these source files themselves.
