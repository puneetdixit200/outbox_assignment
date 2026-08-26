type EmailRow = {
  id: string;
  recipientEmail: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt?: string;
  lastError?: string;
};

export function EmailTable({ rows, view }: { rows: EmailRow[]; view: 'scheduled' | 'sent' }) {
  const timeLabel = view === 'scheduled' ? 'Scheduled time' : 'Sent time';

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Subject</th>
            <th>{timeLabel}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.recipientEmail}</td>
              <td>{row.subject}</td>
              <td>{new Date(view === 'sent' ? (row.sentAt ?? row.scheduledAt) : row.scheduledAt).toLocaleString()}</td>
              <td>
                <span className={`status ${row.status.toLowerCase()}`}>{row.status}</span>
                {row.lastError && <small>{row.lastError}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
