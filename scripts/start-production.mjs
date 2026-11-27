import 'dotenv/config';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.next', 'standalone');
if (!existsSync(path.join(output, 'server.js'))) throw new Error('Run npm run build first.');
cpSync(path.join(root, '.next', 'static'), path.join(output, '.next', 'static'), {
  recursive: true,
});
cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
process.env.HOSTNAME = process.env.DOMAIN_CONSOLE_BIND || '127.0.0.1';
process.env.PORT = process.env.PORT || '3010';
await import(pathToFileURL(path.join(output, 'server.js')).href);
