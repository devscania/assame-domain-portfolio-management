import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const config = template
  .replaceAll('replace-with-a-database-password', randomBytes(24).toString('hex'))
  .replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${randomBytes(32).toString('hex')}`)
  .replace(
    /^CREDENTIAL_ENCRYPTION_KEY=$/m,
    `CREDENTIAL_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
  );

try {
  writeFileSync(new URL('../.env', import.meta.url), config, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with fresh local development credentials.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
