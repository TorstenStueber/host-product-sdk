/**
 * Remote signing via SSO manager.
 *
 * Creates signing callbacks that route sign requests through the
 * pre-built statement-store {@link Session} to the paired mobile wallet
 * and return the wallet's signature as `ResultAsync<_, RemoteSignError>`.
 *
 * Session lifecycle is owned by the SDK (built on pair-success / session
 * restore, disposed on unpair). `signing.ts` is just the timeout +
 * paired-guard wrapper around the executor.
 */

import { ResultAsync, err, ok, type Result } from 'neverthrow';
import type { Session } from '../../statementStore/session/index.js';
import type { SsoManager } from './manager.js';
import type {
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
  RemoteSignError,
} from './signRequestExecutor.js';

export type RemoteSigningConfig = {
  manager: SsoManager;
  session: Session;
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
  const { manager, session, executor, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  function ensurePaired(): Result<void, RemoteSignError> {
    return manager.getState().status === 'paired' ? ok(undefined) : err({ tag: 'NotPaired' });
  }

  function withTimeout(
    build: (signal: AbortSignal) => ResultAsync<RemoteSignResult, RemoteSignError>,
  ): ResultAsync<RemoteSignResult, RemoteSignError> {
    const controller = new AbortController();
    const timeoutPromise = new Promise<Result<RemoteSignResult, RemoteSignError>>(resolve => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve(err({ tag: 'Timeout' }));
      }, timeoutMs);
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
      return ensurePaired().asyncAndThen(() => withTimeout(signal => executor.signPayload(session, request, signal)));
    },

    signRaw(request) {
      return ensurePaired().asyncAndThen(() => withTimeout(signal => executor.signRaw(session, request, signal)));
    },
  };
}
