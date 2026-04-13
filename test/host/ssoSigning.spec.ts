/**
 * Remote signing tests.
 *
 * Tests for createRemoteSigner: guards, timeout, and delegation to executor.
 */

import { describe, it, expect, vi } from 'vitest';
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
    async execute(_transport, onQr) {
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
    async signPayload() {
      return result;
    },
    async signRaw() {
      return result;
    },
  };
}

function hangingSignExecutor(): SignRequestExecutor {
  return {
    signPayload(_t, _r, signal) {
      return new Promise<RemoteSignResult>((_resolve, _reject) => {
        signal.addEventListener('abort', () => _reject(new Error('aborted')));
      });
    },
    signRaw(_t, _r, signal) {
      return new Promise<RemoteSignResult>((_resolve, _reject) => {
        signal.addEventListener('abort', () => _reject(new Error('aborted')));
      });
    },
  };
}

async function createPairedSetup(signExecutor?: SignRequestExecutor) {
  const storage = createMemoryStorageAdapter();
  const sessionStore = createSsoSessionStore(storage);
  const bus = createMemoryStatementStore();
  const adapter = bus.createAdapter();
  const manager = createSsoManager({
    statementStore: adapter,
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

  it('signPayload throws when manager is not paired', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const bus = createMemoryStatementStore();
    const adapter = bus.createAdapter();
    const manager = createSsoManager({
      statementStore: adapter,
      sessionStore,
      secretStore: createSecretStore(storage),
      pairingExecutor: immediateExecutor(),
    });

    const signer = createRemoteSigner({
      manager,
      statementStore: adapter,
      executor: immediateSignExecutor(),
    });

    await expect(signer.signPayload(makePayloadRequest())).rejects.toThrow('Cannot sign');
  });

  it('signRaw throws when manager is not paired', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const bus = createMemoryStatementStore();
    const adapter = bus.createAdapter();
    const manager = createSsoManager({
      statementStore: adapter,
      sessionStore,
      secretStore: createSecretStore(storage),
      pairingExecutor: immediateExecutor(),
    });

    const signer = createRemoteSigner({
      manager,
      statementStore: adapter,
      executor: immediateSignExecutor(),
    });

    await expect(signer.signRaw(makeRawRequest())).rejects.toThrow('Cannot sign');
  });

  // ── Happy path ────────────────────────────────────────────

  it('signPayload returns signature from executor', async () => {
    const result = makeSignResult();
    const { signer } = await createPairedSetup(immediateSignExecutor(result));

    const signed = await signer.signPayload(makePayloadRequest());
    expect(signed.signature).toEqual(result.signature);
  });

  it('signRaw returns signature from executor', async () => {
    const result = makeSignResult();
    const { signer } = await createPairedSetup(immediateSignExecutor(result));

    const signed = await signer.signRaw(makeRawRequest());
    expect(signed.signature).toEqual(result.signature);
  });

  it('signPayload passes request to executor', async () => {
    const executorFn = vi.fn().mockResolvedValue(makeSignResult());
    const executor: SignRequestExecutor = {
      signPayload: executorFn,
      async signRaw() {
        return makeSignResult();
      },
    };

    const { signer } = await createPairedSetup(executor);
    const req = makePayloadRequest();
    await signer.signPayload(req);

    expect(executorFn).toHaveBeenCalledTimes(1);
    expect(executorFn.mock.calls[0][1]).toEqual(req);
  });

  // ── Timeout ───────────────────────────────────────────────

  it('signPayload rejects on timeout', async () => {
    const { signer } = await createPairedSetup(hangingSignExecutor());

    await expect(signer.signPayload(makePayloadRequest())).rejects.toThrow('timed out');
  });

  it('signRaw rejects on timeout', async () => {
    const { signer } = await createPairedSetup(hangingSignExecutor());

    await expect(signer.signRaw(makeRawRequest())).rejects.toThrow('timed out');
  });

  // ── Executor error ────────────────────────────────────────

  it('signPayload propagates executor errors', async () => {
    const failExecutor: SignRequestExecutor = {
      async signPayload() {
        throw new Error('wallet rejected');
      },
      async signRaw() {
        return makeSignResult();
      },
    };

    const { signer } = await createPairedSetup(failExecutor);
    await expect(signer.signPayload(makePayloadRequest())).rejects.toThrow('wallet rejected');
  });

  // ── signedTransaction ─────────────────────────────────────

  it('signPayload preserves signedTransaction from executor', async () => {
    const result: RemoteSignResult = {
      signature: new Uint8Array(64).fill(0xee),
      signedTransaction: new Uint8Array([0xde, 0xad]),
    };

    const { signer } = await createPairedSetup(immediateSignExecutor(result));
    const signed = await signer.signPayload(makePayloadRequest());
    expect(signed.signedTransaction).toEqual(new Uint8Array([0xde, 0xad]));
  });
});
