# CLAUDE.md

## Code conventions

- **No barrel files.** Do not create `index.ts` files whose only purpose is to re-export from other files. Each package has a single `index.ts` entry point that exports the public API — import directly from the source file everywhere else.
