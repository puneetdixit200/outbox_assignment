# OutBox / ReachInbox SDE Assignment
## Candidate Engineering Blueprint for a Next.js + Express + BullMQ Email Scheduler

> **Purpose of this document**
>
> This is an engineering study and implementation blueprint for a candidate building the assignment themselves. It intentionally explains architecture, contracts, invariants, failure modes, and verification criteria without providing a finished codebase or copy-paste implementation. The goal is to make the work understandable, testable, and defensible in an interview.

### How to use this blueprint

Treat the sections below as an implementation contract. Before coding, turn the
invariants, state transitions, API contracts, and manual test matrix into issues
or tasks. When a design choice is left open, choose one option, record it in the
README, and test the observable behavior rather than an implementation detail.

This document is deliberately not a claim that an implementation exists. The
submission is complete only when the candidate has built the system and has
evidence for the checks in sections 35–38 and 53–54.

---

## 1. What the assignment is really testing

The visible task is "schedule emails and show them in a dashboard." The actual assessment is broader. It tests whether the candidate can design a small production-style distributed system with durable scheduling, concurrency, throttling, authentication, persistence, and a usable frontend.

A strong submission should demonstrate the following engineering properties:

1. **Durability** - a scheduled email survives process restarts because its authoritative state is not stored only in application memory.
2. **Correct scheduling** - delayed jobs execute near the intended time and are not recreated from scratch whenever the API server boots.
3. **Idempotency** - the same logical email is not sent twice just because a worker crashed, retried, or saw the job more than once.
4. **Safe concurrency** - multiple jobs may run in parallel without corrupting database state or violating limits.
5. **Distributed rate limiting** - hourly limits remain correct even if more than one worker or application instance exists.
6. **Provider throttling** - individual sends are spaced by a configurable minimum interval.
7. **Operational clarity** - it is obvious what is scheduled, sent, failed, retried, or deferred.
8. **Authentication** - Google OAuth is real, not mocked.
9. **Frontend usability** - the dashboard is not just decorative; it reflects backend state and handles loading, empty, and error conditions.
10. **Explainability** - the README and demo should make the architecture easy to evaluate.

Treat these ten properties as the real rubric.

---

## 2. Recommended technology choices

The assignment allows some flexibility. For a coherent implementation, use this stack unless there is a strong personal reason to change it.

| Area | Recommended choice | Why |
|---|---|---|
| Frontend | Next.js App Router + TypeScript | Meets requirement and gives clean routing/layout support |
| Styling | Tailwind CSS | Fast to match the provided design |
| Backend | Express.js + TypeScript | Explicitly required |
| Database | PostgreSQL | Strong transactional semantics and easy local Docker setup |
| ORM | Prisma or Drizzle | Reduces query boilerplate while keeping schema understandable |
| Queue | BullMQ | Explicitly required and Redis-backed |
| Redis client | ioredis | Common companion for BullMQ and custom counters |
| SMTP | Nodemailer + Ethereal | Straightforward fake SMTP setup |
| Auth | Google OAuth via Auth.js on frontend OR Passport/backend OAuth | Both valid if backend identity is properly verified |
| Validation | Zod | Shared runtime validation and TypeScript types |
| CSV parsing | Papa Parse or a small robust parser | Handles common CSV edge cases |
| API calls | fetch or a small typed client wrapper | Avoid unnecessary frontend complexity |
| Containers | Docker Compose for Postgres + Redis | Reproducible local setup |

### Why PostgreSQL is preferable here

The assignment depends on reliable state transitions. PostgreSQL gives you transactions, row locks, unique constraints, timestamps, and strong concurrency behavior. Those are useful for claiming a job, recording send completion, and enforcing idempotency.

---

## 3. Monorepo structure

Use a monorepo so a reviewer can understand the whole system quickly.

```text
outbox-sde-assignment/
  apps/
    frontend/
      app/
        login/
        dashboard/
        api/                 # only if needed for frontend auth helpers
      components/
        auth/
        dashboard/
        email/
        ui/
      lib/
        api/
        auth/
        csv/
        validation/
      types/

    backend/
      src/
        config/
        db/
        routes/
        controllers/
        services/
        queue/
        workers/
        rate-limit/
        mail/
        auth/
        middleware/
        validation/
        types/
        utils/
        server.ts
        worker.ts
      prisma/ or db/

  packages/
    shared/
      src/
        api-types/
        enums/
        validation/

  docker-compose.yml
  .env.example
  package.json
  README.md
```

### Separation rule

Keep these responsibilities separate:

- **Route/controller**: HTTP concerns only.
- **Service**: business logic and orchestration.
- **Queue module**: queue connection, job creation, job naming, delay calculation.
- **Worker**: processes one job at a time according to worker concurrency.
- **Rate limiter**: decides whether the job can send now or must be deferred.
- **Mail service**: SMTP-only responsibility.
- **Repository/ORM layer**: database persistence.

Do not put queueing, database mutations, SMTP, and HTTP response logic into one giant route handler. It makes restart and retry behavior nearly impossible to reason about.

---

## 4. High-level architecture

```text
                    +---------------------------+
                    |         Next.js UI        |
                    | Login / Compose / Tables  |
                    +-------------+-------------+
                                  |
                                  | HTTPS / REST
                                  v
                    +---------------------------+
                    |      Express API Server   |
                    | auth + validation + CRUD  |
                    +------+------+-------------+
                           |      |
                 SQL writes|      | enqueue delayed jobs
                           v      v
                 +-----------+  +------------------+
                 |PostgreSQL |  | Redis + BullMQ   |
                 +-----+-----+  +---------+--------+
                       ^                  |
                       |                  | due jobs
                       |                  v
                       |        +-------------------+
                       +--------+ BullMQ Worker     |
                                | rate limit        |
                                | idempotency       |
                                | SMTP send         |
                                +---------+---------+
                                          |
                                          v
                                 +----------------+
                                 | Ethereal SMTP  |
                                 +----------------+
```

### Core ownership of data

- PostgreSQL is the **business source of truth** for email records and their statuses.
- Redis/BullMQ is the **execution scheduler and queue state**.
- The frontend never infers sent/scheduled status from BullMQ directly.
- The worker updates PostgreSQL after execution events.

This separation makes the dashboard stable even if queue internals change.

---

## 5. Domain model

Design the schema before coding the worker. Most queue bugs are actually state-model bugs wearing a Redis costume.

### 5.1 User

Suggested fields:

- `id`
- `googleSubject` or stable Google account identifier
- `email`
- `name`
- `avatarUrl`
- `createdAt`
- `updatedAt`

Use a unique constraint on the stable Google account identifier and normally also on email.

### 5.2 SenderAccount

The assignment mentions multiple senders. Model this explicitly even if the demo uses only one or two Ethereal senders.

Suggested fields:

- `id`
- `ownerUserId`
- `displayName`
- `fromEmail`
- `smtpHost`
- `smtpPort`
- `smtpUser`
- `smtpPassword` or encrypted secret/reference
- `isActive`
- `createdAt`

For a demo assignment, SMTP credentials can come from environment variables and sender rows can reference configured sender keys rather than storing raw passwords in the DB.

### 5.3 Campaign

A compose action with many recipients should create a campaign/batch entity.

Suggested fields:

- `id`
- `ownerUserId`
- `senderAccountId`
- `subject`
- `body`
- `requestedStartAt`
- `delayBetweenEmailsMs`
- `hourlyLimit`
- `recipientCount`
- `createdAt`

Why use Campaign instead of storing the subject/body repeatedly? It groups one user action, simplifies the UI, and makes the relationship between bulk upload and individual email jobs clear.

### 5.4 ScheduledEmail

This is the key state record.

Suggested fields:

- `id` - database UUID
- `campaignId`
- `senderAccountId`
- `recipientEmail`
- `scheduledAt`
- `status`
- `bullJobId`
- `idempotencyKey`
- `attemptCount`
- `lastError`
- `sentAt`
- `failedAt`
- `messageId` - SMTP result when available
- `previewUrl` - Ethereal preview URL when available
- `createdAt`
- `updatedAt`

### 5.5 Status enum

Use an explicit state machine rather than free-form strings.

Recommended logical states:

```text
SCHEDULED
ENQUEUE_PENDING
QUEUED
PROCESSING
DEFERRED_RATE_LIMIT
SENT
FAILED
CANCELLED   # optional if cancellation is implemented
```

`ENQUEUE_PENDING` makes the database/Redis failure window visible. A row may be
created in that state before its BullMQ job exists; a reconciler can safely retry
enqueueing it. If the implementation uses a different name, preserve the same
meaning and document the transitions.

### 5.6 Critical unique constraints

At minimum:

- `idempotencyKey` unique
- `bullJobId` unique if stored

The database must be able to reject duplicate logical scheduling if the same request is accidentally processed twice.

---

## 6. Scheduling model

### 6.1 One recipient = one queue job

For each parsed recipient:

1. Create a `ScheduledEmail` row.
2. Calculate its target send time.
3. Add one BullMQ delayed job whose job ID is deterministic or linked to the DB row.
4. Store the BullMQ job identifier in the DB.

Avoid one giant job containing thousands of recipients. A giant job makes retries, partial failures, rate limiting, and observability much worse.

### 6.2 Computing scheduled time

For a compose request containing:

- start time `T0`
- minimum delay `D`
- recipients in order `r0, r1, r2, ...`

The initial ideal target can be conceptualized as:

```text
recipient 0 -> T0
recipient 1 -> T0 + D
recipient 2 -> T0 + 2D
...
```

This only establishes an initial order. The hourly rate limiter may later defer jobs.

### 6.3 BullMQ delayed job

BullMQ stores delayed jobs in Redis. The API process can therefore stop after scheduling. The delayed job is not dependent on a JavaScript timer living in the API process.

That is the central persistence story you should explain in the README.

### 6.4 API and worker as separate processes

Run them separately:

```text
npm run dev:backend
npm run dev:worker
```

The API should not need to process jobs itself. Separating the worker makes concurrency and restart testing clearer.

---

## 7. Idempotency design

Idempotency is one of the most important parts of this assignment.

### 7.1 Problem

A queue system normally provides at-least-once style processing behavior under failures. A worker might:

1. receive a job,
2. send SMTP successfully,
3. crash before marking the DB row as sent,
4. retry the job.

Without a defensive strategy, the recipient could receive two emails.

### 7.2 Required invariant

> For one logical `ScheduledEmail`, the system must make the strongest practical effort to produce no more than one successful SMTP send.

### 7.3 Recommended database-level guard

Give every scheduled email a unique `idempotencyKey`. The worker should perform a transactional state claim before sending.

Conceptual flow:

```text
load record
  -> if SENT: return without sending
  -> if another worker already owns/claimed it: do not duplicate work
  -> atomically move eligible record to PROCESSING
  -> send
  -> record SENT + message metadata
```

### 7.4 Concurrency-safe claiming

The state transition from an eligible status to `PROCESSING` must be atomic.

Common approaches include:

- transaction + row-level lock,
- conditional update such as "update where status is still SCHEDULED/QUEUED",
- optimistic concurrency/version column.

The important property is that two workers cannot both successfully claim the same DB row.

### 7.5 Important limitation to explain

SMTP itself usually does not offer a transaction shared with your database. There is always a tiny failure window between "SMTP accepted message" and "database marked SENT". A good README should acknowledge this honestly and explain the mitigation.

Do not claim mathematically perfect exactly-once delivery unless you actually have provider-supported idempotency semantics. The assignment asks to prevent duplicate queue sends; robust idempotent state handling is the practical answer.

---

## 8. Worker concurrency

BullMQ worker concurrency should come from configuration:

```text
WORKER_CONCURRENCY=<number>
```

### 8.1 What concurrency means

If concurrency is 5, one worker process may have up to five jobs being processed at the same time.

Concurrency is not the same as rate limiting.

A system may support concurrency 10 while still allowing only 1 actual SMTP send every 2 seconds or 200 per hour.

### 8.2 Required safety

Every shared constraint must remain correct when jobs overlap:

- database record claiming,
- hourly sender counters,
- minimum-send-spacing logic,
- campaign order where practical.

Never use a module-level variable such as `emailsSentThisHour = 0` as the authoritative limiter. It breaks immediately when the process restarts or another worker exists.

---

## 9. Minimum delay between email sends

The requirement asks for a minimum delay to mimic provider throttling.

### 9.1 Configuration

Use an environment default and allow compose-level override if the UI exposes it.

Example conceptual configuration:

```text
DEFAULT_MIN_SEND_DELAY_MS=2000
```

The backend must validate this value and apply an upper bound. A request-level
delay may be accepted only within server policy; the browser must not be able to
select an unsafe value simply by bypassing the form. Define whether the delay is
per sender (recommended) or global, and use the same definition in the worker,
tests, and README.

### 9.2 Global versus per-sender spacing

Per-sender spacing is usually more useful because each sender represents a provider/account throttle domain.

Conceptual Redis key:

```text
sender:last_send:<senderId>
```

A worker checks whether the sender is eligible to send now. If not, it should defer the job instead of sleeping while occupying a worker slot for a long time.

### 9.3 Prefer rescheduling over long sleeps

Sleeping inside a worker is easy, but under load it wastes concurrency slots.

A more scalable design is:

1. compute next eligible timestamp,
2. move/defer the job until that timestamp,
3. release the worker slot.

For a small assignment, a short controlled wait may be acceptable, but explain the trade-off.

---

## 10. Hourly rate limiting

This is the most architecturally demanding requirement.

### 10.1 Choose a scope

A good choice is **per sender** because the assignment explicitly requires multiple senders.

Configuration could conceptually include:

```text
MAX_EMAILS_PER_HOUR_PER_SENDER=200
```

The compose form may provide an hourly limit too. Treat the effective limit as
`min(requestedLimit, serverMaximum)` and reject values that are missing, zero, or
above the server maximum. Never let a browser-supplied value raise the global
capacity.

### 10.2 Redis keying model

Use a deterministic hour window in UTC.

Conceptual key:

```text
rate:<senderId>:<YYYY-MM-DD-HH>
```

The value is the number of sends reserved or completed for that sender in the window.

### 10.3 Atomicity

The read/check/increment operation must be atomic across workers.

Do not implement:

```text
GET count
if count < limit:
    SET count + 1
```

Two workers can read the same count and both proceed.

Use one of:

- Redis atomic increment with carefully designed rollback/limit behavior,
- Redis transaction,
- Lua script,
- database row + transactional locking.

The design must make "check and reserve capacity" one atomic operation.

### 10.4 Reservation versus counting after send

Reserve quota **before** SMTP send. Otherwise several concurrent workers can all believe space is available.

If the SMTP attempt fails, decide whether the attempt consumes quota. Real providers often count attempts differently. For the assignment, either behavior can be defended if documented.

### 10.5 TTL

Rate keys should expire automatically after they are no longer useful. This prevents Redis from accumulating one key per sender per hour forever.

### 10.6 When the hour is full

Do not fail the job.

Compute the next eligible hour boundary and defer/reschedule the job.

Conceptual behavior:

```text
current window full
  -> mark DB status DEFERRED_RATE_LIMIT
  -> calculate next window start + small ordering offset
  -> delay job until then
  -> later retry
```

### 10.7 Preserving order

Perfect global ordering is hard with concurrency and multiple workers. The requirement says "preserving order as much as possible."

A reasonable strategy:

- create jobs in recipient order,
- include sequence index in job data,
- use predictable delay offsets,
- when deferring many jobs, preserve their original sequence with small offsets.

Document that strict serialization would reduce throughput and is not required.

---

## 11. Behavior with 1000+ emails scheduled together

The system should not create 1000 JavaScript timers and should not try to SMTP-send all 1000 simultaneously.

Expected behavior:

1. API validates request.
2. Recipients are normalized and deduplicated according to your chosen policy.
3. Database rows are created in bulk or transactionally.
4. BullMQ receives one durable job per recipient.
5. Due jobs become eligible.
6. Worker concurrency controls how many are processed at once.
7. Sender spacing controls minimum interval.
8. Hourly rate limiter reserves capacity.
9. Excess jobs are deferred to the next available rate window.
10. Dashboard remains queryable from PostgreSQL throughout.

### Load-related design notes

- Prefer DB batch inserts for large recipient lists.
- Prefer BullMQ bulk add where practical.
- Paginate dashboard tables.
- Do not return thousands of full records in every frontend refresh.
- Use indexes on `status`, `scheduledAt`, `sentAt`, `campaignId`, and `ownerUserId` where useful.

---

## 12. Persistence and restart behavior

### 12.1 API restart

The API server should be stateless enough that restarting it does not alter already-scheduled jobs.

Because scheduled data exists in PostgreSQL and delayed execution exists in Redis/BullMQ, the API can restart safely.

### 12.2 Worker restart

A worker restart should allow BullMQ to recover pending/stalled work according to BullMQ behavior and your configured retry policy.

The worker must inspect DB state before any send, so a recovered job does not blindly repeat a completed email.

### 12.3 Redis restart

For a strong demo, Redis should use persistence in Docker if possible. At minimum, document Redis persistence assumptions. PostgreSQL alone cannot make BullMQ delayed jobs survive if Redis is intentionally wiped.

### 12.4 Do not rebuild everything on boot

Avoid a startup routine that deletes and recreates every future queue job. That violates the spirit of "does not restart from scratch."

A reconciliation routine can be reasonable as a recovery tool, but it should be conservative and idempotent, not a normal destructive boot process.

---

## 13. Retry strategy

Transient SMTP/network errors should be retried; malformed recipients should not be retried endlessly.

### Suggested classification

**Retryable:**

- temporary network error,
- SMTP temporary rejection,
- connection reset,
- transient Redis/DB issue where job can safely retry.

**Usually non-retryable:**

- structurally invalid recipient,
- missing campaign data,
- disabled sender configuration,
- permanent authentication/configuration error until human correction.

Use capped retries and backoff. Record the latest error in PostgreSQL so the frontend can show a useful failure state.

---

## 14. Queue job contract

Keep job payload small and stable.

Prefer:

```text
scheduledEmailId
```

plus perhaps minimal metadata such as:

```text
campaignId
sequence
```

Do not put full mutable campaign bodies, SMTP passwords, or user objects into the queue payload.

The worker should load authoritative data from PostgreSQL using the scheduled email ID.

### Job naming

Use a clear name such as:

```text
send-email
```

### Deterministic job ID

A BullMQ job ID based on the scheduled email record or idempotency key helps prevent accidental duplicate enqueues.

---

## 15. API design

Use a versioned base such as `/api/v1`.

### 15.1 Authentication endpoints

If auth is managed mostly by Next.js/Auth.js, the Express API still needs a reliable way to identify the caller. Options include:

- frontend obtains a signed token and sends it as bearer auth,
- backend participates directly in OAuth,
- frontend server proxies authenticated requests.

Do not trust a client-supplied `userId` parameter.

### 15.2 Schedule endpoint

Conceptual endpoint:

```text
POST /api/v1/emails/schedule
```

Request fields:

- subject
- body
- recipients[]
- senderId
- startAt
- delayBetweenEmailsMs
- hourlyLimit

Validation rules:

- subject non-empty and bounded,
- body non-empty or according to chosen policy,
- at least one valid recipient,
- recipient count under an explicit safety maximum,
- start time valid,
- delay non-negative and inside allowed bounds,
- hourly limit positive and under server-configured maximum,
- sender belongs to authenticated user.

Response should include campaign ID, count scheduled, and perhaps first/last scheduled timestamps.

### 15.3 List scheduled emails

```text
GET /api/v1/emails/scheduled
```

Useful query parameters:

- page
- pageSize
- campaignId
- status
- sort

Return paginated data.

### 15.4 List sent emails

```text
GET /api/v1/emails/sent
```

Return sent and optionally failed terminal records according to frontend design.

### 15.5 Campaign endpoint (optional but useful)

```text
GET /api/v1/campaigns/:id
```

Allows the UI to show campaign summary counts.

### 15.6 Health endpoints

Useful operational endpoints:

```text
GET /health
GET /ready
```

`health` can mean process alive. `ready` can verify DB/Redis dependencies if you implement it.

---

## 16. API response conventions

Use consistent shapes.

Conceptual success shape:

```text
{
  data: ...,
  meta: ...
}
```

Conceptual error shape:

```text
{
  error: {
    code: "VALIDATION_ERROR",
    message: "...",
    details: ...
  }
}
```

Centralize Express error handling. Do not make every controller invent a different JSON error format.

---

## 17. Google OAuth

The assignment requires real Google login.

### 17.1 Required user experience

1. User opens app.
2. If unauthenticated, user sees Google sign-in.
3. Google consent/auth occurs.
4. Successful auth redirects to dashboard.
5. Header shows name, email, avatar.
6. Logout clears the session/token and returns to login state.

### 17.2 Security requirements

- verify Google tokens/session server-side,
- validate audience/client ID,
- do not trust profile data posted manually by the browser,
- secure session cookies if cookies are used,
- keep client secret server-side,
- use environment variables,
- configure exact callback URLs.

### 17.3 Ownership

Every campaign, sender, and scheduled email must be scoped to the authenticated user. Listing endpoints must never return another user's data.

---

## 18. Ethereal Email

Ethereal is ideal because it accepts SMTP messages without delivering to real inboxes and provides a preview URL.

### Configuration fields

- SMTP host
- SMTP port
- SMTP username
- SMTP password
- from address/name

### Send result to store

When available, store:

- message ID,
- accepted recipients,
- rejected recipients,
- preview URL,
- sent timestamp.

Showing the Ethereal preview URL in a development-only detail view is useful for the demo, even if not required by the Figma.

---

## 19. Next.js frontend architecture

Use App Router with a clear split between pages and reusable components.

### Recommended routes

```text
/login
/dashboard
/dashboard/scheduled
/dashboard/sent
```

Compose may be a modal triggered from the dashboard rather than a route if that matches the design.

### Recommended component groups

**Layout:**

- AppHeader
- UserMenu
- DashboardShell
- TabNavigation

**Compose:**

- ComposeEmailModal
- SubjectField
- BodyField
- LeadFileUpload
- RecipientCount
- StartTimePicker
- DelayField
- HourlyLimitField
- SenderSelect
- ScheduleButton

**Tables:**

- ScheduledEmailTable
- SentEmailTable
- StatusBadge
- Pagination
- TableSkeleton
- EmptyState

**Feedback:**

- Toast
- InlineError
- LoadingSpinner

### State management

Do not introduce Redux merely because Redux exists. Local component state plus server/API fetching is enough for this assignment unless your design genuinely needs more.

---

## 20. Compose workflow

### 20.1 File input

Accept at least CSV and plain text if the brief permits both.

### 20.2 Parsing rules

Define them explicitly:

- trim whitespace,
- ignore empty rows,
- extract the configured email column or discover email-like values,
- normalize casing where appropriate,
- validate syntax,
- optionally deduplicate within one upload,
- show valid recipient count,
- optionally show invalid count.

Do not silently send to malformed addresses.

### 20.3 Scheduling form validation

The frontend should catch obvious mistakes, but backend validation remains authoritative.

Useful validations:

- no recipients,
- empty subject,
- start time in an invalid range,
- delay negative,
- hourly limit zero/negative,
- file too large,
- unsupported format.

### 20.4 Success behavior

After scheduling:

- close/reset modal,
- show success toast,
- refresh scheduled list,
- show count created.

---

## 21. Scheduled Emails screen

Minimum columns:

- Email
- Subject
- Scheduled time
- Status

Useful optional fields:

- Sender
- Campaign
- Attempts

### UX states

**Loading:** skeleton rows or spinner.

**Empty:** clear message such as no emails are currently scheduled and a compose action.

**Error:** readable retry option.

### Time formatting

Store timestamps in UTC in the backend. Render in the user's local timezone on the frontend.

---

## 22. Sent Emails screen

Minimum columns:

- Email
- Subject
- Sent time
- Status

Terminal statuses should visually distinguish success and failure.

Optional row detail can include:

- error reason,
- attempt count,
- Ethereal preview link.

---

## 23. Data synchronization strategy

For this assignment, simple polling is sufficient.

Options:

- refresh on navigation,
- refresh after compose,
- poll every few seconds while dashboard is open.

Do not build WebSockets unless you have spare time and a clear reason. The rubric cares far more about scheduling correctness than decorative real-time infrastructure.

---

## 24. Environment configuration

Prepare `.env.example` with names but no secrets.

Suggested categories:

### Backend

```text
NODE_ENV
BACKEND_PORT
FRONTEND_URL
DATABASE_URL
REDIS_URL
WORKER_CONCURRENCY
DEFAULT_MIN_SEND_DELAY_MS
MAX_EMAILS_PER_HOUR_PER_SENDER
JOB_ATTEMPTS
JOB_BACKOFF_MS
```

### Ethereal / SMTP

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM_EMAIL
SMTP_FROM_NAME
```

### Google OAuth

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
AUTH_SECRET or SESSION_SECRET
GOOGLE_CALLBACK_URL
```

### Frontend

```text
NEXT_PUBLIC_API_BASE_URL
```

Keep server-only secrets out of `NEXT_PUBLIC_*` variables.

---

## 25. Docker Compose

A clean development stack should include:

- PostgreSQL service,
- Redis service,
- named volumes for persistence,
- health checks if practical.

You do not need to containerize Next.js and Express unless you want to. The assignment only recommends Docker for Redis/DB.

### Persistence note

Use named volumes so stopping and starting containers does not automatically erase state.

---

## 26. Database indexes

Potential useful indexes:

- `(ownerUserId, status)`
- `(campaignId)`
- `(scheduledAt)`
- `(sentAt)`
- `(senderAccountId, status)`

Unique constraints:

- `(idempotencyKey)`
- `(bullJobId)` if applicable.

Do not create indexes blindly. Each should support an actual lookup, sort, or uniqueness invariant.

---

## 27. Transactions

Use transactions around logically atomic business operations.

### Scheduling transaction

A bulk scheduling request should avoid leaving half-created business state if a database operation fails. Depending on implementation, you may:

- create campaign + email rows transactionally,
- enqueue after DB commit,
- reconcile rare enqueue failures explicitly.

### Why not enqueue inside a DB transaction casually

Redis and PostgreSQL do not share one transaction. If the DB rolls back after Redis accepted jobs, or Redis fails after DB commit, you can get inconsistency.

A sophisticated solution may use an outbox pattern. For this assignment, a simpler documented reconciliation strategy is acceptable.

The key is to understand and explain the failure window instead of pretending two independent systems commit atomically.

---

## 28. Queue/DB consistency strategy

A practical approach:

1. create campaign and `ScheduledEmail` rows,
2. commit DB transaction,
3. enqueue jobs with deterministic job IDs,
4. update rows with queue metadata,
5. if enqueue partially fails, mark affected records with a recoverable scheduling error or run an idempotent reconciliation step.

Because job IDs are deterministic, retrying enqueue should not create duplicate logical jobs.

---

## 29. State transitions

Document this in the README.

```text
SCHEDULED
   |
   v
QUEUED
   |
   v
PROCESSING ----------------------+
   |                              |
   | allowed by limiter           | limit unavailable
   v                              v
 SEND SMTP                 DEFERRED_RATE_LIMIT
   |                              |
   | success                      | delayed retry
   v                              +----> QUEUED/PROCESSING
 SENT

PROCESSING
   |
   | terminal error / retries exhausted
   v
 FAILED
```

Keep transitions controlled by service functions rather than arbitrary status writes spread throughout the codebase.

---

## 30. Date and timezone rules

- Accept ISO timestamps from frontend.
- Convert to a canonical UTC instant on the backend.
- Store timestamps in UTC.
- Compute BullMQ delay using server current time versus target UTC instant.
- Display in browser-local time.
- Reject or intentionally handle target times already in the past.

Timezone bugs are an excellent way to make a scheduling assignment look haunted.

---

## 31. Validation and sanitization

Validate every API boundary.

### Compose payload

- max subject length,
- max body size,
- recipient count max,
- email syntax,
- finite numeric limits,
- sensible delay ceiling,
- sender ownership.

### Query params

- page integer,
- page size capped,
- allowed sort values only,
- allowed status enum only.

Never concatenate user input into raw SQL.

---

## 32. Security checklist

- secrets only in environment variables,
- `.env` ignored by Git,
- CORS restricted to expected frontend origin,
- auth required for data endpoints,
- ownership enforced in DB queries,
- OAuth token/session verified server-side,
- HTTP-only cookies if cookie sessions are used,
- reasonable body-size limits,
- uploaded file processed as data, never executed,
- SMTP credentials never returned to frontend,
- generic server errors in production,
- detailed errors logged server-side.

---

## 33. Logging

Use structured, useful logs.

For each worker job, useful context includes:

- job ID,
- scheduledEmailId,
- senderId,
- recipient,
- attempt number,
- scheduling/defer decision,
- SMTP result,
- error class.

Never log SMTP passwords, OAuth secrets, or full session tokens.

---

## 34. Metrics you would care about in production

You do not need a full metrics stack, but mentioning these demonstrates design awareness:

- scheduled count,
- queue depth,
- jobs waiting/delayed/active/failed,
- sends per hour per sender,
- send success rate,
- send latency,
- retry rate,
- rate-limit deferrals,
- oldest waiting job age.

---

## 35. Testing strategy

A high-quality submission should contain targeted tests around the risky behavior rather than dozens of trivial tests.

### 35.1 Unit tests

Test pure calculations and validation:

- schedule time calculation,
- UTC hour window key generation,
- next-window time calculation,
- email parsing/deduplication,
- status transition rules,
- request validation.

### 35.2 Integration tests

Use real test Redis/Postgres where practical for:

- scheduling creates DB rows and queue jobs,
- worker claims one record once,
- sent record becomes SENT,
- failed send records error,
- hourly limit defers excess jobs,
- concurrent workers cannot exceed limit,
- deterministic job ID prevents duplicate enqueue.

### 35.3 Frontend tests

At minimum verify:

- compose validation,
- parsed recipient count,
- loading state,
- empty state,
- API error state,
- successful scheduling refresh.

---

## 36. Critical manual test matrix

Use this matrix before recording the demo.

| Scenario | Expected result |
|---|---|
| Schedule one email 2 minutes ahead | Appears in Scheduled, sends near target |
| Restart API before due time | Email still sends |
| Restart worker before due time | Email still sends when worker returns |
| Schedule 5 emails with spacing | Sends honor minimum interval |
| Set hourly limit lower than batch | Excess emails are deferred, not failed |
| Run worker with concurrency > 1 | No duplicate sends or limit overrun |
| Submit duplicate request/idempotency case | No duplicate logical send |
| Invalid CSV rows | Invalid addresses not silently scheduled |
| Empty scheduled list | Empty state visible |
| SMTP failure | Email eventually failed/retried according to policy |
| Logout | Protected dashboard/data no longer accessible |

---

## 37. Restart demo procedure

The assignment explicitly asks for this.

A convincing demonstration:

1. Start Redis, Postgres, API, worker, frontend.
2. Schedule an email several minutes into the future.
3. Show it in Scheduled Emails.
4. Stop API and worker processes.
5. Keep PostgreSQL and Redis data intact.
6. Start API and worker again.
7. Do **not** recreate the campaign.
8. Wait for due time.
9. Show record moving to Sent.
10. Open Ethereal preview if helpful.

Explain that Redis retains the delayed BullMQ job and PostgreSQL retains business state.

---

## 38. Rate-limit demo procedure

A compact demo can use intentionally tiny limits.

Example concept:

- concurrency: 3,
- min delay: a few seconds,
- hourly limit: 2,
- recipients: 4 or 5.

Show:

1. first allowed jobs send,
2. remaining jobs are not dropped,
3. their state changes to deferred/scheduled for next allowed window,
4. queue/DB still contains them.

For a five-minute video, you may use a development-only shorter test window internally, but the actual implemented production setting should still support the required hourly semantics. If you use such a testing shortcut, document it clearly.

---

## 39. Figma implementation strategy

Do not begin by polishing pixels while the scheduler does not work.

Recommended order:

1. inspect the design and identify layout primitives,
2. create dashboard shell,
3. implement header/user card,
4. implement tabs,
5. implement generic table,
6. implement compose modal,
7. connect real data,
8. then refine spacing, typography, borders, colors, responsive behavior.

Use reusable primitives rather than copying markup between Scheduled and Sent views.

---

## 40. Accessibility and UX

Reasonable polish:

- labels associated with inputs,
- keyboard-accessible modal,
- visible focus styles,
- disabled submit while scheduling,
- form errors near fields,
- descriptive empty states,
- status conveyed by text, not color alone,
- table usable on smaller screens through horizontal scroll or responsive layout.

---

## 41. Performance notes

For the assignment scale:

- paginate results,
- select only fields needed by tables,
- bulk insert recipients,
- bulk enqueue jobs where safe,
- keep job payload small,
- avoid repeatedly fetching campaign body for table listings if not required,
- index common filters.

Do not prematurely build Kafka, Kubernetes, or fourteen microservices. The assignment wants production thinking, not a distributed systems cosplay convention.

---

## 42. Failure scenarios to reason through

### API crashes during scheduling

Ask: which records exist, which jobs exist, and can the operation be retried safely?

### Worker crashes before SMTP

Job retries. DB claim/state should permit safe recovery.

### Worker crashes after SMTP but before DB update

This is the hardest duplicate window. Document mitigation and limitation.

### Redis temporarily unavailable

API should return a meaningful scheduling failure or persist recoverable state according to chosen strategy. Worker cannot consume while Redis is down.

### PostgreSQL unavailable

Worker should not send blindly because it cannot verify idempotent state.

### Rate counter reservation succeeds, SMTP fails

Define whether quota remains consumed or is released. Document the choice.

### Two workers receive equivalent work

DB state and deterministic job IDs should prevent duplicate logical execution.

---

## 43. Suggested build sequence

### Phase 1 - Repository and infrastructure

- monorepo scripts,
- PostgreSQL + Redis Docker Compose,
- environment parsing,
- backend health endpoint,
- database migration setup.

**Checkpoint:** API can connect to DB and Redis.

### Phase 2 - Domain schema

- users,
- senders,
- campaigns,
- scheduled emails,
- enums,
- indexes and unique constraints.

**Checkpoint:** migrations are reproducible from empty DB.

### Phase 3 - Basic scheduler

- scheduling API,
- row creation,
- BullMQ queue,
- delayed job calculation,
- worker process.

**Checkpoint:** one future email sends through Ethereal.

### Phase 4 - Persistence and idempotency

- deterministic job IDs,
- DB claim transition,
- restart test,
- duplicate-processing guard.

**Checkpoint:** restarting worker/API does not recreate or duplicate work.

### Phase 5 - Rate controls

- configurable concurrency,
- minimum sender delay,
- Redis-backed hourly counters,
- deferral behavior.

**Checkpoint:** concurrent test respects configured limits.

### Phase 6 - Authentication

- Google OAuth,
- persistent/local user record,
- protected API,
- ownership filters.

**Checkpoint:** one user cannot query another user's rows.

### Phase 7 - Next.js dashboard

- shell/header,
- scheduled/sent tabs,
- tables,
- compose modal,
- file parser,
- API integration.

**Checkpoint:** complete end-to-end scheduling from browser.

### Phase 8 - UX and design

- match Figma,
- errors,
- loading,
- empty states,
- responsive behavior.

### Phase 9 - Tests and documentation

- risky logic tests,
- restart demo,
- rate-limit demo,
- README,
- `.env.example`,
- final cleanup.

---

## 44. 48-hour prioritization

If time becomes tight, prioritize correctness in this order:

1. durable BullMQ scheduling,
2. DB persistence,
3. idempotent worker behavior,
4. hourly distributed rate limiting,
5. concurrency,
6. minimum delay,
7. Ethereal send,
8. Google OAuth,
9. complete functional dashboard,
10. visual polish,
11. optional extras.

Do not sacrifice a required backend invariant to add animations.

---

## 45. README structure

Your final README should be written from what you actually implemented.

Recommended headings:

1. Project overview
2. Architecture
3. Tech stack
4. Repository structure
5. Prerequisites
6. Environment variables
7. Local setup
8. Running PostgreSQL and Redis
9. Running migrations
10. Running backend API
11. Running BullMQ worker
12. Running Next.js frontend
13. Google OAuth setup
14. Ethereal setup
15. Scheduling flow
16. Persistence and restart behavior
17. Idempotency strategy
18. Worker concurrency
19. Minimum delay strategy
20. Hourly rate-limit strategy
21. Behavior under large batches
22. API endpoints
23. Features implemented
24. Testing
25. Demo video link
26. Assumptions and trade-offs
27. Known limitations

Never claim a feature you have not actually tested.

---

## 46. Architecture explanation template

When explaining the project to a reviewer, be able to answer these questions in your own words:

- Why is PostgreSQL the business source of truth?
- Why is Redis needed if the data is already in PostgreSQL?
- What exactly does BullMQ persist?
- What happens when the API process restarts?
- What happens when a worker dies mid-job?
- How do you stop two workers sending the same email?
- How does the hourly limiter remain safe across multiple workers?
- Why is an in-memory counter incorrect?
- How do excess emails move into the next hour?
- How do you preserve ordering?
- Where is the minimum email delay enforced?
- How are multiple senders isolated?
- Why is one recipient modeled as one job?
- What is the remaining exactly-once limitation around SMTP?

If you cannot explain these, the implementation is not yet interview-ready even if the UI works.

---

## 47. API-to-database ownership matrix

| Action | Auth required | Primary tables | Queue interaction |
|---|---|---|---|
| Login | OAuth | User | none |
| List senders | yes | SenderAccount | none |
| Schedule campaign | yes | Campaign + ScheduledEmail | add delayed jobs |
| List scheduled | yes | ScheduledEmail + Campaign | none |
| List sent | yes | ScheduledEmail + Campaign | none |
| Worker process | internal | ScheduledEmail + Campaign + Sender | consume job |

This table helps keep queue internals out of frontend-facing APIs.

---

## 48. Worker decision flow

Use this as a reasoning checklist while writing the worker yourself.

```text
Job received
  |
  v
Load ScheduledEmail + Campaign + Sender
  |
  +--> missing? -> terminal/recoverable handling
  |
  +--> already SENT? -> complete without SMTP
  |
  v
Attempt atomic claim
  |
  +--> claim failed -> another worker owns/completed it -> stop safely
  |
  v
Check sender active/config valid
  |
  v
Check minimum-send spacing eligibility
  |
  +--> too early -> defer
  |
  v
Atomically reserve hourly quota
  |
  +--> unavailable -> defer to next window
  |
  v
Send via Ethereal SMTP
  |
  +--> success -> mark SENT + metadata
  |
  +--> retryable failure -> record attempt and retry
  |
  +--> terminal failure -> mark FAILED
```

Each branch should have an explicit DB-state outcome.

---

## 49. Invariants worth writing down

Strong systems become easier to debug when invariants are explicit.

1. A `ScheduledEmail` belongs to exactly one campaign.
2. A scheduled email has exactly one logical idempotency key.
3. A `SENT` email is never intentionally sent again.
4. Only authenticated owners can view their campaigns/emails.
5. Hourly capacity is reserved atomically.
6. A rate-limited job is delayed, not discarded.
7. A process restart does not erase business state.
8. Redis delayed jobs are not reconstructed destructively on every startup.
9. SMTP secrets never reach the browser.
10. Queue payload contains identifiers, not sensitive authoritative objects.

---

## 50. Optional improvements after all requirements work

Only attempt these after the core rubric is complete:

- campaign summary counts,
- cancel scheduled campaign,
- retry failed emails manually,
- search/filter tables,
- sender management UI,
- BullMQ queue dashboard for development,
- SSE/WebSocket live updates,
- observability metrics,
- outbox pattern for DB/queue consistency,
- encryption for stored SMTP credentials,
- integration-test containers,
- deployment configuration.

---

## 51. Common mistakes that will weaken the submission

- using `setTimeout` as the scheduler,
- using cron despite the explicit prohibition,
- keeping hourly counters only in memory,
- putting every recipient into one queue job,
- sending before checking DB idempotency state,
- recreating all queue jobs on every server startup,
- marking email `SENT` before SMTP actually succeeds,
- accepting client-provided user IDs as authentication,
- exposing SMTP credentials to Next.js client components,
- fetching all emails without pagination,
- swallowing SMTP errors and still marking success,
- hardcoding concurrency/rate values,
- no empty/loading/error states,
- README that says "production grade" without explaining failure modes.

---

## 52. Submission checklist

### Repository

- [ ] Private GitHub repository
- [ ] Required reviewers/collaborators granted access
- [ ] No secrets committed
- [ ] Clean commit history
- [ ] `.env.example` present
- [ ] Reproducible migrations

### Backend

- [ ] TypeScript
- [ ] Express
- [ ] PostgreSQL/MySQL
- [ ] BullMQ + Redis
- [ ] Delayed jobs, no cron
- [ ] Multiple senders supported
- [ ] Ethereal SMTP
- [ ] Configurable concurrency
- [ ] Configurable minimum send delay
- [ ] Configurable hourly limit
- [ ] Distributed-safe rate limiter
- [ ] Excess jobs deferred, not dropped
- [ ] Persistence across restart
- [ ] Idempotency protections
- [ ] Useful errors and logs

### Frontend

- [ ] Next.js
- [ ] Google OAuth real login
- [ ] Name/email/avatar shown
- [ ] Logout
- [ ] Scheduled Emails section
- [ ] Sent Emails section
- [ ] Compose New Email
- [ ] Subject
- [ ] Body
- [ ] CSV/text upload
- [ ] Recipient count
- [ ] Start time
- [ ] Delay control
- [ ] Hourly limit control
- [ ] Schedule action connected to backend
- [ ] Loading states
- [ ] Empty states
- [ ] Error handling
- [ ] Reusable components
- [ ] TypeScript types
- [ ] Styling close to Figma

### Documentation

- [ ] Run backend instructions
- [ ] Run worker instructions
- [ ] Run frontend instructions
- [ ] DB/Redis setup
- [ ] Ethereal setup
- [ ] Google OAuth setup
- [ ] Environment variables
- [ ] Architecture overview
- [ ] Scheduling explanation
- [ ] Restart persistence explanation
- [ ] Concurrency explanation
- [ ] Rate-limit explanation
- [ ] Assumptions
- [ ] Trade-offs
- [ ] Known limitations

### Demo

- [ ] Create scheduled emails
- [ ] Show Scheduled table
- [ ] Show Sent table
- [ ] Demonstrate restart survival
- [ ] Show Ethereal result
- [ ] Bonus: rate-limit/delay demonstration
- [ ] Video under required length

---

## 53. Final engineering review before submission

Ask yourself:

### Correctness

- Can one logical email be duplicated by a retry?
- Can two concurrent workers exceed the sender hourly limit?
- Can restart lose a future email?
- Can an already-sent email be accidentally reclaimed?

### Persistence

- What data is in PostgreSQL?
- What data is in Redis?
- What disappears if the API process dies?
- What disappears if the worker process dies?

### Security

- Can one logged-in user access another user's campaign?
- Is any secret included in frontend JavaScript?
- Are uploaded recipients treated only as data?

### UX

- Is every asynchronous screen readable while loading?
- Is no-data behavior intentional?
- Does scheduling failure produce a useful message?

### Explainability

- Can you draw the architecture in 30 seconds?
- Can you explain the limiter without reading code?
- Can you explain the SMTP exactly-once limitation honestly?
- Can you demonstrate restart behavior live?

---

## 54. What "done" means

The project is not done when the page looks like the Figma. It is done when all of these are simultaneously true:

1. A user can authenticate with Google.
2. A user can upload recipients and schedule a campaign from Next.js.
3. PostgreSQL contains persistent business records.
4. BullMQ contains durable delayed jobs.
5. A separate worker sends through Ethereal.
6. Restarting API/worker does not erase pending work.
7. Worker concurrency is configurable.
8. Minimum send spacing is enforced.
9. Hourly quota is distributed-safe.
10. Excess jobs defer rather than fail.
11. Duplicate logical sends are guarded against.
12. Scheduled and Sent tables accurately reflect persisted state.
13. Errors, loading states, and empty states are intentional.
14. README explains how and why the design works.
15. The demo proves the important claims.

That is the standard to build toward.

### Completion evidence packet

For the final review, keep one short evidence packet with links or commands for
each claim. This prevents a polished UI from being mistaken for a verified
system.

| Claim | Minimum evidence |
|---|---|
| Durable scheduling | DB row and BullMQ delayed job before an API restart; same record sends afterward |
| Worker recovery | Worker stopped and restarted before the due time; no lost or duplicate logical record |
| Idempotency | Replayed job or concurrent worker test; at most one row reaches `SENT` |
| Hourly quota | Configured low limit with multiple workers; observed sends never exceed the limit |
| Minimum spacing | Timestamps from at least three sends showing the configured lower bound |
| Ownership | Authenticated integration test proving user A cannot read or mutate user B data |
| Failure handling | Retryable SMTP failure and terminal validation/configuration failure with visible states |
| Frontend behavior | Browser proof of loading, empty, success, and error states |

Record the test date, configuration values, commit SHA, and any known limitation.
Do not describe a check as passing if it was only reasoned about or manually
inspected in source code.

---

## 55. Suggested personal implementation notes section

As you build, keep a short private log containing:

- decisions you made,
- alternatives you rejected,
- bugs you hit,
- why you chose your limiter model,
- how you tested restart behavior,
- what remains imperfect.

This becomes extremely useful in the interview because reviewers often ask about trade-offs rather than syntax.

---

## 56. Source brief

Assignment page provided by OutBox / ReachInbox:

`https://sumptuous-word-80f.notion.site/Software-Development-Intern-Assignment-2bc1596f45e88080995cec1180a2bc60`

The assignment brief should remain the authority if any requirement conflicts with this planning document.
