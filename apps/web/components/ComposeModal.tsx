'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../lib/api';
import { toLocalDateTimeInputValue } from '../lib/dateTime';
import { parseRecipients } from '../lib/recipients';

type Sender = { id: string; displayName: string; fromEmail: string };
const DEFAULT_MIN_DELAY_MS = 1000;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function ComposeModal({ senders, onClose, onDone }: { senders: Sender[]; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [startAt, setStartAt] = useState(() => toLocalDateTimeInputValue(new Date(Date.now() + 60_000)));
  const [delay, setDelay] = useState(DEFAULT_MIN_DELAY_MS);
  const [limit, setLimit] = useState(200);
  const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const recipients = parseRecipients(recipientText);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Recipient file must be 2 MB or smaller');
      event.target.value = '';
      return;
    }
    setError('');
    setRecipientText(await file.text());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!recipients.length) throw new Error('Add at least one valid email address');
      if (delay < DEFAULT_MIN_DELAY_MS) throw new Error(`Delay must be at least ${DEFAULT_MIN_DELAY_MS} ms`);
      await api('/emails/schedule', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId },
        body: JSON.stringify({
          subject,
          body,
          recipients,
          senderId,
          startAt: new Date(startAt).toISOString(),
          delayBetweenEmailsMs: Number(delay),
          hourlyLimit: Number(limit)
        })
      });
      onDone();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const minimumStart = toLocalDateTimeInputValue(new Date());

  return (
    <div className="backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">COMPOSE</p><h2>Compose New Email</h2></div>
          <button type="button" className="quiet" onClick={onClose}>Close</button>
        </div>
        {error && <p className="error">{error}</p>}
        <label>
          Sender
          <select value={senderId} onChange={event => setSenderId(event.target.value)} required>
            {senders.map(sender => <option key={sender.id} value={sender.id}>{sender.displayName} · {sender.fromEmail}</option>)}
          </select>
        </label>
        <label>Subject<input value={subject} onChange={event => setSubject(event.target.value)} required maxLength={200} /></label>
        <label>Body<textarea value={body} onChange={event => setBody(event.target.value)} required rows={5} /></label>
        <label>
          Leads <span className="hint">Upload CSV/TXT or paste email addresses</span>
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
          <textarea value={recipientText} onChange={event => setRecipientText(event.target.value)} required rows={4} placeholder="ada@example.com, grace@example.com" />
          <span className="recipient-count">{recipients.length} email address{recipients.length === 1 ? '' : 'es'} detected</span>
        </label>
        <div className="grid">
          <label>Start time<input type="datetime-local" min={minimumStart} value={startAt} onChange={event => setStartAt(event.target.value)} required /></label>
          <label>Delay between emails (ms)<input type="number" min={DEFAULT_MIN_DELAY_MS} value={delay} onChange={event => setDelay(Number(event.target.value))} /></label>
          <label>Hourly limit<input type="number" min="1" value={limit} onChange={event => setLimit(Number(event.target.value))} /></label>
        </div>
        <button disabled={busy || !senderId}>{busy ? 'Scheduling…' : 'Schedule'}</button>
      </form>
    </div>
  );
}
