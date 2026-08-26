'use client';

import { API } from '../lib/api';

export function LoginScreen() {
  return (
    <main className="auth">
      <section className="card">
        <p className="eyebrow">OUTBOX / REACHINBOX</p>
        <h1>Durable email scheduling.</h1>
        <p className="muted">Schedule once. Persist everywhere. Observe every send.</p>
        <a className="google" href={`${API}/auth/google`}>Continue with Google</a>
      </section>
    </main>
  );
}
