import { redis } from './queue.js';
const reserveScript = `local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then return 0 end
local next = redis.call('INCR', KEYS[1])
if next == 1 then redis.call('EXPIRE', KEYS[1], 7200) end
return 1`;
export function hourKey(senderId: string, now = new Date()) { const stamp = now.toISOString().slice(0, 13); return `outbox:rate:${senderId}:${stamp}`; }
export async function reserveHourlyCapacity(senderId: string, limit: number, now = new Date()) { return Number(await redis.eval(reserveScript, 1, hourKey(senderId, now), limit)) === 1; }
export function nextHour(now = new Date()) { const next = new Date(now); next.setUTCMinutes(0,0,0); next.setUTCHours(next.getUTCHours()+1); return next; }
export function nextSpacingSlot(lastReservedAt: number, now: number, minimumDelayMs: number) { return Math.max(now, lastReservedAt); }
const spacingScript = `local last = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1]); local min = tonumber(ARGV[2]); local eligible = math.max(now, last)
redis.call('SET', KEYS[1], eligible + min)
return eligible`;
export async function reserveSpacing(senderId: string, minDelayMs: number, now = Date.now()) { return Number(await redis.eval(spacingScript, 1, `outbox:spacing:${senderId}`, now, minDelayMs)); }
