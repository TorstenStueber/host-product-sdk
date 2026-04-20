/**
 * Tests for createStatementStoreClient.
 *
 * Exercises the real client against a mock PeopleChainClient to verify:
 * - matchAll topic filter construction
 * - subscription multiplexing (one upstream RPC per unique topic set)
 * - submit-response mapping onto the StatementStoreError union
 * - query aggregation until `remaining === 0`
 */

import { describe, expect, it, vi } from 'vitest';
import { createStatementStoreClient } from '@polkadot/host';
import type { PeopleChainClient, SignedStatement, StatementStoreError } from '@polkadot/host';
import { encodeStatement } from '../../packages/host/src/statementStore/codec.js';
import { bytesToHex } from '@polkadot/api-protocol';

// ---------------------------------------------------------------------------
// Mock PeopleChainClient
// ---------------------------------------------------------------------------

type Sink = { next(value: unknown): void; error(err: unknown): void };

type SubscribeCall = {
  method: string;
  unsubMethod: string;
  params: unknown[];
  sink?: Sink;
  unsubscribe: ReturnType<typeof vi.fn>;
};

function makeClient() {
  const subscribeCalls: SubscribeCall[] = [];
  const requestCalls: { method: string; params: unknown[] }[] = [];
  const requestResponders = new Map<string, (params: unknown[]) => Promise<unknown>>();

  const client: PeopleChainClient = {
    _request: (async (method: string, params: unknown[]) => {
      requestCalls.push({ method, params });
      const fn = requestResponders.get(method);
      if (!fn) return null;
      return fn(params);
    }) as PeopleChainClient['_request'],
    _subscribe: vi.fn(<T>(method: string, unsubMethod: string, params: unknown[]) => {
      const call: SubscribeCall = {
        method,
        unsubMethod,
        params,
        unsubscribe: vi.fn(),
      };
      subscribeCalls.push(call);
      return {
        subscribe(observer: { next(value: T): void; error(err: unknown): void }) {
          call.sink = observer as Sink;
          return { unsubscribe: call.unsubscribe };
        },
      };
    }) as PeopleChainClient['_subscribe'],
  };

  return {
    client,
    subscribeCalls,
    requestCalls,
    setRequestResponder(method: string, fn: (params: unknown[]) => Promise<unknown>) {
      requestResponders.set(method, fn);
    },
  };
}

function topic(id: number): Uint8Array {
  const t = new Uint8Array(32);
  t[0] = id;
  return t;
}

function makeSignedStatement(topics: Uint8Array[]): SignedStatement {
  return {
    proof: {
      tag: 'Sr25519',
      value: { signature: new Uint8Array(64), signer: new Uint8Array(32) },
    },
    decryptionKey: undefined,
    expiry: undefined,
    channel: undefined,
    topics,
    data: new Uint8Array([1, 2, 3]),
  };
}

function pushStatementEvent(sink: Sink, statements: SignedStatement[], remaining?: number): void {
  sink.next({
    event: 'newStatements',
    data: {
      statements: statements.map(s => bytesToHex(encodeStatement(s))),
      remaining,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStatementStoreClient', () => {
  // ── Filter construction ───────────────────────────────────

  it('builds a matchAll filter for a non-empty topic set', () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    statementStore.subscribe([topic(1), topic(2)], () => {});

    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0]!.params).toEqual([{ matchAll: [bytesToHex(topic(1)), bytesToHex(topic(2))] }]);
  });

  it('builds an "any" filter for an empty topic set', () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    statementStore.subscribe([], () => {});

    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0]!.params).toEqual(['any']);
  });

  // ── Subscription multiplexing ─────────────────────────────

  it('two subscribers on the same topics share one upstream subscription', () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    statementStore.subscribe([topic(1), topic(2)], cb1);
    statementStore.subscribe([topic(2), topic(1)], cb2); // different order — same set
    expect(subscribeCalls).toHaveLength(1);

    // A statement arriving upstream fans out to both listeners
    pushStatementEvent(subscribeCalls[0]!.sink!, [makeSignedStatement([topic(1), topic(2)])]);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe of the last listener tears down the upstream', () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    const un1 = statementStore.subscribe([topic(1)], () => {});
    const un2 = statementStore.subscribe([topic(1)], () => {});
    expect(subscribeCalls).toHaveLength(1);

    un1();
    expect(subscribeCalls[0]!.unsubscribe).not.toHaveBeenCalled();

    un2();
    expect(subscribeCalls[0]!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('a fresh subscribe on the same topics after full teardown opens a new upstream', () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    const un = statementStore.subscribe([topic(1)], () => {});
    un();
    statementStore.subscribe([topic(1)], () => {});

    expect(subscribeCalls).toHaveLength(2);
  });

  it('subscribers on different topic sets each get their own upstream', () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    statementStore.subscribe([topic(1)], () => {});
    statementStore.subscribe([topic(2)], () => {});

    expect(subscribeCalls).toHaveLength(2);
  });

  // ── Submit response mapping ───────────────────────────────

  type Case = {
    name: string;
    response: unknown;
    expected: StatementStoreError['tag'] | 'ok';
  };

  const submitCases: Case[] = [
    { name: 'null → ok', response: null, expected: 'ok' },
    { name: 'new → ok', response: { status: 'new' }, expected: 'ok' },
    { name: 'known → ok', response: { status: 'known' }, expected: 'ok' },
    { name: 'knownExpired → KnownExpired', response: { status: 'knownExpired' }, expected: 'KnownExpired' },
    {
      name: 'rejected/dataTooLarge → DataTooLarge',
      response: { status: 'rejected', reason: 'dataTooLarge', submitted_size: 4096, available_size: 2048 },
      expected: 'DataTooLarge',
    },
    {
      name: 'rejected/channelPriorityTooLow → ExpiryTooLow',
      response: { status: 'rejected', reason: 'channelPriorityTooLow', submitted_expiry: 10n, min_expiry: 20n },
      expected: 'ExpiryTooLow',
    },
    {
      name: 'rejected/accountFull → AccountFull',
      response: { status: 'rejected', reason: 'accountFull', submitted_expiry: 1n, min_expiry: 2n },
      expected: 'AccountFull',
    },
    {
      name: 'rejected/storeFull → StorageFull',
      response: { status: 'rejected', reason: 'storeFull' },
      expected: 'StorageFull',
    },
    {
      name: 'rejected/noAllowance → NoAllowance',
      response: { status: 'rejected', reason: 'noAllowance' },
      expected: 'NoAllowance',
    },
    { name: 'invalid/noProof → NoProof', response: { status: 'invalid', reason: 'noProof' }, expected: 'NoProof' },
    { name: 'invalid/badProof → BadProof', response: { status: 'invalid', reason: 'badProof' }, expected: 'BadProof' },
    {
      name: 'invalid/encodingTooLarge → EncodingTooLarge',
      response: { status: 'invalid', reason: 'encodingTooLarge', submitted_size: 9000, max_size: 8192 },
      expected: 'EncodingTooLarge',
    },
    {
      name: 'invalid/alreadyExpired → AlreadyExpired',
      response: { status: 'invalid', reason: 'alreadyExpired' },
      expected: 'AlreadyExpired',
    },
    {
      name: 'internalError → InternalStore',
      response: { status: 'internalError', error: 'boom' },
      expected: 'InternalStore',
    },
    { name: 'unknown status → Unknown', response: { status: 'something_new' }, expected: 'Unknown' },
    {
      name: 'rejected/unknown reason → Unknown',
      response: { status: 'rejected', reason: 'mysterious' },
      expected: 'Unknown',
    },
  ];

  for (const c of submitCases) {
    it(`submit: ${c.name}`, async () => {
      const { client, setRequestResponder } = makeClient();
      setRequestResponder('statement_submit', async () => c.response);
      const { statementStore } = createStatementStoreClient(client);

      const result = await statementStore.submit(makeSignedStatement([topic(1)]));
      if (c.expected === 'ok') {
        expect(result.isOk()).toBe(true);
      } else {
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().tag).toBe(c.expected);
      }
    });
  }

  it('submit: RPC rejection becomes Transport error', async () => {
    const { client, setRequestResponder } = makeClient();
    setRequestResponder('statement_submit', async () => {
      throw new Error('network down');
    });
    const { statementStore } = createStatementStoreClient(client);

    const result = await statementStore.submit(makeSignedStatement([topic(1)]));
    expect(result.isErr()).toBe(true);
    const e = result._unsafeUnwrapErr();
    expect(e.tag).toBe('Transport');
    if (e.tag === 'Transport') expect(e.message).toContain('network down');
  });

  // ── Submit carries typed fields ───────────────────────────

  it('submit: rejected/dataTooLarge preserves submitted and available fields', async () => {
    const { client, setRequestResponder } = makeClient();
    setRequestResponder('statement_submit', async () => ({
      status: 'rejected',
      reason: 'dataTooLarge',
      submitted_size: 4096,
      available_size: 2048,
    }));
    const { statementStore } = createStatementStoreClient(client);

    const result = await statementStore.submit(makeSignedStatement([topic(1)]));
    const e = result._unsafeUnwrapErr();
    expect(e.tag).toBe('DataTooLarge');
    if (e.tag === 'DataTooLarge') {
      expect(e.submitted).toBe(4096);
      expect(e.available).toBe(2048);
    }
  });

  // ── Query ─────────────────────────────────────────────────

  it('query: resolves when remaining === 0', async () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    const pending = statementStore.query([topic(1)]);

    // Wait one microtask for subscribe() to have been invoked
    await new Promise(r => setImmediate(r));
    expect(subscribeCalls).toHaveLength(1);

    const sink = subscribeCalls[0]!.sink!;
    pushStatementEvent(sink, [makeSignedStatement([topic(1)])], 2);
    pushStatementEvent(sink, [makeSignedStatement([topic(1)])], 0);

    const result = await pending;
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(2);
    expect(subscribeCalls[0]!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('query: Transport error when the subscription errors', async () => {
    const { client, subscribeCalls } = makeClient();
    const { statementStore } = createStatementStoreClient(client);

    const pending = statementStore.query([topic(1)]);
    await new Promise(r => setImmediate(r));

    subscribeCalls[0]!.sink!.error(new Error('subscription died'));

    const result = await pending;
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('Transport');
  });
});
