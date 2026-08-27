import { Worker, Job, DelayedError } from 'bullmq';
import { config } from './config.js';
import { query, withTransaction, pool } from './db/client.js';
import { redis, emailQueue, enqueueEmail } from './queue.js';
import { hasHourlyCapacity, reserveHourlyCapacity, reserveSpacing, nextHour } from './rateLimiter.js';
import { sendMail } from './mail.js';

type EmailRow = {
  id: string;
  campaign_id: string;
  sender_account_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  from_email: string;
  idempotency_key: string;
  status: string;
  scheduled_at: Date;
  spacing_reserved_at: Date | null;
  hourly_limit: number;
  delay_between_emails_ms: number;
  attempt_count: number;
};

type RecoveryRow = {
  id: string;
  scheduled_at: Date;
  bull_job_id: string | null;
  status: string;
};

async function loadEmail(id: string) {
  const result = await query<EmailRow>(
    `SELECT e.*, c.subject, c.body, c.hourly_limit, c.delay_between_emails_ms, s.from_email
     FROM scheduled_emails e
     JOIN campaigns c ON c.id=e.campaign_id
     JOIN sender_accounts s ON s.id=e.sender_account_id
     WHERE e.id=$1`,
    [id]
  );
  return result.rows[0];
}

async function claim(id: string) {
  return withTransaction(async client => {
    const result = await client.query(
      `UPDATE scheduled_emails
       SET status='PROCESSING', processing_started_at=now(),
           processing_lease_expires_at=now() + ($2::integer * interval '1 millisecond'), updated_at=now()
       WHERE id=$1 AND (
         status IN ('SCHEDULED','QUEUED','DEFERRED_RATE_LIMIT') OR
         (status='PROCESSING' AND processing_lease_expires_at < now())
       )
       RETURNING id`,
      [id, config.PROCESSING_LEASE_MS]
    );
    return result.rowCount === 1;
  });
}

async function defer(id: string, when: Date, clearSpacing = false) {
  await query(
    `UPDATE scheduled_emails
     SET status='DEFERRED_RATE_LIMIT', scheduled_at=$2,
         processing_started_at=NULL, processing_lease_expires_at=NULL,
         spacing_reserved_at=CASE WHEN $3::boolean THEN NULL ELSE spacing_reserved_at END,
         updated_at=now()
     WHERE id=$1`,
    [id, when, clearSpacing]
  );
}

async function beginDeliveryAttempt(id: string) {
  const result = await query<{ attempt_count: number }>(
    `UPDATE scheduled_emails
     SET attempt_count=attempt_count+1, updated_at=now()
     WHERE id=$1 AND status='PROCESSING'
     RETURNING attempt_count`,
    [id]
  );
  if (!result.rowCount) throw new Error('Email lost processing ownership before SMTP send');
  return result.rows[0].attempt_count;
}

async function restoreRecordedDelivery(id: string) {
  const recorded = await query<{ provider_message_id: string }>(
    'SELECT provider_message_id FROM delivery_attempts WHERE scheduled_email_id=$1',
    [id]
  );
  if (!recorded.rowCount) return false;
  await query(
    `UPDATE scheduled_emails
     SET status='SENT', message_id=COALESCE(message_id,$2), sent_at=COALESCE(sent_at,now()),
         processing_started_at=NULL, processing_lease_expires_at=NULL, spacing_reserved_at=NULL, updated_at=now()
     WHERE id=$1`,
    [id, recorded.rows[0].provider_message_id]
  );
  return true;
}

async function processJob(job: Job<{ scheduledEmailId: string }>) {
  const id = job.data.scheduledEmailId;
  const email = await loadEmail(id);
  if (!email || email.status === 'SENT' || email.status === 'CANCELLED') return;
  if (!(await claim(id))) return;
  if (await restoreRecordedDelivery(id)) return;

  const senderLimit = config.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const campaignLimit = Math.min(email.hourly_limit, senderLimit);

  const capacityAvailable = await hasHourlyCapacity(
    email.sender_account_id,
    email.campaign_id,
    senderLimit,
    campaignLimit,
    new Date()
  );

  if (!capacityAvailable) {
    const when = nextHour();
    await defer(id, when, true);
    await job.moveToDelayed(when.getTime(), job.token);
    throw new DelayedError();
  }

  const spacingAt = await reserveSpacing(
    email.sender_account_id,
    email.delay_between_emails_ms,
    Date.now()
  );

  await query(
    `UPDATE scheduled_emails
     SET spacing_reserved_at=to_timestamp($2 / 1000.0), scheduled_at=to_timestamp($2 / 1000.0), updated_at=now()
     WHERE id=$1 AND status='PROCESSING'`,
    [id, spacingAt]
  );

  if (spacingAt > Date.now()) {
    await defer(id, new Date(spacingAt));
    await job.moveToDelayed(spacingAt, job.token);
    throw new DelayedError();
  }

  const reservedHourlyCapacity = await reserveHourlyCapacity(
    email.sender_account_id,
    email.campaign_id,
    senderLimit,
    campaignLimit,
    new Date()
  );

  if (!reservedHourlyCapacity) {
    const when = nextHour();
    await defer(id, when, true);
    await job.moveToDelayed(when.getTime(), job.token);
    throw new DelayedError();
  }

  await beginDeliveryAttempt(id);

  try {
    const deterministicMessageId = `<outbox-${id}@scheduler.local>`;
    const sent = await sendMail({
      to: email.recipient_email,
      subject: email.subject,
      body: email.body,
      from: email.from_email,
      messageId: deterministicMessageId
    });

    await withTransaction(async client => {
      await client.query(
        `INSERT INTO delivery_attempts (scheduled_email_id,idempotency_key,provider_message_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (scheduled_email_id) DO NOTHING`,
        [id, email.idempotency_key, sent.messageId]
      );
      await client.query(
        `UPDATE scheduled_emails
         SET status='SENT', sent_at=now(), message_id=$2, preview_url=$3,
             processing_started_at=NULL, processing_lease_expires_at=NULL, spacing_reserved_at=NULL,
             last_error=NULL, updated_at=now()
         WHERE id=$1`,
        [id, sent.messageId, sent.previewUrl ?? null]
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE scheduled_emails
       SET status=CASE WHEN attempt_count >= $2 THEN 'FAILED' ELSE 'QUEUED' END,
           last_error=$3,
           failed_at=CASE WHEN attempt_count >= $2 THEN now() ELSE failed_at END,
           processing_started_at=NULL, processing_lease_expires_at=NULL, spacing_reserved_at=NULL,
           updated_at=now()
       WHERE id=$1`,
      [id, config.JOB_ATTEMPTS, message]
    );
    throw error;
  }
}

async function reconcilePending() {
  const candidates = await query<RecoveryRow>(
    `SELECT id, scheduled_at, bull_job_id, status
     FROM scheduled_emails
     WHERE status='ENQUEUE_PENDING'
        OR (status='PROCESSING' AND (processing_lease_expires_at IS NULL OR processing_lease_expires_at < now()))
     ORDER BY created_at
     LIMIT 500`
  );

  for (const row of candidates.rows) {
    if (row.status === 'PROCESSING' && row.bull_job_id) {
      const existingJob = await emailQueue.getJob(row.bull_job_id);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'active') continue;
        if (['waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) {
          await query(
            `UPDATE scheduled_emails
             SET status='QUEUED', processing_started_at=NULL, processing_lease_expires_at=NULL, updated_at=now()
             WHERE id=$1 AND status='PROCESSING'`,
            [row.id]
          );
          continue;
        }
        try {
          await existingJob.remove();
        } catch {
          continue;
        }
      }
    }

    await query(
      `UPDATE scheduled_emails
       SET status='QUEUED', processing_started_at=NULL, processing_lease_expires_at=NULL, spacing_reserved_at=NULL, updated_at=now()
       WHERE id=$1 AND status IN ('ENQUEUE_PENDING','PROCESSING')`,
      [row.id]
    );
    const jobId = await enqueueEmail(row.id, new Date(row.scheduled_at));
    await query(
      `UPDATE scheduled_emails SET bull_job_id=$2,status='QUEUED',updated_at=now()
       WHERE id=$1 AND status='QUEUED'`,
      [row.id, jobId]
    );
  }

  if (candidates.rowCount) console.log(`reconciled ${candidates.rowCount} pending/stale email jobs`);
}

export const worker = new Worker('outbox-send-email', processJob, {
  connection: redis,
  concurrency: config.WORKER_CONCURRENCY
});

worker.on('completed', job => console.log(`completed ${job.id}`));
worker.on('failed', (job, error) => console.error(`failed ${job?.id}: ${error.message}`));

void reconcilePending().catch(error => console.error('initial queue reconciliation failed', error));
const reconciliationTimer = setInterval(
  () => void reconcilePending().catch(error => console.error('queue reconciliation failed', error)),
  30_000
);

async function shutdown() {
  clearInterval(reconciliationTimer);
  await worker.close();
  await emailQueue.close();
  await redis.quit();
  await pool.end();
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
console.log(`worker running with concurrency=${config.WORKER_CONCURRENCY}`);
