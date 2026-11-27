import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([
  ...next,
  ...ts,
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-location-assign-relative-destination': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },
  globalIgnores(['.next/**', 'next-env.d.ts', '.local/**']),
]);
