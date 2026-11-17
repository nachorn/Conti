# Local primary snapshots and an offsite checkpoint

No database, plan or infrastructure is provisioned by this code. Development
tests use fixtures; the operational deployment is recorded in
`ops/free/APPLIED.md`. The existing PostgreSQL connection is used only by
explicit migration/checkpoint invocations.

## Runtime selection

Omitting `NRN_STORAGE_MODE` preserves the existing storage selection. Setting it
to exactly `file` makes both game and membership factories ignore `DATABASE_URL`.
Production requires distinct absolute `GAME_STATE_PATH` and
`MEMBERSHIP_STATE_PATH` on the reviewed persistent Azure disk. Both regular files
must already exist before startup; a partial import cannot silently initialize
an empty account store. There is no automatic fallback to an older PG checkpoint.

Keep the existing account secret unchanged. The snapshots retain account IDs,
password verifiers, session hashes and expirations, room codes, seat hashes,
leagues, match results and payment records. No migration creates a user, sends
email, extends a session or replays a webhook. Each namespace retains the 16 MB
limit and the existing single-writer file lock / atomic-fsync save behavior.

## Offline import from the existing PostgreSQL database

The normal server build compiles the CLI to:

```
node server/dist/cli/migrate-to-local.js --plan
```

Supply `DATABASE_URL`, `MEMBERSHIP_AUTH_SECRET`, `GAME_STATE_PATH` and
`MEMBERSHIP_STATE_PATH` privately in its environment. No credentials or paths are
accepted as arguments. Stop the previous writer first. The CLI obtains both
transaction advisory locks `(0x434f4e54, 1)` and `(0x434f4e54, 2)` without waiting;
if either belongs to a running writer, it refuses. It reads both namespaces in a
single statement after the locks, using a read-only READ COMMITTED transaction,
and validates their existing
GameRepository/MembershipService formats using in-memory stores.

Review the counts, sizes and two hashes in the plan, then run:

```
node server/dist/cli/migrate-to-local.js --apply --confirm-writer-stopped --expected-game-sha256 REVIEWED_GAME_HASH --expected-membership-sha256 REVIEWED_MEMBERSHIP_HASH
```

The hashes must still match the source. Both destination paths must be absent.
The installer stages private files through FileSnapshotStore, then installs
exclusive hard links; it never overwrites existing files. Each file installation
is atomic. Filesystems have no shared atomic operation for the two paths: a normal
failure removes only links created by this invocation; a hard crash can leave one
file. Production's both-files guard refuses that incomplete state. Start the app
only after a successful CLI result and independent verification of both files.

New directories are private and new snapshot files are mode 0600. Existing
directory ownership/permissions remain the operator's responsibility. No raw
snapshots, passwords, database URLs, seat credentials or emails are logged.

## Hourly checkpoint to the existing PostgreSQL database

The job is external; this code contains no scheduler or background SQL heartbeat.
Apply the reviewed RACE/memory guard in the timer's ExecCondition **before Node
starts**, with low-priority resource limits. Skipping under load is intentional.

```
node server/dist/cli/checkpoint-local-to-postgres.js --plan
node server/dist/cli/checkpoint-local-to-postgres.js --apply
```

Plan validates local files only and never connects to PostgreSQL. Apply captures
accounts-before, one committed game file, then accounts-after. If the account
bytes changed it retries, up to three attempts. A successful capture means the
account file was unchanged across that game read. It does not lock or pause the
active application's files. Both snapshots are validated before connecting, so
unstable/corrupt local data does not wake the database.

Apply opens one temporary PostgreSQL connection, takes the two try-transaction
writer locks, and upserts `conti_game_state` and `conti_membership_state` together
with synchronous commit. If an old writer holds either lock it rolls back and
returns `skipped-writer-active` without writing. A SQL failure rolls both updates
back. The connection closes after the invocation; no persistent locks, SQL pings,
pool or automatic retries keep Neon awake. All errors use fixed diagnostic codes.

An hourly checkpoint is a best-effort backup, not a second active server. Skipped
or failed jobs increase the age of the recoverable copy; monitor those results.
Restoration uses a reviewed, stopped-writer import into empty local paths. Never
start the old PG writer concurrently with the local primary or restore an old
checkpoint automatically after a local write failure.

## Validation

Local tests cover credential preservation, explicit mode selection, partial-file
startup refusal, no-overwrite installation, private permissions (on Unix), a
second-file failure, coherent capture/retry, and PG transaction/lock behavior via
a query fixture. They do not connect to production or replace a real PostgreSQL
integration check. CLI imports are inert; only direct execution runs their main
functions. Validate realistic snapshot sizes against the backup process's memory
limit before relying on checkpoints near the 16 MB-per-namespace maximum.
