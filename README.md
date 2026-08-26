# Outbox SDE Assignment

A durable full-stack email scheduler built with **Next.js + TypeScript**, **Express**, **PostgreSQL**, **Redis/BullMQ**, and **Ethereal SMTP**.

## Features

### Backend

- Express + TypeScript REST API
- PostgreSQL-backed users, sender identities, campaigns, and email state
- BullMQ delayed jobs backed by persistent Redis
- deterministic BullMQ job IDs for enqueue idempotency
- configurable worker concurrency
- sender-global and campaign-specific hourly rate limits enforced atomically in Redis
- configurable minimum delay between sends using sender-level Redis slot reservation
- processing leases and recovery for stale worker claims
- bounded retries with exponential BullMQ backoff
- Ethereal SMTP via Nodemailer
- Google OAuth with CSRF `state` validation
- HTTP-only signed session cookie
- authenticated ownership checks for sender/campaign data

### Frontend

- Next.js App Router + TypeScript
- Tailwind CSS toolchain plus project styling
- Google login
- user name, email, avatar, and logout
- Scheduled and Sent/Failed tabs
- Compose flow with subject, body, sender, start time, delay, hourly limit, and CSV/TXT upload
- email extraction, normalization, deduplication, and recipient count
- loading, empty, error, pagination, and disabled-submit states

## Repository layout

```text
apps/
  api/                 Express API + BullMQ worker
  web/                 Next.js frontend
docs/
  architecture.md      implementation/failure-mode notes
scripts/
  smoke.sh             local end-to-end smoke test
docker-compose.yml     PostgreSQL + persistent Redis
```

## Prerequisites

- Node.js 20+
- npm
- Docker + Docker Compose, or separately managed PostgreSQL and Redis
- Google OAuth credentials
- Ethereal Email SMTP credentials

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run db:seed
```

Run the three processes in separate terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open `http://localhost:3000`.

## Environment variables

The committed `.env.example` contains placeholders only. Do not commit real credentials.

Important values:

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `SESSION_SECRET` - long random signing secret
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `SMTP_HOST` - Ethereal uses `smtp.ethereal.email`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `WORKER_CONCURRENCY`
- `PROCESSING_LEASE_MS`
- `DEFAULT_MIN_SEND_DELAY_MS`
- `MAX_EMAILS_PER_HOUR_PER_SENDER`
- `JOB_ATTEMPTS`
- `JOB_BACKOFF_MS`

`ALLOW_DEV_LOGIN` and `ALLOW_DEV_MAIL` are **local testing switches only** and default to `false`. They are not accepted as substitutes for the required Google OAuth and Ethereal setup.

When `NODE_ENV=production`, startup requires an explicit session secret, Google OAuth credentials, and SMTP credentials.

## Google OAuth setup

Create a Google OAuth Web application and configure the exact callback URL from `GOOGLE_CALLBACK_URL`, for example:

```text
http://localhost:4000/auth/google/callback
```

For a deployed environment use the deployed API URL. The backend creates a random OAuth `state`, stores it in a short-lived HTTP-only cookie, and verifies it during the callback before creating the session.

After first Google login, the backend creates the user and a default sender identity based on the verified Google email. The schema supports multiple sender identities; the compose UI selects among the active identities returned by the API.

## Ethereal Email setup

Create an Ethereal test account and copy its SMTP host/user/password into `.env`.

The worker sends through Nodemailer and stores the returned provider message ID and Ethereal preview URL. Missing SMTP credentials are treated as configuration failure for production/submission use.

## Scheduling flow

1. The frontend extracts and deduplicates recipient addresses.
2. `POST /emails/schedule` validates the request and sender ownership.
3. The server enforces `DEFAULT_MIN_SEND_DELAY_MS` as a hard minimum even if the client asks for a smaller delay.
4. PostgreSQL commits the campaign and one `ENQUEUE_PENDING` row per recipient.
5. The first recipient is scheduled exactly at the requested start time; later recipients use `(sequence - 1) × delay`.
6. BullMQ `addBulk()` creates one delayed job per email with a deterministic job ID.
7. The worker claims each DB row with a processing lease before execution.
8. Sender spacing and hourly capacity are enforced in Redis.
9. The email is sent using Ethereal SMTP.
10. PostgreSQL records `SENT`/`FAILED`, send time, message ID, preview URL, errors, and attempt count.

An `Idempotency-Key` header protects campaign creation against HTTP retries. The frontend keeps the same key for the life of a compose attempt rather than generating a different key for each retry.

## Persistence and restart behavior

PostgreSQL is the source of truth for business state. Redis/BullMQ is the durable execution scheduler.

Redis runs with AOF enabled in `docker-compose.yml`, and both PostgreSQL and Redis use named volumes. Restarting the API or worker does not recreate the campaign from scratch.

The worker periodically reconciles:

- `ENQUEUE_PENDING` rows left after a DB commit/queue failure
- stale `PROCESSING` rows whose processing lease expired

Deterministic BullMQ job IDs make recovery enqueue operations idempotent.

### Restart demo

1. Schedule emails several minutes in the future.
2. Confirm they appear under Scheduled Emails.
3. Stop the API and worker, leaving PostgreSQL and Redis running.
4. Start API and worker again.
5. Confirm the original jobs still execute and appear in Sent Emails.
6. Confirm previously sent rows are not restarted from the beginning.

## Concurrency and minimum send spacing

`WORKER_CONCURRENCY` configures BullMQ worker concurrency.

Parallel workers do not rely on an in-process counter. Sender spacing is reserved with an atomic Redis Lua operation. Each reservation advances a sender-specific "next available" timestamp, so simultaneous jobs receive different slots.

If the current job is too early for its slot, it is moved back into BullMQ delayed state rather than sleeping inside a worker process.

## Hourly rate limiting

Two counters are checked and incremented atomically in one Redis Lua script:

1. sender-global UTC-hour counter, capped by `MAX_EMAILS_PER_HOUR_PER_SENDER`
2. campaign UTC-hour counter, capped by the campaign's requested hourly limit

A send proceeds only if both counters have capacity. When either limit is exhausted, the job is moved to the next UTC-hour window. It is not discarded or permanently failed.

This design means multiple campaigns can coexist for one sender while the sender-wide hard cap still cannot be exceeded.

## Idempotency and delivery semantics

The system prevents duplicate scheduling with:

- unique campaign request IDs
- unique scheduled-email idempotency keys
- deterministic BullMQ job IDs
- transactional DB state transitions
- a delivery-attempt ledger
- deterministic SMTP `Message-ID` values

There is still no distributed transaction spanning SMTP and PostgreSQL. If SMTP accepts a message and the process dies before PostgreSQL commits the success, a provider that does not deduplicate `Message-ID` can receive a duplicate on retry. The implementation therefore describes external delivery as **at-least-once with idempotency safeguards**, not mathematically exactly-once.

## Behavior under load

If 1000+ emails become eligible around the same time:

- BullMQ persists the jobs rather than creating one JavaScript timer per email
- worker concurrency bounds parallel processing
- Redis spacing serializes provider-facing sends per sender
- Redis hourly counters defer excess jobs to later hour windows
- PostgreSQL preserves observable state throughout the process

## API overview

```text
GET  /health
GET  /ready
GET  /auth/me
GET  /auth/google
GET  /auth/google/callback
POST /auth/logout
GET  /senders
POST /emails/schedule
GET  /emails/scheduled
GET  /emails/sent
```

A development-only `POST /auth/dev-login` exists for the local smoke test and is disabled unless `ALLOW_DEV_LOGIN=true`; it is unavailable in production.

## Verification

Run pure unit tests and both production builds:

```bash
npm test
npm run build
```

The rate-limit unit tests import pure policy helpers and therefore do not require Redis just to load the test module.

For a local end-to-end smoke test, deliberately enable the local test login before starting the API:

```bash
ALLOW_DEV_LOGIN=true npm run dev:api
npm run dev:worker
npm run test:smoke
```

Use real Ethereal credentials for SMTP verification. `ALLOW_DEV_MAIL=true` is available only for local infrastructure testing when SMTP itself is not what is being tested.

## Assignment feature mapping

| Requirement | Implementation |
| --- | --- |
| delayed persistent scheduling | BullMQ delayed jobs + Redis AOF |
| relational persistence | PostgreSQL |
| no cron | BullMQ jobs; periodic reconciliation only repairs inconsistent state |
| restart survival | Redis/Postgres persistence + reconciliation |
| concurrency | configurable BullMQ worker concurrency |
| delay between sends | Redis sender slot reservation |
| hourly limit | atomic Redis sender + campaign hour counters |
| multiple senders | sender-account model + compose sender selection |
| SMTP | Nodemailer + Ethereal |
| Google login | real Google OAuth |
| compose | Next.js compose modal |
| CSV/text leads | browser parsing + backend validation |
| scheduled/sent views | authenticated paginated API + dashboard tabs |
| loading/empty/error states | frontend dashboard states |

## Trade-offs

- SMTP and PostgreSQL cannot be committed atomically; the remaining crash window is documented above.
- Redis hourly windows are fixed UTC-hour buckets rather than sliding 60-minute windows.
- Sender identities share one configured Ethereal SMTP account; they represent separate `From` identities for throttling and scheduling.
- Reconciliation is recovery logic, not the scheduling mechanism. Normal scheduling is performed entirely with BullMQ delayed jobs.

## Submission checklist

Before submitting:

- make the GitHub repository **private**
- grant repository access to the reviewers requested in the assignment
- use real Google OAuth credentials and demonstrate Google login
- use real Ethereal credentials and show the Ethereal preview/send result
- run `npm test` and `npm run build`
- perform the restart scenario above
- demonstrate a deliberately small hourly limit and show excess jobs being deferred
- compare the dashboard against the supplied Figma and correct visible layout differences
- add the final demo-video link (maximum five minutes) to the submission form/README as required

See [`docs/architecture.md`](docs/architecture.md) for the failure-model details.
