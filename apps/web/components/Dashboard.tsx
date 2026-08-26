'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ComposeModal } from './ComposeModal';
import { EmailTable } from './EmailTable';

type User = { id: string; email: string; name: string; avatarUrl?: string };
type Sender = { id: string; displayName: string; fromEmail: string };
type Email = { id: string; recipientEmail: string; status: string; scheduledAt: string; sentAt?: string; subject: string; lastError?: string };

export function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [rows, setRows] = useState<Email[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [notice, setNotice] = useState('');

  const reload = () => {
    setLoading(true);
    return Promise.all([
      api(`/emails/${tab}?page=${page}&pageSize=50`).then(result => {
        setRows(result.data);
        setMeta(result.meta);
      }),
      api('/senders').then(result => setSenders(result.data))
    ]).catch(caught => setNotice((caught as Error).message)).finally(() => setLoading(false));
  };

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [tab, page]);

  const selectTab = (next: 'scheduled' | 'sent') => {
    setTab(next);
    setPage(1);
  };

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">OUTBOX CONTROL ROOM</p>
          <h1>Mail operations</h1>
        </div>
        <div className="user">
          {user.avatarUrl
            ? <img className="avatar" src={user.avatarUrl} alt={`${user.name} avatar`} />
            : <span className="avatar fallback">{user.name.slice(0, 1)}</span>}
          <span className="user-copy">
            <strong>{user.name}</strong>
            <span className="user-email">{user.email}</span>
          </span>
          <button className="quiet" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="muted">Email scheduler</p>
          <h2>Schedule and track outbound emails.</h2>
        </div>
        <button onClick={() => setShowCompose(true)}>Compose New Email</button>
      </section>

      {notice && <p className="error">{notice}</p>}

      <nav className="tabs" aria-label="Email status views">
        <button className={tab === 'scheduled' ? 'active' : ''} onClick={() => selectTab('scheduled')}>Scheduled Emails</button>
        <button className={tab === 'sent' ? 'active' : ''} onClick={() => selectTab('sent')}>Sent Emails</button>
      </nav>

      <section className="card table-card">
        <div className="table-head">
          <div>
            <p className="eyebrow">LIVE STATE</p>
            <h2>{tab === 'scheduled' ? 'Scheduled Emails' : 'Sent Emails'}</h2>
          </div>
          <span className="pill">{meta.total} total</span>
        </div>

        {loading ? (
          <div className="empty"><strong>Loading email state…</strong><span>Reading persisted PostgreSQL records.</span></div>
        ) : rows.length === 0 ? (
          <div className="empty"><strong>No {tab === 'scheduled' ? 'scheduled' : 'sent'} emails yet.</strong><span>{tab === 'scheduled' ? 'Compose a new email to create scheduled jobs.' : 'Sent and failed deliveries will appear here.'}</span></div>
        ) : (
          <>
            <EmailTable rows={rows} view={tab} />
            <div className="pager">
              <button className="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {meta.page} of {Math.max(1, meta.totalPages)}</span>
              <button className="quiet" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </>
        )}
      </section>

      {showCompose && (
        <ComposeModal
          senders={senders}
          onClose={() => setShowCompose(false)}
          onDone={() => {
            setShowCompose(false);
            setTab('scheduled');
            setPage(1);
            void reload();
          }}
        />
      )}
    </main>
  );
}
