'use client';

import { useState, type FormEvent } from 'react';
import { api, API } from '../lib/api';

export function LoginScreen() {
  const [email, setEmail] = useState('demo@outbox.local');
  const [password, setPassword] = useState('outbox-local-demo');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/password-login', { method: 'POST', body: JSON.stringify({ email, password }) }); window.location.reload(); }
    catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="auth">
      <section className="card">
        <p className="eyebrow">OUTBOX / REACHINBOX</p>
        <h1>Durable email scheduling.</h1>
        <p className="muted">Schedule once. Persist everywhere. Observe every send.</p>
        <form className="login-form" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="login-divider"><span>or</span></div>
        <a className="google" href={`${API}/auth/google`}>Continue with Google</a>
      </section>
    </main>
  );
}
