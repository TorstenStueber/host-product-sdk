/**
 * SSO transport tests.
 *
 * Tests for the in-memory transport bus and the session store.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMemoryStatementStore, createSsoSessionStore, createMemoryStorageAdapter } from '@polkadot/host';
import type { SignedStatement, PersistedSessionMeta } from '@polkadot/host';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topic(id: number): Uint8Array {
  const t = new Uint8Array(32);
  t[0] = id;
  return t;
}

function makeStatement(topicId: number, data: Uint8Array): SignedStatement {
  return {
    channel: new Uint8Array(32),
    topics: [topic(topicId)],
    data,
    proof: {
      tag: 'sr25519',
      value: {
        signature: new Uint8Array(64).fill(2),
        signer: new Uint8Array(32).fill(1),
      },
    },
  };
}

function makeMeta(id: string = 'session-1'): PersistedSessionMeta {
  return {
    sessionId: id,
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    displayName: 'Test Device',
    remotePublicKey: new Uint8Array(32).fill(0xaa),
    remoteAccountId: new Uint8Array(32).fill(0xbb),
  };
}

// ---------------------------------------------------------------------------
// Memory transport bus
// ---------------------------------------------------------------------------

describe('createMemoryStatementStore', () => {
  it('delivers statements to matching subscribers', async () => {
    const bus = createMemoryStatementStore();
    const transport = bus.createAdapter();
    const callback = vi.fn();

    transport.subscribe([topic(1)], callback);
    await transport.submit(makeStatement(1, new Uint8Array([42])));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toHaveLength(1);
    expect(callback.mock.calls[0][0][0].data).toEqual(new Uint8Array([42]));
  });

  it('does not deliver statements to non-matching subscribers', async () => {
    const bus = createMemoryStatementStore();
    const transport = bus.createAdapter();
    const callback = vi.fn();

    transport.subscribe([topic(1)], callback);
    await transport.submit(makeStatement(2, new Uint8Array([42])));

    expect(callback).not.toHaveBeenCalled();
  });

  it('delivers across transports on the same bus', async () => {
    const bus = createMemoryStatementStore();
    const host = bus.createAdapter();
    const wallet = bus.createAdapter();
    const callback = vi.fn();

    wallet.subscribe([topic(1)], callback);
    await host.submit(makeStatement(1, new Uint8Array([99])));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0][0].data).toEqual(new Uint8Array([99]));
  });

  it('unsubscribe stops delivery', async () => {
    const bus = createMemoryStatementStore();
    const transport = bus.createAdapter();
    const callback = vi.fn();

    const unsub = transport.subscribe([topic(1)], callback);
    await transport.submit(makeStatement(1, new Uint8Array([1])));
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();
    await transport.submit(makeStatement(1, new Uint8Array([2])));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('multiple subscribers on same topic all receive', async () => {
    const bus = createMemoryStatementStore();
    const transport = bus.createAdapter();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    transport.subscribe([topic(1)], cb1);
    transport.subscribe([topic(1)], cb2);
    await transport.submit(makeStatement(1, new Uint8Array([10])));

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('preserves proof public key in delivered statements', async () => {
    const bus = createMemoryStatementStore();
    const transport = bus.createAdapter();
    const callback = vi.fn();

    transport.subscribe([topic(1)], callback);
    await transport.submit(makeStatement(1, new Uint8Array([1])));

    const received = callback.mock.calls[0][0][0];
    expect(received.proof?.tag).toBe('sr25519');
    if (received.proof?.tag === 'sr25519') {
      expect(received.proof.value.signer).toEqual(new Uint8Array(32).fill(1));
    }
  });

  it('subscriber with multiple topics matches any', async () => {
    const bus = createMemoryStatementStore();
    const transport = bus.createAdapter();
    const callback = vi.fn();

    transport.subscribe([topic(1), topic(2)], callback);
    await transport.submit(makeStatement(2, new Uint8Array([1])));

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

describe('createSsoSessionStore', () => {
  it('load returns undefined when empty', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);

    expect(await store.load()).toBeUndefined();
  });

  it('save then load round-trips metadata', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);
    const meta = makeMeta();

    await store.save(meta);
    const loaded = await store.load();

    expect(loaded).toEqual(meta);
  });

  it('save overwrites previous session', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);

    await store.save(makeMeta('first'));
    await store.save(makeMeta('second'));

    const loaded = await store.load();
    expect(loaded?.sessionId).toBe('second');
  });

  it('clear removes the session', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);

    await store.save(makeMeta());
    await store.clear();

    expect(await store.load()).toBeUndefined();
  });

  it('subscribe fires on save', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);
    const callback = vi.fn();

    store.subscribe(callback);
    await store.save(makeMeta('s1'));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]?.sessionId).toBe('s1');
  });

  it('subscribe fires with undefined on clear', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);
    const callback = vi.fn();

    await store.save(makeMeta());
    store.subscribe(callback);
    await store.clear();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeUndefined();
  });

  it('unsubscribe stops notifications', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);
    const callback = vi.fn();

    const unsub = store.subscribe(callback);
    await store.save(makeMeta());
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();
    await store.save(makeMeta('other'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('preserves Uint8Array fields through serialization', async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSsoSessionStore(storage);
    const meta = makeMeta();

    await store.save(meta);
    const loaded = await store.load();

    expect(loaded?.remotePublicKey).toBeInstanceOf(Uint8Array);
    expect(loaded?.remoteAccountId).toBeInstanceOf(Uint8Array);
    expect(loaded?.remotePublicKey).toEqual(new Uint8Array(32).fill(0xaa));
    expect(loaded?.remoteAccountId).toEqual(new Uint8Array(32).fill(0xbb));
  });
});
