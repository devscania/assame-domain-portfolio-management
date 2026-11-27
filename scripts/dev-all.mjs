import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const generated = spawnSync(process.execPath, ['scripts/ensure-prisma.mjs'], {
  cwd,
  stdio: 'inherit',
});
if (generated.status !== 0) process.exit(generated.status ?? 1);
const children = [
  spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3010'],
    { cwd, stdio: 'inherit' },
  ),
  spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { cwd, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
