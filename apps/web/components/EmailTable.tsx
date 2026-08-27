function formatWhen(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function ClockIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1" /></svg>;
}

function StarIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m8 2 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.7 4.6 12.5l.7-3.8L2.5 6l3.8-.5L8 2Z" /></svg>;
}

export function EmailTable({ rows }: { rows: Array<{ id: string; recipientEmail: string; subject: string; status: string; scheduledAt: string; sentAt?: string; lastError?: string }> }) {
  return (
    <div className="mail-list" role="table" aria-label="Email records">
      <div className="sr-only" role="row">
        <span role="columnheader">Email</span><span role="columnheader">Subject</span><span role="columnheader">Time</span><span role="columnheader">Status</span>
      </div>
      {rows.map(row => (
        <div className="mail-row" role="row" key={row.id}>
          <div className="mail-recipient" role="cell"><strong>To: {row.recipientEmail}</strong></div>
          <div className="mail-time" role="cell"><span className={`time-pill ${row.status.toLowerCase()}`}><ClockIcon />{formatWhen(row.sentAt ?? row.scheduledAt)}</span></div>
          <div className="mail-subject" role="cell"><strong>{row.subject}</strong><span> – {row.status === 'SENT' ? 'Email delivered successfully' : 'Scheduled email'}</span>{row.lastError && <small>{row.lastError}</small>}</div>
          <div className="mail-status" role="cell"><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></div>
          <button className="star-button" type="button" aria-label={`Star email to ${row.recipientEmail}`}><StarIcon /></button>
        </div>
      ))}
    </div>
  );
}
