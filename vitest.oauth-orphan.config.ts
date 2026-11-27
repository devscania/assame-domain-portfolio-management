import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Inline Auth.js so its actual handler can run with synthetic OAuth responses in Node.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      {
        find: 'next/server',
        replacement: fileURLToPath(new URL('./node_modules/next/server.js', import.meta.url)),
      },
      {
        find: 'next/headers',
        replacement: fileURLToPath(new URL('./node_modules/next/headers.js', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/oauth-orphan.integration.ts', 'tests/oauth-session.integration.ts'],
    environment: 'node',
    testTimeout: 30000,
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
});
