export function normalizeRecipients(values: string[]) {
  return [...new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean))];
}

export function scheduledAt(startAt: Date, oneBasedSequence: number, delayMs: number) {
  if (oneBasedSequence < 1 || delayMs < 1) throw new Error('sequence and delay must be positive');
  return new Date(startAt.getTime() + (oneBasedSequence - 1) * delayMs);
}
