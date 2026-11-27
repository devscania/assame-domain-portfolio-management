import { randomUUID } from 'node:crypto';
import { brand } from './brand';
// Minimal Sentry envelope transport. Raw errors, requests, URLs and credentials are deliberately excluded.
export async function reportError(component: 'api' | 'worker') {
  const value = process.env.SENTRY_DSN;
  if (!value) return;
  try {
    const dsn = new URL(value);
    if (dsn.protocol !== 'https:') return;
    const project = dsn.pathname.split('/').filter(Boolean).at(-1);
    if (!project || !dsn.username) return;
    const eventId = randomUUID().replaceAll('-', '');
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      message: `${brand.name} operation failed`,
      tags: { component },
      environment: process.env.NODE_ENV || 'development',
    };
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
    await fetch(`${dsn.origin}/api/${project}/envelope/`, {
      method: 'POST',
      body: envelope,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${dsn.username},sentry_client=assame/0.1`,
      },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* Reporting failures never block the application. */
  }
}
