import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const readSchema = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n').trimEnd();
const schema = readSchema(new URL('../prisma/schema.prisma', import.meta.url));
const probe = `
  const { PrismaClient, Prisma } = require('@prisma/client');
  if (Prisma.prismaVersion.client !== require('@prisma/client/package.json').version) process.exit(1);
  const client = new PrismaClient();
  client.$disconnect().catch(() => { process.exitCode = 1; });
`;
function initialized() {
  try {
    const generated = join(dirname(require.resolve('.prisma/client/default')), 'schema.prisma');
    if (readSchema(generated) !== schema) return false;
  } catch {
    return false;
  }
  return spawnSync(process.execPath, ['-e', probe], { cwd: root, stdio: 'ignore' }).status === 0;
}

// Reuse a healthy client for this schema. Regenerating a client used by another process
// can fail with a locked query-engine DLL on Windows.
if (!initialized()) {
  console.log('Generating the Prisma client for the current schema…');
  const result = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'generate'],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (result.status !== 0 || !initialized()) {
    console.error(
      'Prisma generation failed. Stop this project’s app/worker processes and run npm run db:generate.',
    );
    process.exit(1);
  }
}
