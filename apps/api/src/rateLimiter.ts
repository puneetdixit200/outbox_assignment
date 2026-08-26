import { redis } from './queue.js';
import { campaignHourKey, hourKey } from './rateLimitPolicy.js';

export { campaignHourKey, hourKey, nextHour, nextSpacingSlot } from './rateLimitPolicy.js';

const reserveScript = `
local senderCurrent = tonumber(redis.call('GET', KEYS[1]) or '0')
local campaignCurrent = tonumber(redis.call('GET', KEYS[2]) or '0')
local senderLimit = tonumber(ARGV[1])
local campaignLimit = tonumber(ARGV[2])
if senderCurrent >= senderLimit or campaignCurrent >= campaignLimit then return 0 end
local senderNext = redis.call('INCR', KEYS[1])
local campaignNext = redis.call('INCR', KEYS[2])
if senderNext == 1 then redis.call('EXPIRE', KEYS[1], 7200) end
if campaignNext == 1 then redis.call('EXPIRE', KEYS[2], 7200) end
return 1`;

export async function reserveHourlyCapacity(
  senderId: string,
  campaignId: string,
  senderLimit: number,
  campaignLimit: number,
  now = new Date()
) {
  return Number(await redis.eval(
    reserveScript,
    2,
    hourKey(senderId, now),
    campaignHourKey(campaignId, now),
    senderLimit,
    campaignLimit
  )) === 1;
}

const spacingScript = `
local nextAvailable = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local min = tonumber(ARGV[2])
local eligible = math.max(now, nextAvailable)
local following = eligible + min
local ttl = math.max(7200000, following - now + 3600000)
redis.call('PSETEX', KEYS[1], ttl, following)
return eligible`;

export async function reserveSpacing(senderId: string, minDelayMs: number, now = Date.now()) {
  return Number(await redis.eval(spacingScript, 1, `outbox:spacing:${senderId}`, now, minDelayMs));
}
