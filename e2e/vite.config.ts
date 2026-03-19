import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'harness'),
  resolve: {
    alias: {
      '@polkadot/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
      '@polkadot/host': path.resolve(__dirname, '../packages/host/src/index.ts'),
      '@polkadot/product': path.resolve(__dirname, '../packages/product/src/index.ts'),
    },
  },
  server: {
    port: 3199,
    strictPort: true,
  },
});
