import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer-modern';
import { db } from './db';
import { brand } from './brand';
import { transactionalEmail } from './email-template';
import { smtpConfiguration } from './smtp-config';
import { AppError } from './security';
import { isPristineOAuthOrphan } from './oauth-orphan';

export type AuthTokenKind = 'verify' | 'reset' | 'setup' | 'orphan';
export function hashAuthToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function emailConfigured() {
  return Boolean(process.env.AUTH_URL && smtpConfiguration(process.env).invalid.length === 0);
}
function emailTransport() {
  const { invalid, options } = smtpConfiguration(process.env);
  if (!process.env.AUTH_URL || invalid.length)
    throw new AppError('Email service is not configured', 503);
  return nodemailer.createTransport(options);
}

export async function sendWelcomeEmail(email: string) {
  const url = new URL('/overview', process.env.AUTH_URL);
  await emailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `Welcome to ${brand.name}`,
    text: `Welcome to ${brand.name}. Your account is ready. Open your workspace: ${url.toString()}`,
    html: transactionalEmail({
      heading: `Welcome to ${brand.name}`,
      paragraphs: ['Your account is ready.'],
      action: { label: 'Open your workspace', url },
    }),
  });
}

export async function sendRenewalReminder(email: string) {
  const url = new URL('/settings?tab=workspaces', process.env.AUTH_URL);
  await emailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `${brand.name} domain renewal reminder`,
    text: `One or more active domains in a workspace you own expire within 30 days. Review your workspaces: ${url.toString()}\n\nYou can change renewal email preferences in ${brand.name} settings.`,
    html: transactionalEmail({
      heading: 'Domain renewal reminder',
      paragraphs: ['One or more active domains in a workspace you own expire within 30 days.'],
      action: { label: 'Review your workspaces', url },
      footer: [`You can change renewal email preferences in ${brand.name} settings.`],
    }),
  });
}

export async function sendActivityEmail(email: string, title: string, message: string) {
  const url = new URL('/sync', process.env.AUTH_URL);
  await emailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `${brand.name}: ${title}`,
    text: `${message}\n\nView workspace activity: ${url.toString()}`,
    html: transactionalEmail({
      heading: title,
      paragraphs: message.split('\n').filter(Boolean),
      action: { label: 'View workspace activity', url },
    }),
  });
}

export async function sendPasswordChangedNotice(user: { email: string }) {
  const transport = emailTransport();
  const url = new URL('/forgot-password', process.env.AUTH_URL);
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: `Your ${brand.name} password was changed`,
    text: `Your ${brand.name} password was changed. If you did not make this change, reset your password now: ${url.toString()} and contact ${brand.name}.`,
    html: transactionalEmail({
      heading: 'Your password was changed',
      paragraphs: [
        `If you did not make this change, reset your password now and contact ${brand.name}.`,
      ],
      action: { label: 'Reset your password', url },
    }),
  });
}

export async function sendSignInRemovalLink(email: string, provider: string, token: string) {
  const url = new URL('/confirm-sign-in-removal', process.env.AUTH_URL);
  url.searchParams.set('token', token);
  const name = provider === 'google' ? 'Google' : 'Discord';
  await emailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `Confirm removal of ${name} sign-in from ${brand.name}`,
    text: `A signed-in session requested removal of ${name} sign-in. Confirm: ${url.toString()}\n\nThis link expires in one hour and can be used once. If you did not request it, ignore this message and secure your account.`,
    html: transactionalEmail({
      heading: `Confirm removal of ${name} sign-in`,
      paragraphs: ['A signed-in session requested this change.'],
      action: { label: 'Review removal', url },
      footer: [
        'This link expires in one hour and can be used once. If you did not request it, ignore this message and secure your account.',
      ],
    }),
  });
}

export async function sendAccountRemovalLink(email: string, token: string) {
  const url = new URL('/confirm-account-removal', process.env.AUTH_URL);
  url.searchParams.set('token', token);
  await emailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `Confirm your ${brand.name} account removal`,
    text: `A signed-in session requested account removal. Review and confirm in the same browser: ${url.toString()}\n\nThis link expires in one hour and can be used once. If you did not request this, ignore it and secure your account.`,
    html: transactionalEmail({
      heading: 'Confirm account removal',
      paragraphs: [
        'A signed-in session requested account removal. Open this link in the same browser to review and confirm.',
      ],
      action: { label: 'Review account removal', url },
      footer: [
        'This link expires in one hour and can be used once. If you did not request it, ignore it and secure your account.',
      ],
    }),
  });
}

export async function sendAuthLink(user: { id: string; email: string }, kind: AuthTokenKind) {
  if (!emailConfigured()) throw new AppError('Email service is not configured', 503);
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (kind === 'verify' ? 24 * 60 : 60) * 60 * 1000);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        emailVerified: true,
        passwordHash: true,
        sessionVersion: true,
        deletedAt: true,
      },
    });
    if (!current || current.deletedAt || current.email !== user.email)
      throw new AppError('Account unavailable', 409);
    let storedKind: string = kind;
    if (kind === 'setup') {
      if (!current.emailVerified || current.passwordHash)
        throw new AppError('Password setup is unavailable for this account.', 409);
      storedKind = `setup:${current.sessionVersion}`;
    }
    if (kind === 'orphan') {
      if (!(await isPristineOAuthOrphan(tx, user.id)))
        throw new AppError('Account recovery is unavailable.', 409);
      storedKind = `orphan:${current.sessionVersion}`;
    }
    await tx.authToken.deleteMany({
      where: {
        userId: user.id,
        kind: kind === 'setup' || kind === 'orphan' ? { startsWith: `${kind}:` } : kind,
      },
    });
    await tx.authToken.create({
      data: { userId: user.id, kind: storedKind, tokenHash: hashAuthToken(raw), expiresAt },
    });
  });
  const url = new URL(
    kind === 'verify' ? '/verify-email' : '/reset-password',
    process.env.AUTH_URL,
  );
  url.searchParams.set('token', raw);
  const title =
    kind === 'verify'
      ? `Verify your ${brand.name} email`
      : kind === 'setup' || kind === 'orphan'
        ? `Set your ${brand.name} password`
        : `Reset your ${brand.name} password`;
  const action =
    kind === 'verify'
      ? 'Verify email'
      : kind === 'setup' || kind === 'orphan'
        ? 'Set password'
        : 'Reset password';
  await emailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: title,
    text: `${title}\n\n${action}: ${url.toString()}\n\nThis link expires in ${kind === 'verify' ? '24 hours' : 'one hour'} and can be used once. If you did not request it, ignore this message.`,
    html: transactionalEmail({
      heading: title,
      paragraphs: ['Use the button below to continue.'],
      action: { label: action, url },
      footer: [
        `This link expires in ${kind === 'verify' ? '24 hours' : 'one hour'} and can be used once. If you did not request it, ignore this message.`,
      ],
    }),
  });
}
