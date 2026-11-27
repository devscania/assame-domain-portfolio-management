import 'dotenv/config';
import { hash } from 'argon2';
import { PrismaClient, Prisma } from '@prisma/client';
import { parseArgs } from 'node:util';
import { z } from 'zod';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Use --password-stdin for redirected input.');
  process.stdout.write('Password (12–128 characters, hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          finish();
          reject(new Error('Account creation cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(password);
          return;
        }
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else if (character >= ' ' && password.length < 129) password += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      workspace: { type: 'string', default: 'My portfolio' },
      'password-stdin': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const details = z
    .object({
      email: z
        .email()
        .max(254)
        .transform((value) => value.toLowerCase()),
      name: z.string().trim().min(1).max(100).optional(),
      workspace: z.string().trim().min(1).max(100),
    })
    .safeParse(values);
  if (!details.success)
    throw new Error('Supply --email and optional --name and --workspace values.');
  if (details.data.email === 'demo@assame.local')
    throw new Error('Choose a personal email address. The demo address is reserved for the seed.');

  let password: string;
  if (values['password-stdin']) {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 130) throw new Error('Password must contain 12–128 characters.');
    }
    password = input.replace(/\r?\n$/, '');
  } else password = await readPassword();
  if (!z.string().min(12).max(128).safeParse(password).success)
    throw new Error('Password must contain 12–128 characters.');

  const passwordHash = await hash(password, { type: 2 });
  const db = new PrismaClient();
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: details.data.email,
          name: details.data.name,
          passwordHash,
          emailVerified: new Date(),
          verificationRequired: true,
        },
      });
      await tx.organization.create({
        data: {
          name: details.data.workspace,
          workspaceOwnerId: user.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
    });
    console.log('Account and workspace created. Sign in with your email and password.');
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new Error('An account with that email already exists.');
    throw new Error('Unable to create the account. Check the database connection and migrations.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Account creation failed.');
  process.exitCode = 1;
});
