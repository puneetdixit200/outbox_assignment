export function hourStamp(now = new Date()) {
  return now.toISOString().slice(0, 13);
}

export function hourKey(senderId: string, now = new Date()) {
  return `outbox:rate:sender:${senderId}:${hourStamp(now)}`;
}

export function campaignHourKey(campaignId: string, now = new Date()) {
  return `outbox:rate:campaign:${campaignId}:${hourStamp(now)}`;
}

export function nextHour(now = new Date()) {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

export function nextSpacingSlot(nextAvailableAt: number, now: number) {
  return Math.max(now, nextAvailableAt);
}
