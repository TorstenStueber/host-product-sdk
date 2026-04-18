# CLAUDE.md

## Code conventions

- **No barrel files.** Do not create `index.ts` files whose only purpose is to re-export from other files. Each package
  has a single `index.ts` entry point that exports the public API — import directly from the source file everywhere
  else.
- **Prefer `Promise` over `PromiseLike`.** Use `Promise` in type signatures unless there is a specific reason to accept
  thenables.
- **Use `() => void` instead of `VoidFunction`.** Do not use the built-in `VoidFunction` type alias anywhere — write
  `() => void` inline instead.
- **Prefer `undefined` over `null`.** Use `undefined` for absent values. Only use `null` when forced by an external API
  (DOM methods like `localStorage.getItem()`, `contentWindow`, JSON-RPC spec, etc.). Never introduce `null` in our own
  types, return values, or state variables.
- **Avoid `as` type assertions.** `as T`, `as never`, `as unknown`, `as any` all suppress TypeScript's checks and
  frequently hide real bugs (enum-tag casing mismatches, field renames, optional-vs-required differences). Only use `as`
  when unavoidable — at genuine system boundaries where the runtime type is known but unexpressible statically:
  `JSON.parse` results, SCALE-decoded bytes, raw DOM APIs, legitimately-typed tagged unions narrowed by a runtime check.
  If you're reaching for `as never` or `as unknown` in domain code, the types actually differ — write a proper
  conversion function instead of a cast. Prefer inline object literals over casts when returning typed values
  (TypeScript uses contextual typing to check them).

## Git

- **Never mention Claude in commit messages.** No co-authored-by lines, no references to AI assistance.

## Building and typechecking

- **Clean rebuild after renaming or deleting files.** Nx and tsc incremental builds cache old output. When files are
  renamed or deleted, stale `.d.ts` files in `dist/` cause phantom type errors. After such changes, run:
  ```
  rm -rf packages/*/dist packages/*/node_modules/.tmp .nx
  npx nx run-many -t build --skip-nx-cache
  ```
- **Keep tsconfig paths in sync with Vite aliases.** Code that uses Vite `resolve.alias` (like the e2e harness) must
  have a companion `tsconfig.json` with matching `paths` entries, otherwise `tsc` and IDEs cannot resolve the imports.
- **Rebuild `host-api` before typechecking.** The `host` and `product` packages compile against the built `.d.ts` files
  in `packages/host-api/dist/`. Run `npm run build -w @polkadot/host-api` (or `npx nx run @polkadot/host-api:build`)
  before running `npx nx run-many -t typecheck`, otherwise downstream packages may typecheck against stale declarations.

## After implementing a feature

Do these steps in order before reporting completion:

1. **Write tests.** Think about new tests that cover the happy path, error cases, and edge cases. Include e2e tests when
   the feature affects host-product communication. Be creative but write meaningful tests — don't just test the obvious.
2. **Run all tests.** `npm test` (unit) and `npm run test:e2e` (e2e). All must be green.
3. **Format.** `npm run format`.
4. **Update ARCHITECTURE.md.** If the change affects anything described there (types, file structure, counts, behavior),
   correct it so it stays in sync with the code.
5. **Commit.**
