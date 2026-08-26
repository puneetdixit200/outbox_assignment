import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('outbox-send-email', { connection: redis });
export const jobIdFor = (id: string) => `scheduled-email-${id}`;
export async function queueReady() { await redis.ping(); await emailQueue.getJobCounts('waiting'); return true; }
export async function enqueueEmail(id: string, scheduledAt: Date) {
  const jobId = jobIdFor(id);
  await emailQueue.add('send-email', { scheduledEmailId: id }, { jobId, delay: Math.max(0, scheduledAt.getTime() - Date.now()), attempts: config.JOB_ATTEMPTS, backoff: { type: 'exponential', delay: config.JOB_BACKOFF_MS }, removeOnComplete: 1000, removeOnFail: 5000 });
  return jobId;
}
export async function enqueueEmails(rows: Array<{ id: string; scheduledAt: Date }>) {
  const jobs = await emailQueue.addBulk(rows.map(row => ({ name: 'send-email', data: { scheduledEmailId: row.id }, opts: { jobId: jobIdFor(row.id), delay: Math.max(0, row.scheduledAt.getTime() - Date.now()), attempts: config.JOB_ATTEMPTS, backoff: { type: 'exponential' as const, delay: config.JOB_BACKOFF_MS }, removeOnComplete: 1000, removeOnFail: 5000 } })));
  return jobs.map(job => ({ id: job.data.scheduledEmailId as string, jobId: job.id as string }));
}
export async function closeQueue() { await emailQueue.close(); await redis.quit(); }
