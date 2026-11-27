import 'dotenv/config';
import { spawn } from 'node:child_process';
import { assertBrowserEnvironment, browserOrigin, browserSmtpPort } from '../tests/e2e/environment';

assertBrowserEnvironment();
const appUrl = new URL(browserOrigin);
// Do not call npm predev/postinstall: the shared Prisma client must stay untouched.
const child = spawn(
  process.execPath,
  [
    '--import',
    new URL('./browser-network-guard.mjs', import.meta.url).href,
    'node_modules/next/dist/bin/next',
    'dev',
    // Webpack permits the documented shared node_modules worktree junction.
    // Turbopack's hermetic root rejects dependencies outside that checkout.
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    appUrl.port,
  ],
  { stdio: 'inherit', env: { ...process.env, SMTP_PORT: String(browserSmtpPort) } },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
