import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    'packages/api-protocol': {},
    'packages/host': {
      ignore: [
        // Stub files for features not yet ported from triangle-js-sdks
        'src/auth/sso/types.ts',
        'src/auth/identity/types.ts',
      ],
      // neverthrow types appear in .d.ts output via api-protocol re-exports
      ignoreDependencies: ['neverthrow'],
    },
    'packages/product': {
      // neverthrow types appear in .d.ts output via api-protocol re-exports
      ignoreDependencies: ['neverthrow'],
    },
    // Root workspace for tests and e2e
    '.': {
      entry: ['test/**/*.spec.ts', 'e2e/harness/host.ts', 'e2e/harness/product.ts'],
      project: ['test/**/*.ts', 'e2e/**/*.ts', '!e2e/vite.config.ts'],
      ignoreDependencies: ['@polkadot/api-protocol', '@polkadot/host', '@polkadot/product'],
    },
  },
};

export default config;
