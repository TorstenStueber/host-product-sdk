import { describe, it, expect } from 'vitest';
import { encodeStatement, decodeStatement } from './codec.js';
import type { Statement, SignedStatement } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}

// ---------------------------------------------------------------------------
// Round-trip: encode then decode should produce the same statement
// ---------------------------------------------------------------------------

describe('statementCodec', () => {
  describe('round-trip', () => {
    it('empty statement', () => {
      const stmt: Statement = {};
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded).toEqual({});
    });

    it('statement with only data', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const stmt: Statement = { data };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.data).toEqual(data);
    });

    it('statement with all fields', () => {
      const stmt: Statement = {
        proof: {
          tag: 'sr25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
        decryptionKey: randomBytes(32),
        expiry: (BigInt(1700000000) << 32n) | 42n,
        channel: randomBytes(32),
        topics: [randomBytes(32), randomBytes(32), randomBytes(32)],
        data: randomBytes(100),
      };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded).toEqual(stmt);
    });

    it('sr25519 proof', () => {
      const stmt: Statement = {
        proof: {
          tag: 'sr25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
      };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('ed25519 proof', () => {
      const stmt: Statement = {
        proof: {
          tag: 'ed25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
      };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('ecdsa proof', () => {
      const stmt: Statement = {
        proof: {
          tag: 'ecdsa',
          value: { signature: randomBytes(65), signer: randomBytes(33) },
        },
      };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('1 topic', () => {
      const stmt: Statement = { topics: [randomBytes(32)] };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.topics).toEqual(stmt.topics);
    });

    it('4 topics (maximum)', () => {
      const stmt: Statement = {
        topics: [randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32)],
      };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.topics).toEqual(stmt.topics);
    });

    it('expiry zero', () => {
      const stmt: Statement = { expiry: 0n };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.expiry).toBe(0n);
    });

    it('expiry max u64', () => {
      const stmt: Statement = { expiry: 0xffffffffffffffffn };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.expiry).toBe(0xffffffffffffffffn);
    });

    it('large data payload', () => {
      const data = randomBytes(10_000);
      const stmt: Statement = { data };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.data).toEqual(data);
    });

    it('channel without topics', () => {
      const stmt: Statement = { channel: randomBytes(32) };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.channel).toEqual(stmt.channel);
    });

    it('proof + topics + data (typical SSO statement)', () => {
      const stmt: SignedStatement = {
        proof: {
          tag: 'sr25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
        topics: [randomBytes(32)],
        data: randomBytes(256),
        expiry: (BigInt(Math.floor(Date.now() / 1000) + 604800) << 32n) | 1n,
      };
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded).toEqual(stmt);
    });
  });

  // ---------------------------------------------------------------------------
  // Encoding details
  // ---------------------------------------------------------------------------

  describe('encoding', () => {
    it('empty statement encodes as single-byte compact(0)', () => {
      const encoded = encodeStatement({});
      // compact(0) = 0x00
      expect(encoded).toEqual(new Uint8Array([0x00]));
    });

    it('field variant indices are correct', () => {
      // A statement with only expiry=0 should encode as:
      // compact(1) = 0x04, field_index=2 (expiry), then 8 zero bytes
      const encoded = encodeStatement({ expiry: 0n });
      expect(encoded[0]).toBe(0x04); // compact(1)
      expect(encoded[1]).toBe(2); // FIELD_EXPIRY index
    });

    it('topics expand to sequential indices 4,5,6,7', () => {
      const topic = zeros(32);
      const encoded = encodeStatement({ topics: [topic, topic] });
      expect(encoded[0]).toBe(0x08); // compact(2) = two fields
      expect(encoded[1]).toBe(4); // topic1
      expect(encoded[1 + 1 + 32]).toBe(5); // topic2
    });

    it('proof variant index for sr25519 is 0', () => {
      const stmt: Statement = {
        proof: { tag: 'sr25519', value: { signature: zeros(64), signer: zeros(32) } },
      };
      const encoded = encodeStatement(stmt);
      expect(encoded[1]).toBe(0); // FIELD_PROOF
      expect(encoded[2]).toBe(0); // sr25519 proof type index
    });

    it('proof variant index for ed25519 is 1', () => {
      const stmt: Statement = {
        proof: { tag: 'ed25519', value: { signature: zeros(64), signer: zeros(32) } },
      };
      const encoded = encodeStatement(stmt);
      expect(encoded[2]).toBe(1);
    });

    it('proof variant index for ecdsa is 2', () => {
      const stmt: Statement = {
        proof: { tag: 'ecdsa', value: { signature: zeros(65), signer: zeros(33) } },
      };
      const encoded = encodeStatement(stmt);
      expect(encoded[2]).toBe(2);
    });

    it('data uses compact length prefix', () => {
      const data = new Uint8Array([0xaa, 0xbb, 0xcc]);
      const encoded = encodeStatement({ data });
      // compact(1) + field_index(8) + compact(3) + data
      expect(encoded[0]).toBe(0x04); // compact(1)
      expect(encoded[1]).toBe(8); // FIELD_DATA
      expect(encoded[2]).toBe(0x0c); // compact(3) = 3 << 2 = 12
      expect(encoded[3]).toBe(0xaa);
      expect(encoded[4]).toBe(0xbb);
      expect(encoded[5]).toBe(0xcc);
    });

    it('compact encoding for data length 100', () => {
      const data = randomBytes(100);
      const encoded = encodeStatement({ data });
      // compact(100) = (100 << 2) | 1 = 0x191 → two bytes LE: 0x91, 0x01
      expect(encoded[2]).toBe(0x91);
      expect(encoded[3]).toBe(0x01);
    });
  });

  // ---------------------------------------------------------------------------
  // Decoding errors
  // ---------------------------------------------------------------------------

  describe('decode errors', () => {
    it('throws on fields out of order', () => {
      // Manually craft: compact(2), field_index=8 (data), field_index=2 (expiry)
      // This violates the ascending-order constraint
      const bad = new Uint8Array([
        0x08, // compact(2)
        8,
        0x00, // field_index=data, compact(0) data length
        2,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0, // field_index=expiry, u64=0
      ]);
      expect(() => decodeStatement(bad)).toThrow(/ascending order/i);
    });

    it('throws on unknown field index', () => {
      const bad = new Uint8Array([0x04, 99]); // compact(1), unknown index 99
      expect(() => decodeStatement(bad)).toThrow(/unknown/i);
    });

    it('throws on unknown proof type', () => {
      // compact(1), field_index=0 (proof), proof_type=3 (onChain — not supported)
      const bad = new Uint8Array([0x04, 0, 3, ...zeros(72)]); // 72 = who(32) + blockHash(32) + event(8)
      expect(() => decodeStatement(bad)).toThrow(/proof type/i);
    });

    it('throws on topic gap (topic1 then topic3)', () => {
      const bad = new Uint8Array([
        0x08, // compact(2)
        4,
        ...zeros(32), // topic1
        6,
        ...zeros(32), // topic3 (skipped topic2)
      ]);
      expect(() => decodeStatement(bad)).toThrow(/topic/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  describe('validation', () => {
    it('throws when encoding more than 4 topics', () => {
      const stmt: Statement = {
        topics: [randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32)],
      };
      expect(() => encodeStatement(stmt)).toThrow(/4 topics/i);
    });
  });
});
