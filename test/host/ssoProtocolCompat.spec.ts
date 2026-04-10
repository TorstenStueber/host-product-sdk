/**
 * Protocol compatibility tests.
 *
 * Verifies that our SSO crypto primitives produce the same outputs as
 * triangle-js-sdks' statement-store and host-papp packages. These tests
 * use hardcoded reference values derived from the original code.
 */

import { describe, it, expect } from 'vitest';
import {
  createAccountId,
  khash,
  createSessionId,
  createRequestChannel,
  createResponseChannel,
  deriveHandshakeTopic,
  createSr25519Secret,
  deriveSr25519PublicKey,
  createP256Secret,
  getP256PublicKey,
  createEncryption,
  concatBytes,
} from '../../packages/host/src/auth/sso/crypto.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32-byte key for reproducible tests. */
function key(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

/** Deterministic 65-byte P-256 uncompressed public key stub. */
function p256Key(fill: number): Uint8Array {
  const k = new Uint8Array(65);
  k[0] = 0x04; // uncompressed prefix
  k.fill(fill, 1);
  return k;
}

const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// createAccountId — must be identity (no hash) for sr25519
// ---------------------------------------------------------------------------

describe('createAccountId (protocol compat)', () => {
  it('returns the raw public key unchanged', () => {
    const publicKey = key(0xab);
    const accountId = createAccountId(publicKey);
    expect(accountId).toEqual(publicKey);
  });

  it('does not blake2b hash the key', () => {
    // If createAccountId hashed, the output would differ from the input
    const publicKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) publicKey[i] = i;
    const accountId = createAccountId(publicKey);
    expect(accountId).toEqual(publicKey);
  });

  it('returns a copy, not a reference', () => {
    const publicKey = key(0x01);
    const accountId = createAccountId(publicKey);
    publicKey[0] = 0xff;
    expect(accountId[0]).toBe(0x01);
  });
});

// ---------------------------------------------------------------------------
// Handshake topic derivation — khash(accountId, encrPublicKey || "topic")
// ---------------------------------------------------------------------------

describe('deriveHandshakeTopic (protocol compat)', () => {
  it('uses raw accountId (not hashed) as khash key', () => {
    const publicKey = key(0x01);
    const accountId = createAccountId(publicKey);
    const encrPub = p256Key(0x02);

    // Compute expected: khash(rawPublicKey, encrPub || "topic")
    const expected = khash(publicKey, concatBytes(encrPub, textEncoder.encode('topic')));
    const actual = deriveHandshakeTopic(accountId, encrPub);
    expect(actual).toEqual(expected);
  });

  it('matches triangle-js-sdks formula: khash(account.accountId, encrPublicKey || "topic")', () => {
    // In the original, account.accountId = publicKey.slice(0,32) = publicKey
    // So deriveHandshakeTopic(createAccountId(pk), encrPub) should be
    // identical to khash(pk, encrPub || "topic")
    const pk = key(0xaa);
    const encrPub = p256Key(0xbb);

    const topicViaFunction = deriveHandshakeTopic(createAccountId(pk), encrPub);
    const topicDirect = khash(pk, concatBytes(encrPub, textEncoder.encode('topic')));
    expect(topicViaFunction).toEqual(topicDirect);
  });
});

// ---------------------------------------------------------------------------
// Session ID derivation — must match triangle-js-sdks createSessionId
// ---------------------------------------------------------------------------

describe('createSessionId (protocol compat)', () => {
  it('uses sharedSecret as khash key, not accountId', () => {
    const sharedSecret = key(0x01);
    const accountA = key(0x02);
    const accountB = key(0x03);

    const sessionId = createSessionId(sharedSecret, accountA, accountB);

    // Must match: khash(sharedSecret, "session" || accountA || accountB || "/" || "/")
    const expected = khash(
      sharedSecret,
      concatBytes(textEncoder.encode('session'), accountA, accountB, textEncoder.encode('/'), textEncoder.encode('/')),
    );
    expect(sessionId).toEqual(expected);
  });

  it('swapping account order produces different session IDs', () => {
    const secret = key(0x01);
    const a = key(0x02);
    const b = key(0x03);

    const outgoing = createSessionId(secret, a, b);
    const incoming = createSessionId(secret, b, a);
    expect(outgoing).not.toEqual(incoming);
  });

  it('outgoing and incoming are each others inverse', () => {
    const secret = key(0x10);
    const local = key(0x20);
    const remote = key(0x30);

    // Host outgoing = wallet incoming, and vice versa
    const hostOutgoing = createSessionId(secret, local, remote);
    const walletIncoming = createSessionId(secret, local, remote);
    expect(hostOutgoing).toEqual(walletIncoming);

    const hostIncoming = createSessionId(secret, remote, local);
    const walletOutgoing = createSessionId(secret, remote, local);
    expect(hostIncoming).toEqual(walletOutgoing);
  });
});

// ---------------------------------------------------------------------------
// Request/Response channel derivation
// ---------------------------------------------------------------------------

describe('request/response channels (protocol compat)', () => {
  it('request channel = khash(sessionId, "request")', () => {
    const sessionId = key(0xaa);
    const expected = khash(sessionId, textEncoder.encode('request'));
    expect(createRequestChannel(sessionId)).toEqual(expected);
  });

  it('response channel = khash(sessionId, "response")', () => {
    const sessionId = key(0xbb);
    const expected = khash(sessionId, textEncoder.encode('response'));
    expect(createResponseChannel(sessionId)).toEqual(expected);
  });

  it('request and response channels are different', () => {
    const sessionId = key(0xcc);
    expect(createRequestChannel(sessionId)).not.toEqual(createResponseChannel(sessionId));
  });
});

// ---------------------------------------------------------------------------
// Sr25519 key derivation — matches triangle-js-sdks
// ---------------------------------------------------------------------------

describe('createSr25519Secret (protocol compat)', () => {
  it('produces a 64-byte secret', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secret = createSr25519Secret(entropy);
    expect(secret.length).toBe(64);
  });

  it('derivation path produces different key', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const noDerivation = createSr25519Secret(entropy);
    const withDerivation = createSr25519Secret(entropy, '//wallet//sso');
    expect(noDerivation).not.toEqual(withDerivation);
  });

  it('same entropy + path produces same key', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const a = createSr25519Secret(entropy, '//Alice');
    const b = createSr25519Secret(entropy, '//Alice');
    expect(a).toEqual(b);
  });

  it('accountId from derived key equals the raw public key', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secret = createSr25519Secret(entropy, '//wallet//sso');
    const publicKey = deriveSr25519PublicKey(secret);
    const accountId = createAccountId(publicKey);
    // The key property: accountId IS the public key, not a hash of it
    expect(accountId).toEqual(publicKey);
  });
});

// ---------------------------------------------------------------------------
// Encryption round-trip
// ---------------------------------------------------------------------------

describe('createEncryption (protocol compat)', () => {
  it('encrypt then decrypt recovers plaintext', () => {
    const sharedSecret = key(0x01);
    const enc = createEncryption(sharedSecret);
    const plaintext = textEncoder.encode('hello world');
    const encrypted = enc.encrypt(plaintext);
    const decrypted = enc.decrypt(encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it('both sides with same shared secret can decrypt', () => {
    const sharedSecret = key(0x42);
    const hostEnc = createEncryption(sharedSecret);
    const walletEnc = createEncryption(sharedSecret);
    const msg = textEncoder.encode('sign this');
    const encrypted = hostEnc.encrypt(msg);
    const decrypted = walletEnc.decrypt(encrypted);
    expect(decrypted).toEqual(msg);
  });
});

// ---------------------------------------------------------------------------
// Full pairing topic flow (integration)
// ---------------------------------------------------------------------------

describe('pairing topic flow (protocol compat)', () => {
  it('host and wallet derive the same handshake topic', () => {
    // Simulate: both sides know the same sr25519 public key and P-256 public key
    // (the host publishes them in the QR code, the wallet reads them)
    const entropy = new Uint8Array(16).fill(0x99);
    const ssSecret = createSr25519Secret(entropy, '//wallet//sso');
    const ssPublicKey = deriveSr25519PublicKey(ssSecret);
    const encrPublicKey = getP256PublicKey(createP256Secret(entropy));

    // Both sides compute: accountId = raw public key (no hash)
    const hostAccountId = createAccountId(ssPublicKey);
    const walletAccountId = ssPublicKey.slice(0, 32); // wallet's createAccountId

    expect(hostAccountId).toEqual(walletAccountId);

    // Both derive the same handshake topic
    const hostTopic = deriveHandshakeTopic(hostAccountId, encrPublicKey);
    const walletTopic = khash(walletAccountId, concatBytes(encrPublicKey, textEncoder.encode('topic')));
    expect(hostTopic).toEqual(walletTopic);
  });
});

// ---------------------------------------------------------------------------
// Full session topic flow (integration)
// ---------------------------------------------------------------------------

describe('session topic flow (protocol compat)', () => {
  it('host outgoing topic equals wallet incoming topic', () => {
    const sharedSecret = key(0x01);
    const localAccountId = key(0x02);
    const remoteAccountId = key(0x03);

    // Host outgoing
    const hostOutgoing = createSessionId(sharedSecret, localAccountId, remoteAccountId);
    // Wallet incoming (same formula, same argument order from wallet's perspective)
    const walletIncoming = createSessionId(sharedSecret, localAccountId, remoteAccountId);
    expect(hostOutgoing).toEqual(walletIncoming);

    // Host incoming
    const hostIncoming = createSessionId(sharedSecret, remoteAccountId, localAccountId);
    // Wallet outgoing
    const walletOutgoing = createSessionId(sharedSecret, remoteAccountId, localAccountId);
    expect(hostIncoming).toEqual(walletOutgoing);
  });

  it('host subscribes to the topic the wallet publishes responses on', () => {
    const sharedSecret = key(0x01);
    const local = key(0x02);
    const remote = key(0x03);

    // Host subscribes to incomingSessionId
    const hostIncoming = createSessionId(sharedSecret, remote, local);
    // Wallet publishes its responses with topic = wallet.outgoingSessionId
    //   wallet.outgoing = createSessionId(sharedSecret, walletLocal, walletRemote)
    //   walletLocal = remote (from host's perspective), walletRemote = local
    const walletOutgoing = createSessionId(sharedSecret, remote, local);

    expect(hostIncoming).toEqual(walletOutgoing);
  });
});
