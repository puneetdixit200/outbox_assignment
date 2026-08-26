import './globals.css';
import type { ReactNode } from 'react';
export const metadata = { title: 'Outbox Scheduler', description: 'Durable email scheduling demo' };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
