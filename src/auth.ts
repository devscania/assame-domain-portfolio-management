import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Discord from 'next-auth/providers/discord';
import { oauthAdapter } from '@/lib/oauth-adapter';
import { providerEnabled, verifiedOAuthProfile } from '@/lib/oauth-policy';
import { verify } from 'argon2';
import { z } from 'zod';
import { db } from '@/lib/db';
import { throttle } from '@/lib/throttle';
import { recordSuspiciousActivity } from '@/lib/suspicious-activity';
import { createLoginSession, validLoginSession } from '@/lib/login-sessions';
import { cookies } from 'next/headers';

class EmailVerificationRequired extends CredentialsSignin {
  code = 'email_verification_required';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: oauthAdapter,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  trustHost: true,
  pages: { signIn: '/login' },
  providers: [
    ...(providerEnabled('google')
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email?.toLowerCase(),
                image: null,
              };
            },
          }),
        ]
      : []),
    ...(providerEnabled('discord')
      ? [
          Discord({
            clientId: process.env.AUTH_DISCORD_ID,
            clientSecret: process.env.AUTH_DISCORD_SECRET,
            // Discord includes its issuer in authorization responses; Auth.js otherwise
            // checks it against its placeholder issuer instead of Discord's origin.
            issuer: 'https://discord.com',
            profile(profile) {
              return {
                id: profile.id,
                name: profile.global_name || profile.username,
                email: profile.email?.toLowerCase(),
                image: null,
              };
            },
          }),
        ]
      : []),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(input, request) {
        const parsed = z
          .object({
            email: z.email().transform((s) => s.toLowerCase()),
            password: z.string().min(1).max(128),
          })
          .safeParse(input);
        if (!parsed.success) return null;
        if (
          parsed.data.email === 'demo@assame.local' &&
          (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production')
        )
          return null;
        await throttle(
          `login-address:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
          100,
        );
        await throttle(`login:${parsed.data.email}`);
        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        // A fixed Argon2 hash keeps unknown-user attempts on the password-verification path.
        const dummy =
          '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$XGqoXYHS3jQvFOCT8W7hqnq1YbL3sFpZzFjWlEWvVvI';
        const valid = await verify(user?.passwordHash || dummy, parsed.data.password).catch(
          () => false,
        );
        if (!valid || !user?.passwordHash || user.deletedAt) {
          await recordSuspiciousActivity(
            'password_failures',
            user?.passwordHash && !user.deletedAt && !valid ? user.id : null,
          );
          return null;
        }
        if (user.verificationRequired && !user.emailVerified)
          throw new EmailVerificationRequired();
        return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider === 'credentials') return true;
      return !!account && verifiedOAuthProfile(account.provider, profile);
    },
    async jwt({ token, user, account, trigger }) {
      if (user) {
        token.sub = user.id;
        if (!user.id || !account?.provider) return null;
        let consentedSignup = false;
        if (trigger === 'signUp' && ['google', 'discord'].includes(account.provider)) {
          try {
            consentedSignup = (await cookies()).get('assame-oauth-analytics')?.value === account.provider;
          } catch {
            // Signup must not depend on optional analytics.
          }
        }
        const login = await createLoginSession(
          user.id,
          (user as { sessionVersion?: number }).sessionVersion,
          account.provider,
          account.providerAccountId,
          consentedSignup,
        );
        if (!login) return null;
        token.sessionVersion = login.sessionVersion;
        token.loginSessionId = login.id;
      }
      if (token.sub) {
        if (
          typeof token.loginSessionId !== 'string' ||
          !(await validLoginSession(token.sub, token.loginSessionId, token.sessionVersion))
        )
          return null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      if (typeof token.loginSessionId === 'string')
        (session as typeof session & { loginSessionId?: string }).loginSessionId =
          token.loginSessionId;
      return session;
    },
  },
  events: {
    async signOut(message) {
      if (
        'token' in message &&
        typeof message.token?.loginSessionId === 'string' &&
        message.token.sub
      )
        await db.accountLoginSession.deleteMany({
          where: { id: message.token.loginSessionId, userId: message.token.sub },
        });
    },
  },
});
