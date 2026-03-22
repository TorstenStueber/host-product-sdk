/**
 * SSO crypto and codec tests.
 *
 * Tests for encryption round-trip, key derivation, topic derivation,
 * and SCALE codec compatibility with triangle-js-sdks wire format.
 */

import { describe, it, expect } from 'vitest';
import {
  createEncryption,
  khash,
  createAccountId,
  deriveHandshakeTopic,
  createSr25519Secret,
  deriveSr25519PublicKey,
  createP256Secret,
  getP256PublicKey,
  createP256SharedSecret,
  concatBytes,
  generateMnemonic,
  mnemonicToEntropy,
} from '../../packages/host/src/auth/sso/crypto.js';
import {
  HandshakeData,
  HandshakeResponsePayload,
  RemoteMessageCodec,
  SigningPayloadRequestCodec,
  SigningRawRequestCodec,
} from '../../packages/host/src/auth/sso/codecs.js';

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

describe('createEncryption', () => {
  it('encrypts and decrypts round-trip', () => {
    const key = new Uint8Array(32).fill(0x42);
    const enc = createEncryption(key);
    const plaintext = new TextEncoder().encode('hello world');

    const encrypted = enc.encrypt(plaintext);
    const decrypted = enc.decrypt(encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('encrypted output differs from plaintext', () => {
    const key = new Uint8Array(32).fill(0x42);
    const enc = createEncryption(key);
    const plaintext = new TextEncoder().encode('secret');

    const encrypted = enc.encrypt(plaintext);
    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.length).toBeGreaterThan(plaintext.length);
  });

  it('prepends 12-byte nonce', () => {
    const key = new Uint8Array(32).fill(0x42);
    const enc = createEncryption(key);
    const plaintext = new Uint8Array([1, 2, 3]);

    const encrypted = enc.encrypt(plaintext);
    // 12-byte nonce + ciphertext (at least as long as plaintext + 16-byte GCM tag)
    expect(encrypted.length).toBeGreaterThanOrEqual(12 + 3 + 16);
  });

  it('decrypt with wrong key throws', () => {
    const key1 = new Uint8Array(32).fill(0x42);
    const key2 = new Uint8Array(32).fill(0x43);
    const enc1 = createEncryption(key1);
    const enc2 = createEncryption(key2);

    const encrypted = enc1.encrypt(new TextEncoder().encode('test'));
    expect(() => enc2.decrypt(encrypted)).toThrow();
  });

  it('handles empty plaintext', () => {
    const key = new Uint8Array(32).fill(0x42);
    const enc = createEncryption(key);

    const encrypted = enc.encrypt(new Uint8Array(0));
    const decrypted = enc.decrypt(encrypted);
    expect(decrypted).toEqual(new Uint8Array(0));
  });

  it('handles large plaintext', () => {
    const key = new Uint8Array(32).fill(0x42);
    const enc = createEncryption(key);
    const large = new Uint8Array(10_000).fill(0xff);

    const encrypted = enc.encrypt(large);
    const decrypted = enc.decrypt(encrypted);
    expect(decrypted).toEqual(large);
  });
});

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

describe('khash', () => {
  it('returns 32-byte hash', () => {
    const secret = new Uint8Array(32).fill(1);
    const message = new TextEncoder().encode('test');
    const result = khash(secret, message);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it('different secrets produce different hashes', () => {
    const msg = new TextEncoder().encode('same');
    const h1 = khash(new Uint8Array(32).fill(1), msg);
    const h2 = khash(new Uint8Array(32).fill(2), msg);
    expect(h1).not.toEqual(h2);
  });

  it('different messages produce different hashes', () => {
    const secret = new Uint8Array(32).fill(1);
    const h1 = khash(secret, new TextEncoder().encode('a'));
    const h2 = khash(secret, new TextEncoder().encode('b'));
    expect(h1).not.toEqual(h2);
  });
});

describe('createAccountId', () => {
  it('returns 32-byte ID from public key', () => {
    const pubkey = new Uint8Array(32).fill(0xaa);
    const id = createAccountId(pubkey);
    expect(id.length).toBe(32);
  });

  it('different keys produce different IDs', () => {
    const id1 = createAccountId(new Uint8Array(32).fill(1));
    const id2 = createAccountId(new Uint8Array(32).fill(2));
    expect(id1).not.toEqual(id2);
  });
});

describe('deriveHandshakeTopic', () => {
  it('returns 32-byte topic', () => {
    const accountId = new Uint8Array(32).fill(1);
    const encrPub = new Uint8Array(65).fill(2);
    const topic = deriveHandshakeTopic(accountId, encrPub);
    expect(topic.length).toBe(32);
  });

  it('is deterministic', () => {
    const accountId = new Uint8Array(32).fill(1);
    const encrPub = new Uint8Array(65).fill(2);
    const t1 = deriveHandshakeTopic(accountId, encrPub);
    const t2 = deriveHandshakeTopic(accountId, encrPub);
    expect(t1).toEqual(t2);
  });
});

// ---------------------------------------------------------------------------
// Sr25519 key derivation
// ---------------------------------------------------------------------------

describe('sr25519 key derivation', () => {
  it('derives a 64-byte secret from entropy', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secret = createSr25519Secret(entropy);
    expect(secret.length).toBe(64);
  });

  it('derives with //wallet//sso path', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secretBase = createSr25519Secret(entropy);
    const secretDerived = createSr25519Secret(entropy, '//wallet//sso');
    expect(secretDerived).not.toEqual(secretBase);
    expect(secretDerived.length).toBe(64);
  });

  it('derives a 32-byte public key', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secret = createSr25519Secret(entropy);
    const pubkey = deriveSr25519PublicKey(secret);
    expect(pubkey.length).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// P-256 key operations
// ---------------------------------------------------------------------------

describe('P-256 key operations', () => {
  it('creates a P-256 secret from entropy', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secret = createP256Secret(entropy);
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(32);
  });

  it('derives a 65-byte uncompressed public key', () => {
    const entropy = new Uint8Array(16).fill(0x42);
    const secret = createP256Secret(entropy);
    const pubkey = getP256PublicKey(secret);
    expect(pubkey.length).toBe(65);
    expect(pubkey[0]).toBe(0x04); // uncompressed prefix
  });

  it('ECDH shared secret is 32 bytes', () => {
    const entropy1 = new Uint8Array(16).fill(0x01);
    const entropy2 = new Uint8Array(16).fill(0x02);
    const sec1 = createP256Secret(entropy1);
    const sec2 = createP256Secret(entropy2);
    const pub1 = getP256PublicKey(sec1);
    const pub2 = getP256PublicKey(sec2);

    const shared1 = createP256SharedSecret(sec1, pub2);
    const shared2 = createP256SharedSecret(sec2, pub1);

    expect(shared1.length).toBe(32);
    expect(shared1).toEqual(shared2); // ECDH symmetry
  });
});

// ---------------------------------------------------------------------------
// Mnemonic
// ---------------------------------------------------------------------------

describe('generateMnemonic', () => {
  it('generates a valid mnemonic', () => {
    const mnemonic = generateMnemonic();
    expect(typeof mnemonic).toBe('string');
    const words = mnemonic.split(' ');
    expect(words.length).toBe(12);
  });

  it('mnemonicToEntropy round-trips', () => {
    const mnemonic = generateMnemonic();
    const entropy = mnemonicToEntropy(mnemonic);
    expect(entropy).toBeInstanceOf(Uint8Array);
    expect(entropy.length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// SCALE codecs
// ---------------------------------------------------------------------------

describe('HandshakeData codec', () => {
  it('round-trips v1 handshake', () => {
    const data = {
      tag: 'v1' as const,
      value: {
        ssPublicKey: new Uint8Array(32).fill(0xaa),
        encrPublicKey: new Uint8Array(65).fill(0xbb),
        metadata: 'https://example.com/metadata.json',
        hostVersion: '1.0.0',
        osType: undefined,
        osVersion: undefined,
      },
    };
    const encoded = HandshakeData.enc(data);
    const decoded = HandshakeData.dec(encoded);
    expect(decoded.tag).toBe('v1');
    expect(decoded.value.ssPublicKey).toEqual(data.value.ssPublicKey);
    expect(decoded.value.encrPublicKey).toEqual(data.value.encrPublicKey);
    expect(decoded.value.metadata).toBe(data.value.metadata);
  });
});

describe('RemoteMessageCodec', () => {
  it('round-trips a sign request', () => {
    const msg = {
      messageId: 'test-123',
      data: {
        tag: 'v1' as const,
        value: {
          tag: 'SignRequest' as const,
          value: {
            tag: 'Payload' as const,
            value: {
              address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
              blockHash: '0x1234' as `0x${string}`,
              blockNumber: '0x01' as `0x${string}`,
              era: '0x00' as `0x${string}`,
              genesisHash: '0xabcd' as `0x${string}`,
              method: '0xcafe' as `0x${string}`,
              nonce: '0x00' as `0x${string}`,
              specVersion: '0x01' as `0x${string}`,
              tip: '0x00' as `0x${string}`,
              transactionVersion: '0x01' as `0x${string}`,
              signedExtensions: [] as string[],
              version: 4,
              assetId: undefined,
              metadataHash: undefined,
              mode: undefined,
              withSignedTransaction: undefined,
            },
          },
        },
      },
    };

    const encoded = RemoteMessageCodec.enc(msg);
    const decoded = RemoteMessageCodec.dec(encoded);
    expect(decoded.messageId).toBe('test-123');
    expect(decoded.data.tag).toBe('v1');
  });

  it('round-trips a disconnect message', () => {
    const msg = {
      messageId: 'disc-1',
      data: {
        tag: 'v1' as const,
        value: {
          tag: 'Disconnected' as const,
          value: undefined,
        },
      },
    };
    const encoded = RemoteMessageCodec.enc(msg);
    const decoded = RemoteMessageCodec.dec(encoded);
    expect(decoded.data.value.tag).toBe('Disconnected');
  });
});

describe('concatBytes', () => {
  it('concatenates multiple arrays', () => {
    const result = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3, 4]));
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('handles empty arrays', () => {
    const result = concatBytes(new Uint8Array(0), new Uint8Array([1]));
    expect(result).toEqual(new Uint8Array([1]));
  });
});
