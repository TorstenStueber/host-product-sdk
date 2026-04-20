/**
 * Remote signing tests.
 *
 * Tests for createRemoteSigner: guards, timeout, and delegation to the
 * executor. All signer methods return neverthrow `ResultAsync`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import {
  createRemoteSigner,
  createSsoManager,
  createSsoSessionStore,
  createSecretStore,
  createMemoryStorageAdapter,
  createMemoryStatementStore,
} from '@polkadot/host';
import type {
  PairingExecutor,
  PairingResult,
  PersistedSessionMeta,
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
  RemoteSignError,
} from '@polkadot/host';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(): PersistedSessionMeta {
  return {
    sessionId: 'sign-session',
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    displayName: 'Signer',
    sessionKey: new Uint8Array(32).fill(0xaa),
    remoteAccountId: new Uint8Array(32).fill(0xbb),
  };
}

function makeResult(): PairingResult {
  return {
    session: makeMeta(),
    secrets: {
      ssSecret: new Uint8Array(64).fill(0xdd),
      encrSecret: new Uint8Array(32).fill(0xee),
      entropy: new Uint8Array(16).fill(0xff),
    },
  };
}

function immediateExecutor(): PairingExecutor {
  return {
    async execute(onQr) {
      onQr('qr://test');
      return makeResult();
    },
  };
}

function makePayloadRequest(): RemoteSignPayloadRequest {
  return {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    blockHash: '0x1234',
    blockNumber: '0x01',
    era: '0x00',
    genesisHash: '0xabcd',
    method: '0xcafebabe',
    nonce: '0x00',
    specVersion: '0x01',
    tip: '0x00',
    transactionVersion: '0x01',
    signedExtensions: [],
    version: 4,
    assetId: undefined,
    metadataHash: undefined,
    mode: undefined,
    withSignedTransaction: false,
  };
}

function makeRawRequest(): RemoteSignRawRequest {
  return {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    data: { tag: 'Bytes', value: new Uint8Array([1, 2, 3]) },
  };
}

function makeSignResult(): RemoteSignResult {
  return {
    signature: new Uint8Array(64).fill(0xdd),
    signedTransaction: undefined,
  };
}

function immediateSignExecutor(result: RemoteSignResult = makeSignResult()): SignRequestExecutor {
  return {
    signPayload: () => okAsync(result),
    signRaw: () => okAsync(result),
  };
}

function hangingSignExecutor(): SignRequestExecutor {
  // Resolves only when the signal aborts; surfaces as err(Aborted) inside
  // the executor, but the outer withTimeout should intercept with Timeout
  // first.
  const hang = (_t: unknown, _r: unknown, signal: AbortSignal): ResultAsync<RemoteSignResult, RemoteSignError> => {
    return ResultAsync.fromSafePromise(
      new Promise<never>((_resolve, _reject) => {
        signal.addEventListener('abort', () => _reject(new Error('aborted')));
      }).catch(() => ({ signature: new Uint8Array(64), signedTransaction: undefined })) as Promise<RemoteSignResult>,
    );
  };
  return { signPayload: hang, signRaw: hang };
}

async function createPairedSetup(signExecutor?: SignRequestExecutor) {
  const storage = createMemoryStorageAdapter();
  const sessionStore = createSsoSessionStore(storage);
  const bus = createMemoryStatementStore();
  const adapter = bus.createAdapter();
  const manager = createSsoManager({
    sessionStore,
    secretStore: createSecretStore(storage),
    pairingExecutor: immediateExecutor(),
  });

  manager.pair();
  await new Promise(r => setTimeout(r, 10));

  const signer = createRemoteSigner({
    manager,
    statementStore: adapter,
    executor: signExecutor ?? immediateSignExecutor(),
    timeoutMs: 500,
  });

  return { manager, signer, statementStore: adapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRemoteSigner', () => {
  // ── Guard: must be paired ─────────────────────────────────

  it('signPayload returns NotPaired when manager is not paired', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const bus = createMemoryStatementStore();
    const adapter = bus.createAdapter();
    const manager = createSsoManager({
      sessionStore,
      secretStore: createSecretStore(storage),
      pairingExecutor: immediateExecutor(),
    });

    const signer = createRemoteSigner({
      manager,
      statementStore: adapter,
      executor: immediateSignExecutor(),
    });

    const result = await signer.signPayload(makePayloadRequest());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('NotPaired');
  });

  it('signRaw returns NotPaired when manager is not paired', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const bus = createMemoryStatementStore();
    const adapter = bus.createAdapter();
    const manager = createSsoManager({
      sessionStore,
      secretStore: createSecretStore(storage),
      pairingExecutor: immediateExecutor(),
    });

    const signer = createRemoteSigner({
      manager,
      statementStore: adapter,
      executor: immediateSignExecutor(),
    });

    const result = await signer.signRaw(makeRawRequest());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('NotPaired');
  });

  // ── Happy path ────────────────────────────────────────────

  it('signPayload returns signature from executor', async () => {
    const result = makeSignResult();
    const { signer } = await createPairedSetup(immediateSignExecutor(result));

    const signed = await signer.signPayload(makePayloadRequest());
    expect(signed.isOk()).toBe(true);
    expect(signed._unsafeUnwrap().signature).toEqual(result.signature);
  });

  it('signRaw returns signature from executor', async () => {
    const result = makeSignResult();
    const { signer } = await createPairedSetup(immediateSignExecutor(result));

    const signed = await signer.signRaw(makeRawRequest());
    expect(signed.isOk()).toBe(true);
    expect(signed._unsafeUnwrap().signature).toEqual(result.signature);
  });

  it('signPayload passes request to executor', async () => {
    const executorFn = vi.fn().mockReturnValue(okAsync(makeSignResult()));
    const executor: SignRequestExecutor = {
      signPayload: executorFn,
      signRaw: () => okAsync(makeSignResult()),
    };

    const { signer } = await createPairedSetup(executor);
    const req = makePayloadRequest();
    const result = await signer.signPayload(req);
    expect(result.isOk()).toBe(true);

    expect(executorFn).toHaveBeenCalledTimes(1);
    expect(executorFn.mock.calls[0]![1]).toEqual(req);
  });

  // ── Timeout ───────────────────────────────────────────────

  it('signPayload returns Timeout when the executor hangs', async () => {
    const { signer } = await createPairedSetup(hangingSignExecutor());

    const result = await signer.signPayload(makePayloadRequest());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('Timeout');
  });

  it('signRaw returns Timeout when the executor hangs', async () => {
    const { signer } = await createPairedSetup(hangingSignExecutor());

    const result = await signer.signRaw(makeRawRequest());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('Timeout');
  });

  // ── Executor error ────────────────────────────────────────

  it('signPayload propagates executor errors', async () => {
    const failExecutor: SignRequestExecutor = {
      signPayload: () => errAsync({ tag: 'Rejected', reason: 'wallet rejected' }),
      signRaw: () => okAsync(makeSignResult()),
    };

    const { signer } = await createPairedSetup(failExecutor);
    const result = await signer.signPayload(makePayloadRequest());
    expect(result.isErr()).toBe(true);
    const e = result._unsafeUnwrapErr();
    expect(e.tag).toBe('Rejected');
    if (e.tag === 'Rejected') expect(e.reason).toBe('wallet rejected');
  });

  // ── signedTransaction ─────────────────────────────────────

  it('signPayload preserves signedTransaction from executor', async () => {
    const result: RemoteSignResult = {
      signature: new Uint8Array(64).fill(0xee),
      signedTransaction: new Uint8Array([0xde, 0xad]),
    };

    const { signer } = await createPairedSetup(immediateSignExecutor(result));
    const signed = await signer.signPayload(makePayloadRequest());
    expect(signed.isOk()).toBe(true);
    expect(signed._unsafeUnwrap().signedTransaction).toEqual(new Uint8Array([0xde, 0xad]));
  });
});
