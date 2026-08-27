'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ComposeModal } from './ComposeModal';
import { EmailTable } from './EmailTable';

type User = { id: string; email: string; name: string; avatarUrl?: string };
type Sender = { id: string; displayName: string; fromEmail: string };
type Email = { id: string; recipientEmail: string; status: string; scheduledAt: string; sentAt?: string; subject: string; lastError?: string };

function SearchIcon() { return <svg aria-hidden="true" viewBox="0 0 18 18"><circle cx="7.5" cy="7.5" r="4.5" /><path d="m11 11 4 4" /></svg>; }
function FilterIcon() { return <svg aria-hidden="true" viewBox="0 0 18 18"><path d="M3 4h12M5 9h8M7 14h4" /></svg>; }
function RefreshIcon() { return <svg aria-hidden="true" viewBox="0 0 18 18"><path d="M14 7a6 6 0 1 0 0 5" /><path d="M14 3v4h-4" /></svg>; }
function NavIcon({ sent }: { sent?: boolean }) { return sent ? <svg aria-hidden="true" viewBox="0 0 18 18"><path d="m3 9 11-5-3 10-3-4-5-1Z" /><path d="m8 10 3-6" /></svg> : <svg aria-hidden="true" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.5" /><path d="M9 6v3l2 1" /></svg>; }

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
    setNotice('');
    return Promise.all([
      api(`/emails/${tab}?page=${page}&pageSize=50`).then(result => { setRows(result.data); setMeta(result.meta); }),
      api('/senders').then(result => setSenders(result.data))
    ]).catch(caught => setNotice((caught as Error).message)).finally(() => setLoading(false));
  };

  useEffect(() => { void reload(); const timer = setInterval(() => void reload(), 5000); return () => clearInterval(timer); }, [tab, page]);

  const switchTab = (next: 'scheduled' | 'sent') => { setTab(next); setPage(1); };
  const initials = user.name.trim().slice(0, 1).toUpperCase();

  return (
    <main className="mail-app">
      <aside className="sidebar">
        <div className="brand-mark">ONB</div>
        <div className="account-block">
          {user.avatarUrl ? <img className="account-avatar" src={user.avatarUrl} alt="" /> : <span className="account-avatar account-fallback">{initials}</span>}
          <span className="account-copy"><strong>{user.name}</strong><small>{user.email}</small></span>
          <span className="account-chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg></span>
        </div>
        <button className="compose-sidebar-button" type="button" onClick={() => setShowCompose(true)}>Compose</button>
        <p className="nav-label">CORE</p>
        <nav className="side-nav" aria-label="Mailbox">
          <button className={tab === 'scheduled' ? 'nav-item active' : 'nav-item'} type="button" onClick={() => switchTab('scheduled')}><NavIcon /><span>Scheduled</span><em>{tab === 'scheduled' ? meta.total : ''}</em></button>
          <button className={tab === 'sent' ? 'nav-item active' : 'nav-item'} type="button" onClick={() => switchTab('sent')}><NavIcon sent /><span>Sent</span><em>{tab === 'sent' ? meta.total : ''}</em></button>
        </nav>
        <button className="logout-link" type="button" onClick={onLogout}>Log out</button>
      </aside>

      <section className="mail-workspace">
        <header className="mail-toolbar">
          <div className="search-box"><SearchIcon /><input aria-label="Search emails" placeholder="Search" /></div>
          <div className="toolbar-actions"><button type="button" aria-label="Filter emails"><FilterIcon /></button><button type="button" aria-label="Refresh emails" onClick={() => void reload()}><RefreshIcon /></button></div>
        </header>
        {notice && <p className="error workspace-error">{notice}</p>}
        <section className="mail-content" aria-labelledby="mailbox-title">
          <h1 id="mailbox-title" className="sr-only">{tab === 'scheduled' ? 'Scheduled Emails' : 'Sent Emails'}</h1>
          {loading ? <div className="mail-empty"><strong>Loading…</strong></div> : rows.length === 0 ? <div className="mail-empty"><strong>No {tab} emails yet.</strong><span>Compose a campaign to create email records.</span></div> : <EmailTable rows={rows} />}
          {!loading && rows.length > 0 && <div className="pager"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {meta.page} of {Math.max(1, meta.totalPages)}</span><button type="button" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
        </section>
      </section>
      {showCompose && <ComposeModal senders={senders} onClose={() => setShowCompose(false)} onDone={() => { setShowCompose(false); setTab('scheduled'); setPage(1); void reload(); }} />}
    </main>
  );
}
