# Outbox Assignment Architecture

This repository implements a durable email scheduler with a Next.js client, Express API, PostgreSQL business state, Redis/BullMQ delayed execution, and a separate worker.

## Delivery flow

1. The authenticated client parses and deduplicates CSV/TXT recipients.
2. `POST /emails/schedule` validates sender ownership and accepts a stable `Idempotency-Key`.
3. The server applies `DEFAULT_MIN_SEND_DELAY_MS` as a hard floor and caps the requested campaign hourly limit at the sender-wide server maximum.
4. PostgreSQL commits one campaign and one `ENQUEUE_PENDING` row per recipient. The first recipient uses the requested start instant; later recipients use zero-based offsets.
5. BullMQ `addBulk()` creates deterministic one-recipient delayed jobs. Pending rows are recoverable if queue insertion is interrupted.
6. The worker atomically claims a row with a processing lease.
7. Redis atomically reserves a sender spacing slot. If the slot is in the future, the BullMQ job is moved back to delayed state rather than sleeping in the worker.
8. At the send instant, one Redis Lua script checks both the sender-global UTC-hour cap and the campaign UTC-hour cap and increments both only when both have capacity.
9. The worker sends through configured Ethereal SMTP.
10. Success records `SENT`, deterministic SMTP `Message-ID`, preview URL, timestamps, and a delivery ledger entry in PostgreSQL.

## Recovery and persistence

PostgreSQL is authoritative for business state; Redis/BullMQ is the execution scheduler. Docker Redis uses AOF and both Redis/PostgreSQL use named volumes.

Startup and periodic reconciliation target only inconsistent states:

- `ENQUEUE_PENDING` rows left after DB commit but incomplete BullMQ insertion
- expired `PROCESSING` leases

Normal `QUEUED` rows are not continuously recreated. Redis persistence is responsible for preserving healthy delayed jobs across process restarts.

For a stale processing row, reconciliation first checks the existing BullMQ job. Active jobs are left alone; healthy waiting/delayed jobs restore the DB row to `QUEUED`; terminal/missing jobs can be recreated with the deterministic job ID.

## Processing leases and retries

Claiming a job sets `PROCESSING`, `processing_started_at`, and `processing_lease_expires_at`. Rate/spacing deferrals do not count as SMTP delivery attempts. `attempt_count` increments immediately before SMTP, so repeated throttling cannot consume the retry budget.

A failed SMTP attempt clears the persisted spacing reservation. A later retry must reserve a new sender slot and therefore cannot bypass the minimum delay relative to other messages.

When an hourly limit is exhausted, the job is deferred to the next UTC hour and its old spacing reservation is cleared because that slot belonged to the exhausted hour.

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

Development login requires the explicit `ALLOW_DEV_LOGIN=true` flag and is unavailable in production. The submitted UI exposes Google OAuth rather than the development helper.

Production configuration fails fast when the session secret, Google credentials, or SMTP credentials are missing.

## Rate controls

### Sender spacing

Redis stores the next available timestamp per sender. A Lua script atomically reserves the next slot and advances the pointer by the requested inter-send delay. The key TTL is extended far enough to cover future reservations.

### Hourly quota

The hourly reservation script uses two keys for the same UTC hour:

- sender-wide counter with the environment-configured hard maximum
- campaign counter with the user's requested campaign limit

Both are checked and incremented atomically. This avoids the ambiguity of comparing one shared counter against different campaign limits.

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

See the root README for setup, verification, restart demo steps, and assignment feature mapping.
