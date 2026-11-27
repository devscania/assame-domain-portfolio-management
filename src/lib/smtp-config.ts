import { isIP } from 'node:net';

const spacemailHost = 'mail.spacemail.com';
const mailbox = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/u;

export function smtpConfiguration(env: Record<string, string | undefined>) {
  const host = env.SMTP_HOST?.trim() ?? '';
  const from = env.SMTP_FROM?.trim() ?? '';
  const user = env.SMTP_USER?.trim() ?? '';
  const pass = env.SMTP_PASSWORD ?? '';
  const rawPort = env.SMTP_PORT || '587';
  const port = Number(rawPort);
  const secure = port === 465;
  const requireTLS = !secure && env.SMTP_REQUIRE_TLS !== 'false';
  const spacemail = host.toLowerCase().replace(/\.$/, '') === spacemailHost;
  const invalid: string[] = [];

  if (!host || (!isIP(host) && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(host)))
    invalid.push('SMTP_HOST');
  const fromAddress = from.match(/^[^<>]*<([^<>]+)>$/u)?.[1] ?? from;
  if (/[\r\n\0]/u.test(env.SMTP_FROM ?? '') || !mailbox.test(fromAddress))
    invalid.push('SMTP_FROM');
  if (Boolean(user) !== Boolean(pass) || (spacemail && (!mailbox.test(user) || !pass)))
    invalid.push('SMTP_USER/SMTP_PASSWORD');
  if (
    !/^\d{1,5}$/.test(rawPort) ||
    port < 1 ||
    port > 65535 ||
    (spacemail && port !== 465 && port !== 587) ||
    (env.SMTP_REQUIRE_TLS && !['true', 'false'].includes(env.SMTP_REQUIRE_TLS)) ||
    (!secure && !requireTLS && (env.NODE_ENV === 'production' || Boolean(user)))
  )
    invalid.push('SMTP_PORT/SMTP_REQUIRE_TLS');

  return {
    invalid,
    options: {
      host,
      port,
      secure,
      requireTLS,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      ...(user ? { auth: { user, pass } } : {}),
    },
  };
}
