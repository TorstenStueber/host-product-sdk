import { describe, it, expect } from 'vitest';
import { encodeStatement, decodeStatement } from './codec.js';
import type { Statement } from './types.js';

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

/**
 * Build a fully-specified Statement from a partial. The SCALE-derived
 * Statement type requires every field to be present (even if undefined),
 * so this helper fills in the blanks for terse test literals.
 */
function buildStmt(overrides: Partial<Statement> = {}): Statement {
  return {
    proof: undefined,
    decryptionKey: undefined,
    expiry: undefined,
    channel: undefined,
    topics: [],
    data: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Round-trip: encode then decode should produce the same statement
// ---------------------------------------------------------------------------

describe('statementCodec', () => {
  describe('round-trip', () => {
    it('empty statement', () => {
      const stmt = buildStmt();
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded).toEqual(stmt);
    });

    it('statement with only data', () => {
      const stmt = buildStmt({ data: new Uint8Array([1, 2, 3, 4, 5]) });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.data).toEqual(stmt.data);
    });

    it('statement with all fields', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'Sr25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
        decryptionKey: randomBytes(32),
        expiry: (BigInt(1700000000) << 32n) | 42n,
        channel: randomBytes(32),
        topics: [randomBytes(32), randomBytes(32), randomBytes(32)],
        data: randomBytes(100),
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded).toEqual(stmt);
    });

    it('Sr25519 proof', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'Sr25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('Ed25519 proof', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'Ed25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('Ecdsa proof', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'Ecdsa',
          value: { signature: randomBytes(65), signer: randomBytes(33) },
        },
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('OnChain proof', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'OnChain',
          value: { who: randomBytes(32), blockHash: randomBytes(32), event: 0xdeadbeefn },
        },
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('OnChain proof with max u64 event index', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'OnChain',
          value: { who: zeros(32), blockHash: zeros(32), event: 0xffffffffffffffffn },
        },
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.proof).toEqual(stmt.proof);
    });

    it('1 topic', () => {
      const stmt = buildStmt({ topics: [randomBytes(32)] });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.topics).toEqual(stmt.topics);
    });

    it('4 topics (maximum)', () => {
      const stmt = buildStmt({
        topics: [randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32)],
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.topics).toEqual(stmt.topics);
    });

    it('expiry zero', () => {
      const stmt = buildStmt({ expiry: 0n });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.expiry).toBe(0n);
    });

    it('expiry max u64', () => {
      const stmt = buildStmt({ expiry: 0xffffffffffffffffn });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.expiry).toBe(0xffffffffffffffffn);
    });

    it('large data payload', () => {
      const stmt = buildStmt({ data: randomBytes(10_000) });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.data).toEqual(stmt.data);
    });

    it('channel without topics', () => {
      const stmt = buildStmt({ channel: randomBytes(32) });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded.channel).toEqual(stmt.channel);
    });

    it('proof + topics + data (typical SSO statement)', () => {
      const stmt = buildStmt({
        proof: {
          tag: 'Sr25519',
          value: { signature: randomBytes(64), signer: randomBytes(32) },
        },
        topics: [randomBytes(32)],
        data: randomBytes(256),
        expiry: (BigInt(Math.floor(Date.now() / 1000) + 604800) << 32n) | 1n,
      });
      const decoded = decodeStatement(encodeStatement(stmt));
      expect(decoded).toEqual(stmt);
    });
  });

  // ---------------------------------------------------------------------------
  // Encoding details
  // ---------------------------------------------------------------------------

  describe('encoding', () => {
    it('empty statement encodes as single-byte compact(0)', () => {
      const encoded = encodeStatement(buildStmt());
      // compact(0) = 0x00
      expect(encoded).toEqual(new Uint8Array([0x00]));
    });

    it('field variant indices are correct', () => {
      // A statement with only expiry=0 should encode as:
      // compact(1) = 0x04, field_index=2 (expiry), then 8 zero bytes
      const encoded = encodeStatement(buildStmt({ expiry: 0n }));
      expect(encoded[0]).toBe(0x04); // compact(1)
      expect(encoded[1]).toBe(2); // FIELD_EXPIRY index
    });

    it('topics expand to sequential indices 4,5,6,7', () => {
      const topic = zeros(32);
      const encoded = encodeStatement(buildStmt({ topics: [topic, topic] }));
      expect(encoded[0]).toBe(0x08); // compact(2) = two fields
      expect(encoded[1]).toBe(4); // topic1
      expect(encoded[1 + 1 + 32]).toBe(5); // topic2
    });

    it('proof variant index for Sr25519 is 0', () => {
      const encoded = encodeStatement(
        buildStmt({ proof: { tag: 'Sr25519', value: { signature: zeros(64), signer: zeros(32) } } }),
      );
      expect(encoded[1]).toBe(0); // FIELD_PROOF
      expect(encoded[2]).toBe(0); // Sr25519 proof type index
    });

    it('proof variant index for Ed25519 is 1', () => {
      const encoded = encodeStatement(
        buildStmt({ proof: { tag: 'Ed25519', value: { signature: zeros(64), signer: zeros(32) } } }),
      );
      expect(encoded[2]).toBe(1);
    });

    it('proof variant index for Ecdsa is 2', () => {
      const encoded = encodeStatement(
        buildStmt({ proof: { tag: 'Ecdsa', value: { signature: zeros(65), signer: zeros(33) } } }),
      );
      expect(encoded[2]).toBe(2);
    });

    it('data uses compact length prefix', () => {
      const data = new Uint8Array([0xaa, 0xbb, 0xcc]);
      const encoded = encodeStatement(buildStmt({ data }));
      // compact(1) + field_index(8) + compact(3) + data
      expect(encoded[0]).toBe(0x04); // compact(1)
      expect(encoded[1]).toBe(8); // FIELD_DATA
      expect(encoded[2]).toBe(0x0c); // compact(3) = 3 << 2 = 12
      expect(encoded[3]).toBe(0xaa);
      expect(encoded[4]).toBe(0xbb);
      expect(encoded[5]).toBe(0xcc);
    });

    it('compact encoding for data length 100', () => {
      const encoded = encodeStatement(buildStmt({ data: randomBytes(100) }));
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
      // compact(1), field_index=0 (proof), proof_type=99 (not a valid discriminant)
      const bad = new Uint8Array([0x04, 0, 99]);
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
      const stmt = buildStmt({
        topics: [randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32), randomBytes(32)],
      });
      expect(() => encodeStatement(stmt)).toThrow(/4 topics/i);
    });
  });
});
