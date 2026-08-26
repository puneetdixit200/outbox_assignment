# Outbox Assignment Architecture

This repository implements a durable email scheduler with a Next.js client, Express API, PostgreSQL business state, Redis/BullMQ delayed execution, and a separate worker.

## Delivery flow

1. The authenticated client parses and deduplicates CSV/TXT recipients.
2. `POST /emails/schedule` validates sender ownership and accepts a stable `Idempotency-Key`.
3. The server applies `DEFAULT_MIN_SEND_DELAY_MS` as a hard floor and caps the requested campaign hourly limit at the sender-wide server maximum.
4. PostgreSQL commits one campaign and one `ENQUEUE_PENDING` row per recipient. The first recipient uses the requested start instant; later recipients use zero-based offsets.
5. BullMQ `addBulk()` creates deterministic one-recipient delayed jobs. Pending rows are recoverable if queue insertion is interrupted.
6. The worker atomically claims a row with a processing lease.
7. Before touching sender spacing, Redis performs an atomic non-consuming check of both the sender-global and campaign UTC-hour counters. If either is already full, the job moves directly to the next hour window.
8. Redis applies an atomic sender-spacing gate. When the sender is eligible, one worker advances the next-available timestamp; concurrent contenders receive the next eligible instant and return to BullMQ delayed state instead of pre-reserving a chain of future slots.
9. Immediately before SMTP, one Redis Lua script performs the authoritative sender + campaign hourly check-and-increment. Both counters advance only when both have capacity.
10. The worker sends through configured Ethereal SMTP.
11. Success records `SENT`, deterministic SMTP `Message-ID`, preview URL, timestamps, and a delivery ledger entry in PostgreSQL.

## Recovery and persistence

PostgreSQL is authoritative for business state; Redis/BullMQ is the execution scheduler. Docker Redis uses AOF and both Redis/PostgreSQL use named volumes.

Startup and periodic reconciliation target only inconsistent states:

- `ENQUEUE_PENDING` rows left after DB commit but incomplete BullMQ insertion
- expired `PROCESSING` leases

Normal `QUEUED` rows are not continuously recreated. Redis persistence is responsible for preserving healthy delayed jobs across process restarts.

For a stale processing row, reconciliation first checks the existing BullMQ job. Active jobs are left alone; healthy waiting/delayed jobs restore the DB row to `QUEUED`; terminal/missing jobs can be recreated with the deterministic job ID.

## Processing leases and retries

Claiming a job sets `PROCESSING`, `processing_started_at`, and `processing_lease_expires_at`. Rate/spacing deferrals do not count as SMTP delivery attempts. `attempt_count` increments immediately before SMTP, so repeated throttling cannot consume the retry budget.

A failed SMTP attempt clears the persisted spacing marker. A later retry must pass through the Redis spacing gate again and therefore cannot bypass the minimum delay relative to other messages.

When an hourly limit is already exhausted, the worker defers before it advances sender spacing. A final atomic hourly reservation remains authoritative immediately before SMTP to handle races among parallel workers.

## Delivery semantics

Scheduling and queue creation are idempotent through:

- `(owner_user_id, request_id)` campaign uniqueness
- per-email idempotency keys
- deterministic BullMQ job IDs
- state-guarded DB updates

The worker uses a syntactically valid deterministic SMTP message ID based on the scheduled-email UUID and records successful provider acceptance in `delivery_attempts`.

SMTP and PostgreSQL do not share a transaction. A crash after SMTP acceptance but before the success transaction commits can still cause a duplicate if the SMTP provider does not deduplicate repeated `Message-ID` values. The correct external-delivery claim is therefore at-least-once with idempotency safeguards, not exactly-once.

## Authentication and cookies

Google OAuth uses a cryptographically random state value stored in a short-lived HTTP-only cookie and verified during the callback. The returned Google profile must report a verified email.

Sessions are signed HTTP-only cookies. Local development uses `SameSite=Lax`; production uses `SameSite=None; Secure` so a separately hosted frontend and API can still exchange the credential over HTTPS.

A development helper requires the explicit `ALLOW_DEV_LOGIN=true` flag and is unavailable in production. The submitted UI exposes Google OAuth only rather than the development helper.

Production configuration fails fast when the session secret, Google credentials, or SMTP credentials are missing.

## Rate controls

### Sender spacing

Redis stores the next eligible timestamp per sender. The Lua script does not allocate a long sequence of future slots. If the sender is eligible now, one caller atomically advances the timestamp by the minimum delay. If the sender is not yet eligible, callers receive the same next eligible timestamp and move their BullMQ jobs back to delayed state.

This avoids phantom future spacing reservations for jobs that will be pushed out by hourly limits. The trade-off is additional BullMQ wake/defer churn during a very large same-sender burst.

### Hourly quota

The hourly logic uses two keys for the same UTC hour:

- sender-wide counter with the environment-configured hard maximum
- campaign counter with the user's requested campaign limit

A non-consuming atomic check is used before sender spacing so a fully exhausted hour does not spend spacing capacity. Immediately before SMTP, both counters are checked and incremented atomically. This second operation is authoritative and prevents parallel workers from overshooting either limit.

When either counter has no capacity, the job moves to the next UTC-hour boundary instead of being dropped.

## Time handling

The browser's `datetime-local` field is initialized using local wall-clock time, not a sliced UTC ISO string. On submission the browser converts that local value to an ISO UTC instant. This avoids timezone shifts such as the UTC+05:30 offset in India.

The database stores timestamps as `timestamptz`.

## Operational notes

- Worker concurrency is controlled by `WORKER_CONCURRENCY`.
- `DEFAULT_MIN_SEND_DELAY_MS` is a server-enforced floor, not merely a UI default.
- Redis rate counters are distributed and safe across multiple worker processes.
- BullMQ delayed jobs are the scheduler. The 30-second reconciliation pass only repairs anomalous DB/queue state and is not cron-based scheduling.
- Internal errors are logged server-side while clients receive generic 500 responses.
- Under a 1000+ same-sender burst, workers may contend and re-delay repeatedly at spacing boundaries, but jobs remain persistent and provider-facing sends stay serialized.

See the root README for setup, verification, restart demo steps, and assignment feature mapping.
