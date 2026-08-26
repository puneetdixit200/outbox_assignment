# Outbox SDE Assignment

Runnable Next.js + Express + PostgreSQL + Redis/BullMQ email scheduler.

## Quick start

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev:api     # terminal 1
npm run dev:worker  # terminal 2
npm run dev:web     # terminal 3
```

Open http://localhost:3000. In development, the login screen offers a local
demo login. Google OAuth is available when its three variables are configured.
For local-only work, set `ALLOW_DEV_MAIL=true` explicitly to use the development
mail adapter. Submitted/production configuration must provide Ethereal SMTP
credentials; production refuses the development adapter.

## Configuration notes

- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact callback URL in
  Google Cloud Console to enable the OAuth button.
- Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` for Ethereal. The sender
  address remains server-side and is never placed in browser code.
- `WORKER_CONCURRENCY`, `PROCESSING_LEASE_MS`, `DEFAULT_MIN_SEND_DELAY_MS`, and
  `MAX_EMAILS_PER_HOUR_PER_SENDER` are server-controlled safety bounds.
- CSV and text recipient files are parsed in the browser into normalized,
  deduplicated addresses; the API validates them again.

If Docker is unavailable, the API still supports any PostgreSQL and Redis
instances matching `DATABASE_URL` and `REDIS_URL`.

## Runtime shape

- PostgreSQL owns users, senders, campaigns, and email state.
- Redis/BullMQ owns delayed execution and retry scheduling.
- The API writes business state and enqueues one job per recipient.
- Database scheduling commits campaign/email rows first; `ENQUEUE_PENDING` rows
  are reconciled by the worker if Redis is unavailable during the request.
- The worker claims rows transactionally, reserves distributed quota, applies
  per-sender spacing, and sends through the configured mail adapter.
- The Next.js UI reads persisted state from the API and never treats queue state
  as the source of truth.
- List endpoints are paginated and the dashboard exposes loading, empty, error,
  recipient-count, CSV upload, and delivery-state views.

See [the implementation architecture](docs/architecture.md) for the actual
delivery guarantees, recovery behavior, OAuth state validation, rate-limit
semantics, and known SMTP limitation.

## Verification

```bash
npm test
npm run build
```

The API also exposes `/health` and `/ready`. See
[docs/architecture.md](docs/architecture.md) for the implemented design,
failure guarantees, and demo matrix.
