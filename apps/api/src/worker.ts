import { Worker, Job, DelayedError } from 'bullmq';
import { config } from './config.js';
import { query, withTransaction, pool } from './db/client.js';
import { redis, enqueueEmail } from './queue.js';
import { reserveHourlyCapacity, reserveSpacing, nextHour } from './rateLimiter.js';
import { sendMail } from './mail.js';

type EmailRow = { id:string; campaign_id:string; sender_account_id:string; recipient_email:string; subject:string; body:string; from_email:string; status:string; scheduled_at:Date; hourly_limit:number; delay_between_emails_ms:number; attempt_count:number };
async function loadEmail(id: string) { const result = await query<EmailRow>(`SELECT e.*, c.subject, c.body, c.hourly_limit, c.delay_between_emails_ms, s.from_email FROM scheduled_emails e JOIN campaigns c ON c.id=e.campaign_id JOIN sender_accounts s ON s.id=e.sender_account_id WHERE e.id=$1`, [id]); return result.rows[0]; }
async function claim(id: string) { return withTransaction(async client => { const result = await client.query(`UPDATE scheduled_emails SET status='PROCESSING', attempt_count=attempt_count+1, updated_at=now() WHERE id=$1 AND status IN ('SCHEDULED','QUEUED','DEFERRED_RATE_LIMIT') RETURNING id`, [id]); return result.rowCount === 1; }); }
async function defer(id: string, when: Date) { await query(`UPDATE scheduled_emails SET status='DEFERRED_RATE_LIMIT', scheduled_at=$2, updated_at=now() WHERE id=$1`, [id, when]); return when; }
async function processJob(job: Job<{scheduledEmailId:string}>) {
  const id = job.data.scheduledEmailId; const email = await loadEmail(id); if (!email || email.status === 'SENT' || email.status === 'CANCELLED') return;
  if (!(await claim(id))) return;
  const spacingAt = await reserveSpacing(email.sender_account_id, email.delay_between_emails_ms, Date.now());
  if (spacingAt > Date.now()) { await defer(id, new Date(spacingAt)); await job.moveToDelayed(spacingAt, job.token); throw new DelayedError(); }
  if (!(await reserveHourlyCapacity(email.sender_account_id, email.hourly_limit, new Date()))) { const when = nextHour(); await defer(id, when); await job.moveToDelayed(when.getTime(), job.token); throw new DelayedError(); }
  try { const sent = await sendMail({ to: email.recipient_email, subject: email.subject, body: email.body, from: email.from_email }); await query(`UPDATE scheduled_emails SET status='SENT', sent_at=now(), message_id=$2, preview_url=$3, updated_at=now() WHERE id=$1`, [id, sent.messageId, sent.previewUrl ?? null]); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); await query(`UPDATE scheduled_emails SET status=CASE WHEN attempt_count >= $2 THEN 'FAILED' ELSE 'QUEUED' END, last_error=$3, failed_at=CASE WHEN attempt_count >= $2 THEN now() ELSE failed_at END, updated_at=now() WHERE id=$1`, [id, config.JOB_ATTEMPTS, message]); throw error; }
}
async function reconcilePending() {
  const pending = await query<{ id: string; scheduled_at: Date }>(`SELECT id, scheduled_at FROM scheduled_emails WHERE status='ENQUEUE_PENDING' ORDER BY created_at LIMIT 500`);
  for (const row of pending.rows) {
    const jobId = await enqueueEmail(row.id, new Date(row.scheduled_at));
    await query(`UPDATE scheduled_emails SET bull_job_id=$2,status='QUEUED',updated_at=now() WHERE id=$1 AND status='ENQUEUE_PENDING'`, [row.id, jobId]);
  }
  if (pending.rowCount) console.log(`reconciled ${pending.rowCount} pending email jobs`);
}
export const worker = new Worker('outbox-send-email', processJob, { connection: redis, concurrency: config.WORKER_CONCURRENCY });
worker.on('completed', job => console.log(`completed ${job.id}`)); worker.on('failed', (job, error) => console.error(`failed ${job?.id}: ${error.message}`));
void reconcilePending().catch(error => console.error('initial queue reconciliation failed', error));
const reconciliationTimer = setInterval(() => void reconcilePending().catch(error => console.error('queue reconciliation failed', error)), 30_000);
process.on('SIGTERM', async () => { await worker.close(); await redis.quit(); await pool.end(); });
process.on('SIGTERM', () => clearInterval(reconciliationTimer));
console.log(`worker running with concurrency=${config.WORKER_CONCURRENCY}`);
