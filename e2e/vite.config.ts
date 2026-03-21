import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'harness'),
  resolve: {
    alias: {
      '@polkadot/host-api': path.resolve(__dirname, '../packages/host-api/src/index.ts'),
      '@polkadot/host': path.resolve(__dirname, '../packages/host/src/index.ts'),
      '@polkadot/product': path.resolve(__dirname, '../packages/product/src/index.ts'),
    },
  },
  server: {
    port: 3199,
    strictPort: true,
  },
});
