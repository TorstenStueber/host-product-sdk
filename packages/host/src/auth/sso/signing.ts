/**
 * Remote signing via SSO manager.
 *
 * Creates signing callbacks that route sign requests through the SSO
 * transport to the paired mobile wallet, and return the wallet's signature
 * as a neverthrow `ResultAsync` over the flat {@link RemoteSignError} union.
 *
 * The actual encryption/framing is delegated to an injected SignRequestExecutor,
 * since it depends on the session key established during pairing.
 */

import { ResultAsync, err, ok, type Result } from 'neverthrow';
import type { StatementStoreAdapter } from '../../statementStore/types.js';
import type { SsoManager } from './manager.js';
import type {
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
  RemoteSignError,
} from './signRequestExecutor.js';

// ---------------------------------------------------------------------------
// Remote signing bridge
// ---------------------------------------------------------------------------

export type RemoteSigningConfig = {
  manager: SsoManager;
  statementStore: StatementStoreAdapter;
  executor: SignRequestExecutor;
  /** Timeout in ms for the wallet to respond. Default: 90_000 (90 seconds). */
  timeoutMs?: number;
};

export type RemoteSigner = {
  signPayload(request: RemoteSignPayloadRequest): ResultAsync<RemoteSignResult, RemoteSignError>;
  signRaw(request: RemoteSignRawRequest): ResultAsync<RemoteSignResult, RemoteSignError>;
};

const DEFAULT_TIMEOUT_MS = 90_000;

export function createRemoteSigner(config: RemoteSigningConfig): RemoteSigner {
  const { manager, statementStore, executor, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  function ensurePaired(): Result<void, RemoteSignError> {
    return manager.getState().status === 'paired' ? ok(undefined) : err({ tag: 'NotPaired' });
  }

  /**
   * Wrap a `ResultAsync` with a timeout. If `timeoutMs` elapses before the
   * inner result settles, the outer result resolves with `err(Timeout)` and
   * the shared `AbortController` is aborted so the executor tears down its
   * subscription and submit path (which surfaces as `err(Aborted)` inside
   * the executor — swallowed here by the timeout race).
   */
  function withTimeout(
    build: (signal: AbortSignal) => ResultAsync<RemoteSignResult, RemoteSignError>,
  ): ResultAsync<RemoteSignResult, RemoteSignError> {
    const controller = new AbortController();

    const timeoutPromise = new Promise<Result<RemoteSignResult, RemoteSignError>>(resolve => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve(err({ tag: 'Timeout' }));
      }, timeoutMs);
      // Ensure the timer is cleared if the executor settles first.
      void build(controller.signal).match(
        v => {
          clearTimeout(timer);
          resolve(ok(v));
        },
        e => {
          clearTimeout(timer);
          resolve(err(e));
        },
      );
    });

    return ResultAsync.fromSafePromise(timeoutPromise).andThen(r => r);
  }

  return {
    signPayload(request) {
      return ensurePaired().asyncAndThen(() =>
        withTimeout(signal => executor.signPayload(statementStore, request, signal)),
      );
    },

    signRaw(request) {
      return ensurePaired().asyncAndThen(() =>
        withTimeout(signal => executor.signRaw(statementStore, request, signal)),
      );
    },
  };
}
