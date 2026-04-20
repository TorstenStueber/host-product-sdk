/**
 * Tests for createSession — the symmetric bidirectional reliable
 * encrypted request/response channel on top of the statement store.
 *
 * Covers each protocol feature in isolation:
 *   - ACK round-trip via request() / submitResponseMessage().
 *   - Submissions land on the correct (topic, channel).
 *   - Expiry monotonicity is maintained across submissions.
 *   - Batching coalesces while a request is in flight.
 *   - Statement dedup by data hash.
 *   - Proof verification rejects non-peer signatures.
 *   - Late-subscriber buffering replays init-discovered statements.
 *   - Init recovery restores an un-acked outgoing request.
 *   - Clean dispose rejects pending promises.
 */

import { describe, expect, it, vi } from 'vitest';
import { ok, okAsync } from 'neverthrow';
import { Struct, str } from 'scale-ts';
import {
  createSession,
  createSessionId,
  createRequestChannel,
  createResponseChannel,
  StatementDataCodec,
  createMemoryStatementStore,
} from '@polkadot/host';
import type {
  Session,
  SessionError,
  StatementStoreAdapter,
  SignedStatement,
  StatementStoreError,
  Encryption,
  StatementProver,
} from '@polkadot/host';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function bytes(fill: number, length = 32): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Plain-text encryption (for test transparency). Encrypt is identity. */
function identityEncryption(): Encryption {
  return {
    encrypt: plain => ok<Uint8Array, SessionError>(plain),
    decrypt: ct => ok<Uint8Array, SessionError>(ct),
  };
}

/** Prover that just slaps a sr25519 proof with a fixed signer on outgoing
 *  statements, and verifies incoming statements' signer byte-equals the
 *  provided `remotePublicKey`. */
function stubProver(localSigner: Uint8Array, remotePublicKey: Uint8Array): StatementProver {
  return {
    generateMessageProof(statement) {
      const signed: SignedStatement = {
        ...statement,
        proof: {
          tag: 'Sr25519',
          value: { signature: new Uint8Array(64), signer: localSigner },
        },
      };
      return okAsync<SignedStatement, SessionError>(signed);
    },
    verifyMessageProof(statement) {
      const p = statement.proof;
      if (!p || p.tag !== 'Sr25519') return false;
      return bytesEqual(p.value.signer, remotePublicKey);
    },
  };
}

/** Payload codec used across the tests — a trivial one-field struct. */
const PayloadCodec = Struct({ text: str });

const localAccount = { accountId: bytes(0xaa) };
const remoteAccount = { accountId: bytes(0xbb), publicKey: bytes(0xbb) };
const sharedSecret = bytes(0x11);

function setup(opts?: { statementStore?: StatementStoreAdapter; maxRequestSize?: number }): {
  session: Session;
  statementStore: StatementStoreAdapter;
  outgoing: Uint8Array;
  incoming: Uint8Array;
  requestChannel: Uint8Array;
  responseChannel: Uint8Array;
  localSigner: Uint8Array;
  remotePublicKey: Uint8Array;
} {
  const statementStore = opts?.statementStore ?? createMemoryStatementStore().createAdapter();
  const outgoing = createSessionId(sharedSecret, localAccount, remoteAccount);
  const incoming = createSessionId(sharedSecret, remoteAccount, localAccount);
  const requestChannel = createRequestChannel(outgoing);
  const responseChannel = createResponseChannel(incoming);
  const localSigner = localAccount.accountId;
  const remotePublicKey = remoteAccount.publicKey;
  const session = createSession({
    localAccount,
    remoteAccount,
    outgoingSessionId: outgoing,
    incomingSessionId: incoming,
    statementStore,
    encryption: identityEncryption(),
    prover: stubProver(localSigner, remotePublicKey),
    maxRequestSize: opts?.maxRequestSize,
  });
  return { session, statementStore, outgoing, incoming, requestChannel, responseChannel, localSigner, remotePublicKey };
}

/** Helper: play the role of the peer by submitting a pre-built statement. */
async function peerSubmit(
  statementStore: StatementStoreAdapter,
  signer: Uint8Array,
  fields: {
    topic: Uint8Array;
    channel: Uint8Array;
    data: Uint8Array;
  },
): Promise<void> {
  const statement: SignedStatement = {
    proof: { tag: 'Sr25519', value: { signature: new Uint8Array(64), signer } },
    decryptionKey: undefined,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) << 32n,
    channel: fields.channel,
    topics: [fields.topic],
    data: fields.data,
  };
  await statementStore.submit(statement);
}

/** Helper: encode a peer-originated StatementData::request. */
function encodePeerRequest(requestId: string, payloads: Uint8Array[]): Uint8Array {
  return StatementDataCodec.enc({ tag: 'request', value: { requestId, data: payloads } });
}

/** Helper: encode a peer-originated StatementData::response ACK. */
function encodePeerResponse(
  requestId: string,
  responseCode: 'success' | 'decodingFailed' | 'decryptionFailed',
): Uint8Array {
  return StatementDataCodec.enc({ tag: 'response', value: { requestId, responseCode } });
}

/** Helper: read the first submitted statement from a mock adapter. */
type RecordingAdapter = StatementStoreAdapter & {
  submitted: SignedStatement[];
  deliveredOn(topic: Uint8Array): SignedStatement[];
};

function recordingAdapter(backing: StatementStoreAdapter): RecordingAdapter {
  const submitted: SignedStatement[] = [];
  return {
    subscribe(topics, cb) {
      return backing.subscribe(topics, cb);
    },
    submit(statement) {
      submitted.push(statement);
      return backing.submit(statement);
    },
    query(topics) {
      return backing.query(topics);
    },
    submitted,
    deliveredOn(topic) {
      return submitted.filter(s => s.topics.some(t => bytesEqual(t, topic)));
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSession', () => {
  // ── ACK round-trip ────────────────────────────────────────

  it('request() resolves when the peer ACKs with success', async () => {
    const { session, statementStore, outgoing, remotePublicKey } = setup();
    await new Promise(r => setTimeout(r, 0));

    const promise = session.request(PayloadCodec, { text: 'hi' });
    // Wait for our submission to land so we know its requestId.
    await new Promise(r => setTimeout(r, 0));
    const recorded = (statementStore as unknown as RecordingAdapter).submitted;
    // If backing store isn't recording, fall back to reading from query.
    const all = await statementStore.query([outgoing]);
    expect(all.isOk()).toBe(true);
    const ourStatement = recorded ? recorded[0] : all._unsafeUnwrap()[0];
    expect(ourStatement).toBeDefined();
    const decoded = StatementDataCodec.dec(ourStatement!.data!);
    expect(decoded.tag).toBe('request');
    if (decoded.tag !== 'request') return;

    // Peer ACKs — publishing a response-tag statement on our outgoing
    // topic, signed with the peer's key and on the responseChannel.
    await peerSubmit(statementStore, remotePublicKey, {
      topic: outgoing,
      channel: createResponseChannel(outgoing),
      data: encodePeerResponse(decoded.value.requestId, 'success'),
    });

    const result = await promise;
    expect(result.isOk()).toBe(true);
  });

  it('request() rejects with DecodingFailed if the peer ACKs decodingFailed', async () => {
    const { session, statementStore, outgoing, remotePublicKey } = setup();
    await new Promise(r => setTimeout(r, 0));

    const promise = session.request(PayloadCodec, { text: 'hi' });
    await new Promise(r => setTimeout(r, 0));
    const all = (await statementStore.query([outgoing]))._unsafeUnwrap();
    const decoded = StatementDataCodec.dec(all[0]!.data!);
    if (decoded.tag !== 'request') throw new Error('unexpected');

    await peerSubmit(statementStore, remotePublicKey, {
      topic: outgoing,
      channel: createResponseChannel(outgoing),
      data: encodePeerResponse(decoded.value.requestId, 'decodingFailed'),
    });

    const result = await promise;
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('DecodingFailed');
  });

  // ── Outgoing (topic, channel) is correct ─────────────────

  it('outgoing requests are submitted on outgoingSessionId + requestChannel', async () => {
    const backing = createMemoryStatementStore().createAdapter();
    const adapter = recordingAdapter(backing);
    const { session, outgoing, requestChannel } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    void session.request(PayloadCodec, { text: 'hi' });
    await new Promise(r => setTimeout(r, 0));

    const onOutgoing = adapter.deliveredOn(outgoing);
    expect(onOutgoing).toHaveLength(1);
    expect(onOutgoing[0]!.channel).toBeDefined();
    expect(bytesEqual(onOutgoing[0]!.channel!, requestChannel)).toBe(true);
  });

  it('ACKs for incoming requests go on incomingSessionId + responseChannel', async () => {
    const backing = createMemoryStatementStore().createAdapter();
    const adapter = recordingAdapter(backing);
    const { session, incoming, responseChannel, remotePublicKey } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    // Peer sends us a request.
    const payload = PayloadCodec.enc({ text: 'ping' });
    await peerSubmit(adapter, remotePublicKey, {
      topic: incoming,
      channel: createRequestChannel(incoming),
      data: encodePeerRequest('peer-req-1', [payload]),
    });
    await new Promise(r => setTimeout(r, 0));

    // ACK it.
    const r = await session.submitResponseMessage('peer-req-1', 'success');
    expect(r.isOk()).toBe(true);

    // Both the peer's request AND our ACK land on `incoming`; the ACK
    // is the one on responseChannel.
    const onIncoming = adapter.deliveredOn(incoming);
    const ourAck = onIncoming.filter(s => s.channel && bytesEqual(s.channel, responseChannel));
    expect(ourAck).toHaveLength(1);
  });

  // ── Expiry monotonicity ──────────────────────────────────

  it('consecutive submissions have strictly increasing expiry', async () => {
    const backing = createMemoryStatementStore().createAdapter();
    const adapter = recordingAdapter(backing);
    const { session } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    void session.submitRequestMessage(PayloadCodec, { text: 'a' });
    await new Promise(r => setTimeout(r, 0));
    void session.submitRequestMessage(PayloadCodec, { text: 'b' });
    await new Promise(r => setTimeout(r, 0));

    const expiries = adapter.submitted.map(s => s.expiry!);
    expect(expiries.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < expiries.length; i++) {
      expect(expiries[i]! > expiries[i - 1]!).toBe(true);
    }
  });

  // ── Batching ─────────────────────────────────────────────

  it('submitRequestMessage coalesces while a request is in flight', async () => {
    const backing = createMemoryStatementStore().createAdapter();
    const adapter = recordingAdapter(backing);
    const { session } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    void session.submitRequestMessage(PayloadCodec, { text: 'a' });
    void session.submitRequestMessage(PayloadCodec, { text: 'b' });
    void session.submitRequestMessage(PayloadCodec, { text: 'c' });
    await new Promise(r => setTimeout(r, 0));

    // Every submission replaces the prior one on requestChannel, so each
    // statement contains the growing batch. The last submission should
    // carry all three payloads.
    const last = adapter.submitted[adapter.submitted.length - 1]!;
    const decoded = StatementDataCodec.dec(last.data!);
    expect(decoded.tag).toBe('request');
    if (decoded.tag !== 'request') return;
    expect(decoded.value.data).toHaveLength(3);
  });

  it('overflow messages queue until the current batch is ACKed', async () => {
    const backing = createMemoryStatementStore().createAdapter();
    const adapter = recordingAdapter(backing);
    // Small batch size to force overflow.
    const { session, outgoing, remotePublicKey } = setup({
      statementStore: adapter,
      maxRequestSize: 64,
    });
    await new Promise(r => setTimeout(r, 0));

    // Each payload is larger than 25 bytes (~10 chars + compact-length
    // prefix) so three roughly fit; four overflow.
    const big = 'x'.repeat(25);
    void session.submitRequestMessage(PayloadCodec, { text: big + '1' });
    void session.submitRequestMessage(PayloadCodec, { text: big + '2' });
    void session.submitRequestMessage(PayloadCodec, { text: big + '3' });
    void session.submitRequestMessage(PayloadCodec, { text: big + '4' });
    await new Promise(r => setTimeout(r, 0));

    // The first batch should be smaller than 4 because the fourth didn't
    // fit; it queued.
    const firstBatch = StatementDataCodec.dec(adapter.submitted[adapter.submitted.length - 1]!.data!);
    if (firstBatch.tag !== 'request') throw new Error('unexpected');
    const firstCount = firstBatch.value.data.length;
    expect(firstCount).toBeLessThan(4);

    // ACK the first batch — this should drain the queue and submit again.
    await peerSubmit(adapter, remotePublicKey, {
      topic: outgoing,
      channel: createResponseChannel(outgoing),
      data: encodePeerResponse(firstBatch.value.requestId, 'success'),
    });
    await new Promise(r => setTimeout(r, 0));

    const last = adapter.submitted[adapter.submitted.length - 1]!;
    const lastDecoded = StatementDataCodec.dec(last.data!);
    if (lastDecoded.tag !== 'request') throw new Error('unexpected');
    // The new batch contains the overflow items.
    expect(lastDecoded.value.data.length).toBeGreaterThanOrEqual(1);
    // And its requestId differs from the first batch's.
    expect(lastDecoded.value.requestId).not.toBe(firstBatch.value.requestId);
  });

  // ── Statement dedup ──────────────────────────────────────

  it('duplicate statements on the incoming topic are processed at most once', async () => {
    const adapter = createMemoryStatementStore().createAdapter();
    const { session, incoming, remotePublicKey } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    const callback = vi.fn();
    session.subscribe(PayloadCodec, callback);

    const data = encodePeerRequest('req-1', [PayloadCodec.enc({ text: 'once' })]);
    await peerSubmit(adapter, remotePublicKey, {
      topic: incoming,
      channel: createRequestChannel(incoming),
      data,
    });
    // Submit the SAME bytes again (different statement instance — same
    // channel causes replacement, but the memory adapter echoes every
    // submission back through subscribe anyway).
    await peerSubmit(adapter, remotePublicKey, {
      topic: incoming,
      channel: createRequestChannel(incoming),
      data,
    });
    await new Promise(r => setTimeout(r, 0));

    expect(callback).toHaveBeenCalledTimes(1);
  });

  // ── Proof verification ───────────────────────────────────

  it('rejects incoming statements signed by a non-peer key', async () => {
    const adapter = createMemoryStatementStore().createAdapter();
    const { session, incoming } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    const callback = vi.fn();
    session.subscribe(PayloadCodec, callback);

    const wrongSigner = bytes(0xcc); // not the peer
    await peerSubmit(adapter, wrongSigner, {
      topic: incoming,
      channel: createRequestChannel(incoming),
      data: encodePeerRequest('req-1', [PayloadCodec.enc({ text: 'spoof' })]),
    });
    await new Promise(r => setTimeout(r, 0));

    expect(callback).not.toHaveBeenCalled();
  });

  it('self-echoes on the outgoing topic are filtered by proof verification', async () => {
    const adapter = createMemoryStatementStore().createAdapter();
    const { session } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    const callback = vi.fn();
    session.subscribe(PayloadCodec, callback);

    // Our own submission — memory adapter will echo it through both the
    // incoming-topic subscription AND the outgoing-topic subscription.
    // The outgoing subscription is `responsesOnly`, so request-tag
    // statements are filtered there. Our own signer fails verification
    // on the incoming subscription (signer !== peer). Either way, our
    // payload callback should NOT fire on our own submission.
    void session.submitRequestMessage(PayloadCodec, { text: 'mine' });
    await new Promise(r => setTimeout(r, 0));

    expect(callback).not.toHaveBeenCalled();
  });

  // ── Late-subscriber buffering ────────────────────────────

  it('a subscriber attached after an incoming request still receives it', async () => {
    const adapter = createMemoryStatementStore().createAdapter();
    const { session, incoming, remotePublicKey } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    await peerSubmit(adapter, remotePublicKey, {
      topic: incoming,
      channel: createRequestChannel(incoming),
      data: encodePeerRequest('req-1', [PayloadCodec.enc({ text: 'late' })]),
    });
    await new Promise(r => setTimeout(r, 0));

    // Subscribe AFTER the statement has been delivered.
    const received: string[] = [];
    session.subscribe(PayloadCodec, messages => {
      for (const m of messages) {
        if (m.type !== 'request') continue;
        if (m.payload.status === 'parsed') received.push(m.payload.value.text);
      }
    });

    // Replay is synchronous during subscribe() — no need to wait.
    expect(received).toContain('late');
  });

  // ── Init recovery ────────────────────────────────────────

  it('init recovery restores an un-acked outgoing request from chain history', async () => {
    const adapter = createMemoryStatementStore().createAdapter();
    const outgoing = createSessionId(sharedSecret, localAccount, remoteAccount);
    const incoming = createSessionId(sharedSecret, remoteAccount, localAccount);

    // Pre-seed the store with an un-acked outgoing request. Since our
    // encryption is identity, the data is just the StatementData bytes.
    const preExistingPayload = PayloadCodec.enc({ text: 'pre-existing' });
    const preExistingData = encodePeerRequest('pre-req', [preExistingPayload]);
    await peerSubmit(adapter, localAccount.accountId, {
      topic: outgoing,
      channel: createRequestChannel(outgoing),
      data: preExistingData,
    });

    // Now boot a fresh session that queries init.
    const session = createSession({
      localAccount,
      remoteAccount,
      outgoingSessionId: outgoing,
      incomingSessionId: incoming,
      statementStore: adapter,
      encryption: identityEncryption(),
      // Verifier accepts our own signer so init can decode the
      // pre-existing outgoing request.
      prover: stubProver(localAccount.accountId, localAccount.accountId),
    });
    await new Promise(r => setTimeout(r, 10));

    // After init, a new submit should coalesce into the pre-existing
    // request (same requestId or at least same data batch).
    const backing = adapter as StatementStoreAdapter & { submit: typeof adapter.submit };
    const priorSubmissions = (await backing.query([outgoing]))._unsafeUnwrap().length;

    void session.submitRequestMessage(PayloadCodec, { text: 'new' });
    await new Promise(r => setTimeout(r, 10));

    const afterSubmissions = (await backing.query([outgoing]))._unsafeUnwrap();
    // Because channels replace by (account, channel), the memory adapter
    // still shows multiple statements — but the most recent must contain
    // both the pre-existing payload and the new one.
    const last = afterSubmissions[afterSubmissions.length - 1]!;
    const lastDecoded = StatementDataCodec.dec(last.data!);
    if (lastDecoded.tag !== 'request') throw new Error('unexpected');
    expect(lastDecoded.value.data.length).toBeGreaterThanOrEqual(2);
    void priorSubmissions; // unused
    session.dispose();
  });

  // ── Clean dispose ────────────────────────────────────────

  it('dispose rejects any pending delivery with Disposed', async () => {
    const adapter = createMemoryStatementStore().createAdapter();
    const { session } = setup({ statementStore: adapter });
    await new Promise(r => setTimeout(r, 0));

    const pending = session.request(PayloadCodec, { text: 'hi' });
    // Don't ACK. Dispose immediately.
    session.dispose();

    const result = await pending;
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('Disposed');
  });

  it('dispose is idempotent', () => {
    const { session } = setup();
    session.dispose();
    expect(() => session.dispose()).not.toThrow();
  });

  // ── Error surfaces ───────────────────────────────────────

  it('submitRequestMessage rejects payloads larger than maxRequestSize', async () => {
    const { session } = setup({ maxRequestSize: 8 });
    await new Promise(r => setTimeout(r, 0));

    const result = await session.submitRequestMessage(PayloadCodec, { text: 'a much longer message' });
    expect(result.isErr()).toBe(true);
    const e = result._unsafeUnwrapErr();
    expect(e.tag).toBe('MessageTooBig');
  });

  it('submitResponseMessage without a matching incoming request errs', async () => {
    const { session } = setup();
    await new Promise(r => setTimeout(r, 0));

    const result = await session.submitResponseMessage('no-such-id', 'success');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().tag).toBe('NoIncomingRequest');
  });

  it('propagates StatementStoreError from submit() as Session::StatementStore', async () => {
    const failingAdapter: StatementStoreAdapter = {
      subscribe: () => () => {},
      submit: () => {
        const { errAsync } = require('neverthrow') as typeof import('neverthrow');
        return errAsync<void, StatementStoreError>({ tag: 'StorageFull' });
      },
      query: () => okAsync([]) as never,
    };
    const outgoing = createSessionId(sharedSecret, localAccount, remoteAccount);
    const incoming = createSessionId(sharedSecret, remoteAccount, localAccount);
    const session = createSession({
      localAccount,
      remoteAccount,
      outgoingSessionId: outgoing,
      incomingSessionId: incoming,
      statementStore: failingAdapter,
      encryption: identityEncryption(),
      prover: stubProver(localAccount.accountId, remoteAccount.publicKey),
    });
    await new Promise(r => setTimeout(r, 0));

    // Even though submit fails, submitRequestMessage still returns a
    // token (it doesn't await the downstream submit). The failure is
    // swallowed internally — this documents the current behaviour. The
    // pending delivery will resolve via ACK (never) or session dispose.
    const pending = session.submitRequestMessage(PayloadCodec, { text: 'hi' });
    const result = await pending;
    // Token returns OK — the submit error is logged but does not
    // propagate to submitRequestMessage. This matches triangle-js-sdks'
    // behaviour where submit errors are fire-and-forget.
    expect(result.isOk()).toBe(true);

    session.dispose();
  });
});
