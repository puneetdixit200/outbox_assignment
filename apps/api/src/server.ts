import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { config } from './config.js';
import { query, pool, withTransaction } from './db/client.js';
import {
  authCookieOptions,
  authRequired,
  clearSession,
  createOAuthState,
  getOrCreateUser,
  oauthStateCookie,
  setSession
} from './auth.js';
import { closeQueue, enqueueEmails, queueReady } from './queue.js';
import { effectiveDelay, normalizeRecipients } from './scheduling.js';

const app = express();
app.use(cors({ origin: config.WEB_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(100_000),
  recipients: z.array(z.string().email()).min(1).max(10_000),
  senderId: z.string().uuid(),
  startAt: z.coerce.date(),
  delayBetweenEmailsMs: z.number().int().positive().max(86_400_000).optional(),
  hourlyLimit: z.number().int().positive().max(config.MAX_EMAILS_PER_HOUR_PER_SENDER).optional()
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/ready', async (_req, res) => {
  try {
    await query('SELECT 1');
    await queueReady();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get('/auth/me', authRequired, (_req, res) => res.json({ data: res.locals.user }));

app.post('/auth/dev-login', async (req, res, next) => {
  try {
    if (config.NODE_ENV === 'production' || !config.ALLOW_DEV_LOGIN) return res.status(404).end();
    const input = z.object({
      email: z.string().email().default('demo@outbox.local'),
      name: z.string().default('Demo User')
    }).parse(req.body ?? {});
    const user = await getOrCreateUser({ email: input.email, name: input.name });
    setSession(res, user);
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

app.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

app.get('/auth/google', (_req, res) => {
  if (!config.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: { code: 'GOOGLE_NOT_CONFIGURED', message: 'Configure Google OAuth first' } });
  }
  const state = createOAuthState();
  res.cookie(oauthStateCookie, state, authCookieOptions(10 * 60 * 1000));
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res, next) => {
  try {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      return res.status(501).send('Google OAuth is not configured');
    }
    const code = z.string().parse(req.query.code);
    const state = z.string().parse(req.query.state);
    if (!req.cookies?.[oauthStateCookie] || req.cookies[oauthStateCookie] !== state) {
      return res.status(403).send('OAuth state validation failed');
    }
    res.clearCookie(oauthStateCookie, authCookieOptions());

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: config.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code'
      })
    });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const token = await tokenResponse.json() as { access_token: string };

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` }
    });
    if (!profileResponse.ok) throw new Error('Google profile lookup failed');
    const profile = await profileResponse.json() as {
      sub: string;
      email: string;
      email_verified?: boolean;
      name: string;
      picture?: string;
    };
    if (profile.email_verified !== true) return res.status(403).send('Google account email is not verified');

    const user = await getOrCreateUser({
      googleSubject: profile.sub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture
    });
    setSession(res, user);
    res.redirect(`${config.WEB_URL}/dashboard`);
  } catch (error) {
    next(error);
  }
});

app.get('/senders', authRequired, async (_req, res, next) => {
  try {
    const result = await query(
      'SELECT id, display_name AS "displayName", from_email AS "fromEmail" FROM sender_accounts WHERE owner_user_id=$1 AND is_active ORDER BY created_at',
      [res.locals.user.id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/emails/schedule', authRequired, async (req, res, next) => {
  try {
    const input = scheduleSchema.parse(req.body);
    const owner = res.locals.user.id;
    const requestId = req.get('Idempotency-Key')?.trim() || randomUUID();
    const recipients = normalizeRecipients(input.recipients);

    const sender = await query(
      'SELECT id FROM sender_accounts WHERE id=$1 AND owner_user_id=$2 AND is_active',
      [input.senderId, owner]
    );
    if (!sender.rowCount) {
      return res.status(403).json({ error: { code: 'SENDER_FORBIDDEN', message: 'Sender does not belong to user' } });
    }

    const delay = effectiveDelay(input.delayBetweenEmailsMs, config.DEFAULT_MIN_SEND_DELAY_MS);
    const limit = Math.min(
      input.hourlyLimit ?? config.MAX_EMAILS_PER_HOUR_PER_SENDER,
      config.MAX_EMAILS_PER_HOUR_PER_SENDER
    );

    const created = await withTransaction(async client => {
      const campaign = await client.query<{ id: string }>(
        `INSERT INTO campaigns
           (owner_user_id,request_id,sender_account_id,subject,body,requested_start_at,delay_between_emails_ms,hourly_limit,recipient_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (owner_user_id, request_id) WHERE request_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [owner, requestId, input.senderId, input.subject, input.body, input.startAt, delay, limit, recipients.length]
      );

      if (!campaign.rowCount) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM campaigns WHERE owner_user_id=$1 AND request_id=$2',
          [owner, requestId]
        );
        if (!existing.rowCount) throw new Error('Idempotent campaign lookup failed');
        return { replay: true as const, campaignId: existing.rows[0].id, emails: [] };
      }

      const emails = await client.query<{ id: string; scheduled_at: Date }>(
        `INSERT INTO scheduled_emails
           (campaign_id,sender_account_id,recipient_email,sequence,scheduled_at,idempotency_key)
         SELECT $1::uuid, $2::uuid, x.email, x.sequence,
                $3::timestamptz + ((x.sequence - 1) * $4::integer) * interval '1 millisecond',
                $1::text || ':' || x.email
         FROM unnest($5::text[]) WITH ORDINALITY AS x(email,sequence)
         RETURNING id,scheduled_at`,
        [campaign.rows[0].id, input.senderId, input.startAt, delay, recipients]
      );

      return { replay: false as const, campaignId: campaign.rows[0].id, emails: emails.rows };
    });

    if (created.replay) {
      const count = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM scheduled_emails WHERE campaign_id=$1',
        [created.campaignId]
      );
      return res.status(200).json({
        data: {
          campaignId: created.campaignId,
          scheduledCount: Number(count.rows[0].count),
          requestId,
          idempotentReplay: true
        }
      });
    }

    const queued = await enqueueEmails(
      created.emails.map(row => ({ id: row.id, scheduledAt: new Date(row.scheduled_at) }))
    );
    await withTransaction(async client => {
      for (const row of queued) {
        await client.query(
          `UPDATE scheduled_emails SET bull_job_id=$2,status='QUEUED',updated_at=now()
           WHERE id=$1 AND status='ENQUEUE_PENDING'`,
          [row.id, row.jobId]
        );
      }
    });

    res.status(201).json({
      data: {
        campaignId: created.campaignId,
        scheduledCount: created.emails.length,
        firstScheduledAt: created.emails[0]?.scheduled_at,
        lastScheduledAt: created.emails.at(-1)?.scheduled_at,
        effectiveDelayBetweenEmailsMs: delay,
        effectiveHourlyLimit: limit,
        requestId
      }
    });
  } catch (error) {
    next(error);
  }
});

async function listEmails(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
  statuses: string[]
) {
  try {
    const { page, pageSize } = listQuerySchema.parse(req.query);
    const offset = (page - 1) * pageSize;
    const result = await query(
      `SELECT e.id,e.recipient_email AS "recipientEmail",e.status,e.scheduled_at AS "scheduledAt",
              e.sent_at AS "sentAt",e.last_error AS "lastError",e.preview_url AS "previewUrl",c.subject
       FROM scheduled_emails e
       JOIN campaigns c ON c.id=e.campaign_id
       WHERE c.owner_user_id=$1 AND e.status = ANY($2::scheduled_email_status[])
       ORDER BY e.scheduled_at DESC LIMIT $3 OFFSET $4`,
      [res.locals.user.id, statuses, pageSize, offset]
    );
    const count = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM scheduled_emails e
       JOIN campaigns c ON c.id=e.campaign_id
       WHERE c.owner_user_id=$1 AND e.status = ANY($2::scheduled_email_status[])`,
      [res.locals.user.id, statuses]
    );
    const total = Number(count.rows[0].count);
    res.json({
      data: result.rows,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

app.get('/emails/scheduled', authRequired, (req, res, next) =>
  listEmails(req, res, next, ['SCHEDULED', 'ENQUEUE_PENDING', 'QUEUED', 'PROCESSING', 'DEFERRED_RATE_LIMIT'])
);
app.get('/emails/sent', authRequired, (req, res, next) =>
  listEmails(req, res, next, ['SENT', 'FAILED'])
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (!(error instanceof z.ZodError)) console.error('request failed', error);
  const isValidation = error instanceof z.ZodError;
  const message = isValidation
    ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    : 'Internal server error';
  res.status(isValidation ? 400 : 500).json({
    error: { code: isValidation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message }
  });
});

const server = app.listen(config.API_PORT, () => console.log(`api listening on ${config.API_URL}`));

async function shutdown() {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeQueue();
  await pool.end();
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
