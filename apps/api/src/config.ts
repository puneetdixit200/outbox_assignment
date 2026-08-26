import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().default('postgres://outbox:outbox@localhost:5433/outbox'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  SESSION_SECRET: z.string().min(16).default('development-only-session-secret'),
  GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:4000/auth/google/callback'),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().default('demo@example.test'), SMTP_FROM_NAME: z.string().default('Outbox Demo'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(3),
  PROCESSING_LEASE_MS: z.coerce.number().int().positive().max(86_400_000).default(300_000),
  DEFAULT_MIN_SEND_DELAY_MS: z.coerce.number().int().positive().max(86_400_000).default(1000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().max(100_000).default(200),
  JOB_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3), JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
  ALLOW_DEV_MAIL: z.enum(['true','false']).default('false').transform(value => value === 'true')
});

export const config = schema.parse(process.env);
