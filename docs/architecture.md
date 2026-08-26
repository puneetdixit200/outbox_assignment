# Outbox Assignment Architecture

This repository implements a durable email scheduler with a Next.js client,
Express API, PostgreSQL business state, Redis/BullMQ delayed execution, and a
separate worker.

## Delivery flow

1. The authenticated client parses and deduplicates CSV/TXT recipients.
2. `POST /emails/schedule` validates ownership, a positive inter-send delay,
   and an optional `Idempotency-Key`.
3. PostgreSQL commits one campaign and one `ENQUEUE_PENDING` row per recipient.
   The first recipient uses the requested start instant; later recipients use
   zero-based offsets.
4. BullMQ `addBulk()` creates deterministic one-recipient jobs. A worker
   reconciles rows left pending after a Redis/API failure.
5. The worker atomically claims a row with a five-minute processing lease,
   reserves a sender-global hourly quota with Redis Lua, reserves the sender's
   next spacing slot, and sends through configured Ethereal SMTP.
6. Success records `SENT`, the deterministic SMTP `Message-ID`, preview URL,
   and timestamps in PostgreSQL. The UI reads those records with pagination.

## Recovery and delivery guarantees

PostgreSQL is authoritative; Redis is the execution scheduler. Startup and
periodic reconciliation enqueue pending rows, reclaim expired processing leases,
and repair queued rows whose BullMQ job is missing. Deterministic job IDs make
enqueue retries safe.

SMTP and PostgreSQL do not share a transaction. The worker therefore uses a
deterministic idempotency key as the SMTP `Message-ID`, records a delivery
ledger, and checks persisted state before every send. A crash after SMTP accepts
the message but before PostgreSQL commits can still produce a duplicate with a
provider that does not deduplicate `Message-ID`; the system documents this as an
at-least-once external-delivery limitation rather than claiming exactly once.

## Authentication and secrets

Google OAuth uses a random, HTTP-only, short-lived state cookie validated in the
callback. Sessions are HTTP-only signed cookies. Development login is disabled
when `NODE_ENV=production`. SMTP credentials are global environment secrets and
are never stored in sender rows or sent to the browser. Production requires all
SMTP credentials; the explicit development-only mail adapter is opt-in.

## Rate controls

Hourly quota is one sender-global UTC-hour counter using an atomic Redis Lua
check-and-increment. Campaign limits are metadata and cannot raise the server's
sender cap. Spacing uses an atomic Redis future-slot reservation, so concurrent
workers receive distinct send slots instead of waking as a herd. A full quota
defers jobs to the next UTC hour rather than dropping them.

## Running and proving it

See the root README for setup, environment variables, Docker services, Google
OAuth/Ethereal configuration, and smoke-test commands. `npm test` covers pure
rate-control contracts; `npm run test:smoke` proves readiness, authentication,
scheduling, queue execution, and persisted `SENT` state against running local
services. `npm run build` type-checks and builds both workspaces.
