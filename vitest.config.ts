/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@polkadot/host-api': path.resolve(__dirname, 'packages/host-api/src/index.ts'),
      '@polkadot/host': path.resolve(__dirname, 'packages/host/src/index.ts'),
      '@polkadot/product': path.resolve(__dirname, 'packages/product/src/index.ts'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
