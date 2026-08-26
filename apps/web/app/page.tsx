'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Dashboard } from '../components/Dashboard';
import { LoginScreen } from '../components/LoginScreen';

type User = { id: string; email: string; name: string; avatarUrl?: string };

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api('/auth/me').then(result => setUser(result.data)).catch(() => undefined);
  }, []);

  if (!user) return <LoginScreen />;
  return <Dashboard user={user} onLogout={() => { api('/auth/logout', { method: 'POST' }).then(() => setUser(null)); }} />;
}
