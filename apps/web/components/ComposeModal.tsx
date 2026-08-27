'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../lib/api';
import { toLocalDateTimeInputValue } from '../lib/dateTime';
import { parseRecipients } from '../lib/recipients';

type Sender = { id: string; displayName: string; fromEmail: string };
const DEFAULT_MIN_DELAY_MS = 1000;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function BackIcon() { return <svg aria-hidden="true" viewBox="0 0 18 18"><path d="M14 9H4M8 4 3 9l5 5" /></svg>; }
function PaperclipIcon() { return <svg aria-hidden="true" viewBox="0 0 18 18"><path d="m7 9 4-4a2.5 2.5 0 0 1 4 3l-5.5 5.5a4 4 0 0 1-5.7-5.6L9 2.7" /></svg>; }
function ClockIcon() { return <svg aria-hidden="true" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6" /><path d="M9 5v4l2.5 1.5" /></svg>; }

export function ComposeModal({ senders, onClose, onDone }: { senders: Sender[]; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [recipientText, setRecipientText] = useState('');
  const [startAt, setStartAt] = useState(() => toLocalDateTimeInputValue(new Date(Date.now() + 60_000)));
  const [delay, setDelay] = useState(DEFAULT_MIN_DELAY_MS); const [limit, setLimit] = useState(200); const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [requestId] = useState(() => crypto.randomUUID()); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const recipients = parseRecipients(recipientText);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > MAX_UPLOAD_BYTES) { setError('Recipient file must be 2 MB or smaller'); event.target.value = ''; return; } setError(''); setRecipientText(await file.text()); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      if (!recipients.length) throw new Error('Add at least one valid email address');
      if (delay < DEFAULT_MIN_DELAY_MS) throw new Error(`Delay must be at least ${DEFAULT_MIN_DELAY_MS} ms`);
      await api('/emails/schedule', { method: 'POST', headers: { 'Idempotency-Key': requestId }, body: JSON.stringify({ subject, body, recipients, senderId, startAt: new Date(startAt).toISOString(), delayBetweenEmailsMs: Number(delay), hourlyLimit: Number(limit) }) });
      onDone();
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="compose-page">
      <form className="compose-form" onSubmit={submit}>
        <header className="compose-header"><button className="back-button" type="button" onClick={onClose}><BackIcon /><span>Compose New Email</span></button><div className="compose-actions"><label className="icon-action" aria-label="Upload leads"><PaperclipIcon /><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} /></label><label className="icon-action" aria-label="Schedule date"><ClockIcon /><input type="datetime-local" value={startAt} onChange={event => setStartAt(event.target.value)} required /></label><button className="send-later-button" type="submit" disabled={busy || !senderId}>{busy ? 'Sending…' : 'Send Later'}</button></div></header>
        {error && <p className="error compose-error">{error}</p>}
        <div className="compose-fields">
          <label className="compose-line"><span>From</span><select value={senderId} onChange={event => setSenderId(event.target.value)} required>{senders.map(sender => <option key={sender.id} value={sender.id}>{sender.fromEmail}</option>)}</select></label>
          <label className="compose-line"><span>To</span><input value={recipientText} onChange={event => setRecipientText(event.target.value)} placeholder="recipient@example.com" required /><label className="upload-list">Upload List<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} /></label></label>
          <div className="recipient-summary">{recipients.length > 0 && recipients.map(recipient => <span key={recipient}>{recipient}</span>)}</div>
          <label className="compose-line"><span>Subject</span><input value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject" required maxLength={200} /></label>
          <div className="compose-line settings-line"><span>Options</span><div><label>Delay between 2 emails<input type="number" min={DEFAULT_MIN_DELAY_MS} value={delay} onChange={event => setDelay(Number(event.target.value))} /></label><label>Hourly Limit<input type="number" min="1" value={limit} onChange={event => setLimit(Number(event.target.value))} /></label><span className="recipient-count">{recipients.length} recipients</span></div></div>
          <label className="compose-line body-line"><span className="sr-only">Body</span><textarea value={body} onChange={event => setBody(event.target.value)} placeholder="Type Your Reply..." required rows={15} /></label>
        </div>
      </form>
    </div>
  );
}
