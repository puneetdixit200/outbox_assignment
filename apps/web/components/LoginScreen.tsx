'use client';

import { API } from '../lib/api';

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true">G</span>;
}

export function LoginScreen() {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <h1 id="login-title">Login</h1>
        <a className="google-button" href={`${API}/auth/google`}>
          <GoogleMark />
          <span>Continue with Google</span>
        </a>
      </section>
    </main>
  );
}
