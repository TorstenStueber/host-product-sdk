/**
 * SCALE codec for Substrate statement-store statements.
 *
 * A statement is encoded as a SCALE Vector of Variant fields.
 * Fields must appear in strictly ascending order by variant index:
 *
 *   0: proof        — Variant { 0:sr25519, 1:ed25519, 2:ecdsa, 3:onChain }
 *   1: decryptionKey — 32 bytes
 *   2: expiry       — u64 little-endian
 *   3: channel      — 32 bytes
 *   4: topic1       — 32 bytes
 *   5: topic2       — 32 bytes
 *   6: topic3       — 32 bytes
 *   7: topic4       — 32 bytes
 *   8: data         — compact-length-prefixed bytes
 *
 * Only present fields are encoded. The topics array is expanded into
 * individual topic1..topic4 entries. Max 4 topics.
 *
 * Wire format: compact(field_count) || field₀ || field₁ || …
 * Each field:  u8(variant_index) || field_data
 */

import type { Statement, StatementProof } from './types.js';

// -- Field variant indices (must match Substrate) ----------------------------

const FIELD_PROOF = 0;
const FIELD_DECRYPTION_KEY = 1;
const FIELD_EXPIRY = 2;
const FIELD_CHANNEL = 3;
const FIELD_TOPIC_BASE = 4; // topic1=4, topic2=5, topic3=6, topic4=7
const FIELD_DATA = 8;

// -- Proof type indices ------------------------------------------------------

const PROOF_TAG: Record<string, number> = { sr25519: 0, ed25519: 1, ecdsa: 2 };
const PROOF_INDEX_TO_TAG = ['sr25519', 'ed25519', 'ecdsa'] as const;
const PROOF_SIZES: Record<string, { sig: number; signer: number }> = {
  sr25519: { sig: 64, signer: 32 },
  ed25519: { sig: 64, signer: 32 },
  ecdsa: { sig: 65, signer: 33 },
};

// -- SCALE compact -----------------------------------------------------------

function encodeCompact(value: number): Uint8Array {
  if (value < 0x40) {
    return new Uint8Array([value << 2]);
  }
  if (value < 0x4000) {
    const v = (value << 2) | 1;
    return new Uint8Array([v & 0xff, v >>> 8]);
  }
  if (value < 0x40000000) {
    const v = (value << 2) | 2;
    return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  }
  throw new Error('Compact value too large');
}

function decodeCompact(data: Uint8Array, offset: number): [value: number, bytesRead: number] {
  const mode = data[offset]! & 3;
  if (mode === 0) return [data[offset]! >>> 2, 1];
  if (mode === 1) return [(data[offset]! | (data[offset + 1]! << 8)) >>> 2, 2];
  if (mode === 2) {
    const raw = data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24);
    return [raw >>> 2, 4];
  }
  throw new Error('Big-integer compact not supported');
}

// -- u64 little-endian -------------------------------------------------------

function encodeU64(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, value, true);
  return new Uint8Array(buf);
}

function decodeU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

// -- Helpers -----------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// -- Encode ------------------------------------------------------------------

function encodeProof(proof: StatementProof): Uint8Array {
  const idx = PROOF_TAG[proof.tag];
  if (idx === undefined) throw new Error(`Unknown proof tag: ${proof.tag}`);
  const out = new Uint8Array(1 + proof.value.signature.length + proof.value.signer.length);
  out[0] = idx;
  out.set(proof.value.signature, 1);
  out.set(proof.value.signer, 1 + proof.value.signature.length);
  return out;
}

export function encodeStatement(statement: Statement): Uint8Array {
  const fields: Uint8Array[] = [];

  if (statement.proof) {
    fields.push(concat(new Uint8Array([FIELD_PROOF]), encodeProof(statement.proof)));
  }
  if (statement.decryptionKey) {
    fields.push(concat(new Uint8Array([FIELD_DECRYPTION_KEY]), statement.decryptionKey));
  }
  if (statement.expiry !== undefined) {
    fields.push(concat(new Uint8Array([FIELD_EXPIRY]), encodeU64(statement.expiry)));
  }
  if (statement.channel) {
    fields.push(concat(new Uint8Array([FIELD_CHANNEL]), statement.channel));
  }
  if (statement.topics) {
    if (statement.topics.length > 4) throw new Error(`Max 4 topics, got ${statement.topics.length}`);
    for (let i = 0; i < statement.topics.length; i++) {
      fields.push(concat(new Uint8Array([FIELD_TOPIC_BASE + i]), statement.topics[i]!));
    }
  }
  if (statement.data) {
    fields.push(concat(new Uint8Array([FIELD_DATA]), encodeCompact(statement.data.length), statement.data));
  }

  return concat(encodeCompact(fields.length), ...fields);
}

// -- Decode ------------------------------------------------------------------

export function decodeStatement(data: Uint8Array): Statement {
  let offset = 0;

  const [fieldCount, lenBytes] = decodeCompact(data, offset);
  offset += lenBytes;

  const statement: Statement = {};
  let maxIdx = -1;
  let topicCount = 0;

  for (let i = 0; i < fieldCount; i++) {
    const fieldIdx = data[offset]!;
    offset += 1;

    if (fieldIdx <= maxIdx) throw new Error('Statement fields not in ascending order');
    maxIdx = fieldIdx;

    switch (fieldIdx) {
      case FIELD_PROOF: {
        const proofIdx = data[offset]!;
        offset += 1;
        const tag = PROOF_INDEX_TO_TAG[proofIdx];
        if (!tag) throw new Error(`Unknown proof type index ${proofIdx}`);
        const sizes = PROOF_SIZES[tag]!;
        const signature = data.slice(offset, offset + sizes.sig);
        offset += sizes.sig;
        const signer = data.slice(offset, offset + sizes.signer);
        offset += sizes.signer;
        statement.proof = { tag, value: { signature, signer } };
        break;
      }
      case FIELD_DECRYPTION_KEY:
        statement.decryptionKey = data.slice(offset, offset + 32);
        offset += 32;
        break;
      case FIELD_EXPIRY:
        statement.expiry = decodeU64(data, offset);
        offset += 8;
        break;
      case FIELD_CHANNEL:
        statement.channel = data.slice(offset, offset + 32);
        offset += 32;
        break;
      case FIELD_TOPIC_BASE:
      case FIELD_TOPIC_BASE + 1:
      case FIELD_TOPIC_BASE + 2:
      case FIELD_TOPIC_BASE + 3: {
        const expected = FIELD_TOPIC_BASE + topicCount;
        if (fieldIdx !== expected)
          throw new Error(`Expected topic${topicCount + 1}, got topic${fieldIdx - FIELD_TOPIC_BASE + 1}`);
        topicCount++;
        if (!statement.topics) statement.topics = [];
        statement.topics.push(data.slice(offset, offset + 32));
        offset += 32;
        break;
      }
      case FIELD_DATA: {
        const [dataLen, dataLenBytes] = decodeCompact(data, offset);
        offset += dataLenBytes;
        statement.data = data.slice(offset, offset + dataLen);
        offset += dataLen;
        break;
      }
      default:
        throw new Error(`Unknown statement field index ${fieldIdx}`);
    }
  }

  return statement;
}
