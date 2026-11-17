# NRN Play on the provisional 1 GB VM

Local review artifacts only. Nothing in this directory has been applied to Azure,
Render, DNS, Caddy, systemd, or the database. No real credentials are included.
Application base: `2113aba33c4c92b9cdeffb03deb0dcd15c367e56` (the reviewed
`a4be3c6` account/session change plus loopback listener support).

## RACE first

Complete the separate 25-minute RACE measurement before starting NRN. Record RACE
latency/errors, memory, CPU, swap and restarts with no NRN load. On 1 GB, the NRN
limits are provisional, not a capacity guarantee. Build the release elsewhere to
avoid competing with RACE during dependency installation or TypeScript builds.

`systemd/nrnplay.service` uses the dedicated `nrn:nrn` account, memory pressure at
256 MB, a final 384 MB cap, swap capped at 256 MB, OOM score 500, CPU weight 200
and nice 5. The RACE example gives RACE greater CPU priority, OOM protection and
`MemoryLow=640M`. That protection also requires the reviewed 640 MB ancestor
budget on `system.slice`; the separate slice drop-in documents it. Review all
services in that parent before applying it. CPU weights compare siblings. These
settings never justify changing RACE's current working service without reviewing it.

No local PostgreSQL, Redis, RabbitMQ or other database is installed. Keep the
existing durable external stores. Keep root-owned release files read-only;
`/var/lib/nrnplay` is the only writable persistent service directory, pre-created
with owner `nrn:nrn` and mode 0750. The staged service does not create another
StateDirectory or a second user.

## Backend release layout

Replicate the existing Dockerfile, without changing application source:

1. In an isolated build checkout of the pinned commit, copy `server` and `shared`.
2. From `server`, run `node scripts/fix-pocha-imports.cjs`, `npm ci`, then
   `npm run build` using the pinned Node 22.23.5 runtime.
3. Assemble `/opt/nrnplay/releases/<commit>/server/dist` and the server
   `package.json`/`package-lock.json`; install runtime dependencies there with
   `npm ci --omit=dev --ignore-scripts`.
4. Point `/opt/nrnplay/current` at the reviewed immutable release. The executable
   is `server/dist/index.js`, matching Docker; there is no extra `dist/server/src`.
   The template pins `/opt/nrnplay/runtime/node-v22.23.5-linux-x64/bin/node`;
   the staged `/opt/nrnplay/node/bin/node` symlink resolves to that same runtime.
5. A mode-0600 `/etc/nrnplay/nrnplay.env`, owned by `nrn:nrn` inside the mode-0700
   `nrn:nrn` directory `/etc/nrnplay`, supplies the existing private
   database/account/webhook settings and exact `CLIENT_ORIGINS`. No values belong
   in Git, shell arguments, logs or this document. Preserve the current deployed
   BMC/Stripe configuration and schema.

Verify `LISTEN_HOST=127.0.0.1`, `PORT=3001` and
`MEMBERSHIP_TRUST_PROXY_HOPS=1` in the effective service environment. The latter
is safe only after verifying the single Caddy hop and no public access to port
3001. Existing Render proxy-hop settings must not be copied blindly. The unit
specifies the host/port too; an EnvironmentFile can override systemd Environment
entries, so review both. Only ports 80/443 should be public for the API.

## Legacy Render hostname

`legacy-proxy` has zero package dependencies and no database imports. Its only
upstream is the hardcoded `https://api.nrnplay.com`, with matching Host/SNI and
normal TLS verification. Render's existing hostname and Vercel admin rewrites
can keep working after its writer becomes this stateless proxy. Use the
repository-root build context with Dockerfile `ops/legacy-proxy/Dockerfile`.
The image copies only the three runtime files; it does not contain application
source, TLS test fixtures, the installation helper, or database libraries.
Pin Render to a dedicated proxy branch with that explicit Dockerfile path.
Keep future application deployments on the application branch: the legacy
service must never follow application-main updates or revert to the normal
Dockerfile/command. The normal application image does not copy `ops/`, so a
command-only override cannot launch this proxy safely.

The proxy reads Render's existing `MEMBERSHIP_AUTH_SECRET` and derives a separate
HMAC key with context `nrnplay:legacy-proxy:v3`. No new Render environment setting
is necessary. Install only the derived key in Caddy's protected environment,
using `write-caddy-key.mjs` with the existing secret supplied privately in its
environment. The helper refuses to overwrite a file and prints no key. It must
be run offline in a private administration context, never inside the public
image. Caddy never receives the main account signing secret. Review/reload the
derived key on both sides if the account secret is rotated. Loading a new
systemd EnvironmentFile requires restarting the Caddy process; a JSON-only reload
does not change its runtime environment. Coordinate that restart with RACE.
Before loading any private Caddy environment, apply the reviewed service drop-in
that clears ExecStart and replaces it with
`/usr/bin/caddy run --config /etc/caddy/Caddyfile`, without `--environ`. The
official unit can contain that flag, which prints the entire environment before
the runtime log filter is active. Check startup/reload wrappers and diagnostic
commands for environment dumps too. Keep the key out of their output.
Changing only this separated HMAC context rotates the transport credential
without changing the account signing secret, users or sessions. During the brief
old/new-key overlap, the old proxy key takes Caddy's direct branch and uses the
Render peer IP; account authentication remains independent.

Incoming `X-NRN-*`, `Forwarded`, `X-Forwarded-*` and common client-IP headers are
discarded. The proxy adds its own derived key and a strictly parsed peer address.
**Render edge forwarding has not been verified, so no XFF value is trusted.**
The reported address is `req.socket.remoteAddress`; legacy callers can share a
Render edge IP and rate limit. Do not enable trust in a supplied XFF chain until
Render's hop count/edge provenance is verified end to end, including a spoofing
test. Direct requests to Caddy retain Caddy's default spoof-resistant XFF behavior.

Caddy's authenticated legacy branch forwards that attested address and removes
all three private headers before Node. A wrong key follows the direct branch.
The CEL expression uses runtime environment placeholders and a key format guard;
it cannot turn an unset environment key into a presence-only header matcher. Caddy
needs its private derived-key EnvironmentFile before the reviewed Caddyfile is
adapted/validated or the service reloaded. Preserve the existing RACE sites and
do not add broad `trusted_proxies` globally. The global runtime log filter removes
`request.headers`, including the private key, authorization and cookies, while
retaining useful proxy errors. This is necessary even without access logging:
reverse-proxy failures can include request headers in runtime error records.
Merge it into the existing global block rather than replacing other settings.
If separate access loggers are added, apply equivalent redaction to those too.

The proxy pipes HTTP bodies unchanged, including webhook bytes, signatures,
authorization, cookies and Origin. It removes HTTP hop-by-hop headers and
reconstructs transport framing. It does not parse JSON, follow redirects, retry
POSTs, rewrite cookies, log requests, accept arbitrary destinations or support
CONNECT tunnels. TLS WebSocket upgrades preserve initial packets on both sides.
The reserved hop header stops accidental loops. Keep the API DNS pointing to
Azure, never back to the legacy Render proxy.

`GET`/`HEAD /health` returns a local 200 and does not inspect the database.
`/ready` and every other API/game path forward to Azure. The initial upstream
response/upgrade deadline is 30 seconds; HTTP idle timeout is 75 seconds and
shutdown drain is bounded at 7.5 seconds. Established WebSocket connections are
streamed until closed. The backend has verified PostgreSQL room snapshot
recovery. Preserve its graceful shutdown/final snapshot save before replacing
the writer, then verify recovery and reconnect on Azure; do not bypass shutdown
or run a second writer against the same snapshot/advisory-lock namespace.

## Single-writer handover and rollback

1. Finish the RACE measurement and review capacity first. Stage the immutable
   release, private environment and configs without starting another writer.
2. Review the exact current Render release and database schema. Switch Render
   to the dedicated stateless proxy branch/Dockerfile first. Its local `/health`
   returns 200 while Azure is still stopped, allowing Render to retire its old
   application instance. `/ready` and API requests can fail during this short
   maintenance interval; they must not start another writer to hide it.
3. Confirm Render's old **application writer** has completed graceful shutdown,
   saved its final PostgreSQL room snapshots and released its advisory locks.
   A live proxy deployment alone is not proof that the retired writer stopped.
4. Only then start Azure behind Caddy; verify passive readiness, restored rooms,
   login/session restoration,
   Socket.IO reconnection and webhook signatures against the same external DB.
   Do not test a real charge or send a webhook twice.
5. Keep legacy clients/admin rewrites functioning through the proxy. Validate spoofed
   forwarding headers are rejected and direct/legacy address behavior matches
   the reviewed trust policy. Update modern frontend API URLs only after those
   checks pass. DNS and service changes remain separate approvals; ensure
   `api.nrnplay.com` resolves to Azure before the proxy needs it.
6. Compare RACE's baseline and NRN's memory/CPU/errors after startup. If 1 GB is
   insufficient, stop NRN and retain RACE priority instead of raising NRN limits.
7. To roll back: stop the Azure writer **first**, wait for final snapshots and
   advisory-lock release, then restore the current
   compatible Render writer. Never restore an older BMC/schema-incompatible
   release, never run both writers, and never point the proxy upstream at itself.

No step above has been executed by these artifacts. Existing Render release and
database remain the fallback until the full handover is reviewed.

## Local verification

From `ops/legacy-proxy`, run `node --test test/proxy.test.mjs` with Node 22+.
The 11 tests passed locally on Node 22.16.0 and Node 24.22.1. Tests use an
explicitly trusted localhost TLS fixture, never disable TLS checks,
and exercise exact POST bytes, fixed destinations, spoofed headers, timeout/error
behavior, WebSocket packets/auth rejection and bounded shutdown. The fixture key
is intentionally public and is never copied to the runtime image.

Before applying templates on the Linux target, run `systemd-analyze verify` on
the assembled real service and `caddy validate` on the complete merged Caddyfile
with the private derived-key environment loaded. These Linux checks have not
been run by the local Windows tests.

References: [Node HTTP upgrade and streaming](https://nodejs.org/api/http.html),
[Caddy proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[systemd resource controls](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html).
