import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { query } from './db/client.js';

export type AuthUser = { id: string; email: string; name: string; avatarUrl?: string };
const COOKIE = 'outbox_session';
export function signSession(user: AuthUser) { return jwt.sign(user, config.SESSION_SECRET, { expiresIn: '7d' }); }
export function setSession(res: Response, user: AuthUser) { res.cookie(COOKIE, signSession(user), { httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 }); }
export function clearSession(res: Response) { res.clearCookie(COOKIE); }
export function authRequired(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } });
    res.locals.user = jwt.verify(token, config.SESSION_SECRET) as AuthUser; next();
  } catch { return res.status(401).json({ error: { code: 'INVALID_SESSION', message: 'Session expired' } }); }
}
export async function getOrCreateUser(input: { googleSubject?: string; email: string; name: string; avatarUrl?: string }): Promise<AuthUser> {
  const result = await query<{id:string,email:string,name:string,avatar_url:string|null}>(
    `INSERT INTO users (google_subject,email,name,avatar_url) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET google_subject=COALESCE(EXCLUDED.google_subject,users.google_subject), name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url, updated_at=now()
     RETURNING id,email,name,avatar_url`, [input.googleSubject ?? null,input.email,input.name,input.avatarUrl ?? null]);
  const row = result.rows[0]; return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url ?? undefined };
}
