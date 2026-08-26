'use client';
import { useState } from 'react';
import { api, API } from '../lib/api';
export function LoginScreen({ onLogin }: { onLogin: (user: { id:string; email:string; name:string; avatarUrl?:string }) => void }) {
  const [error, setError] = useState('');
  return <main className="auth"><section className="card"><p className="eyebrow">OUTBOX / REACHINBOX</p><h1>Durable email scheduling.</h1><p className="muted">Schedule once. Persist everywhere. Observe every send.</p>{error && <p className="error">{error}</p>}<button onClick={async () => { try { const result = await api('/auth/dev-login', { method:'POST', body:'{}' }); onLogin(result.data); } catch (caught) { setError((caught as Error).message); } }}>Continue with demo account</button><a className="google" href={`${API}/auth/google`}>Use Google OAuth</a></section></main>;
}
