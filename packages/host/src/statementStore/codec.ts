/**
 * SCALE codec for Substrate statement-store statements.
 *
 * Matches `sp_statement_store::Statement`'s custom `Encode`/`Decode` impl
 * (substrate/primitives/statement-store/src/lib.rs): a statement is
 * encoded as a SCALE `Vec<Field>`. Fields must appear in strictly
 * ascending order by variant index, and each variant may appear at most
 * once. Variant indices:
 *
 *   0: proof        — Enum { 0:sr25519, 1:ed25519, 2:ecdsa, 3:onChain }
 *   1: decryptionKey — 32 bytes (deprecated)
 *   2: expiry       — u64 little-endian
 *   3: channel      — 32 bytes
 *   4: topic1       — 32 bytes
 *   5: topic2       — 32 bytes
 *   6: topic3       — 32 bytes
 *   7: topic4       — 32 bytes
 *   8: data         — compact-length-prefixed bytes
 *
 * Only present fields are encoded (except expiry, which Rust emits
 * unconditionally; this codec emits it only when set — decode is
 * tolerant either way). The topics array is expanded into individual
 * topic1..topic4 entries; max 4 topics.
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

// -- Proof variant indices (must match sp_statement_store::Proof) ------------

const PROOF_SR25519 = 0;
const PROOF_ED25519 = 1;
const PROOF_ECDSA = 2;
const PROOF_ON_CHAIN = 3;

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

function encodeSigProof(idx: number, signature: Uint8Array, signer: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + signature.length + signer.length);
  out[0] = idx;
  out.set(signature, 1);
  out.set(signer, 1 + signature.length);
  return out;
}

function encodeProof(proof: StatementProof): Uint8Array {
  switch (proof.tag) {
    case 'sr25519':
      return encodeSigProof(PROOF_SR25519, proof.value.signature, proof.value.signer);
    case 'ed25519':
      return encodeSigProof(PROOF_ED25519, proof.value.signature, proof.value.signer);
    case 'ecdsa':
      return encodeSigProof(PROOF_ECDSA, proof.value.signature, proof.value.signer);
    case 'onChain': {
      const { who, blockHash, eventIndex } = proof.value;
      // 1-byte discriminant + 32 (who) + 32 (block_hash) + 8 (event_index u64 LE) = 73
      const out = new Uint8Array(1 + 32 + 32 + 8);
      out[0] = PROOF_ON_CHAIN;
      out.set(who, 1);
      out.set(blockHash, 33);
      new DataView(out.buffer).setBigUint64(65, eventIndex, true);
      return out;
    }
  }
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
        switch (proofIdx) {
          case PROOF_SR25519:
          case PROOF_ED25519:
          case PROOF_ECDSA: {
            const [sigLen, signerLen] = proofIdx === PROOF_ECDSA ? [65, 33] : [64, 32];
            const tag = proofIdx === PROOF_SR25519 ? 'sr25519' : proofIdx === PROOF_ED25519 ? 'ed25519' : 'ecdsa';
            const signature = data.slice(offset, offset + sigLen);
            offset += sigLen;
            const signer = data.slice(offset, offset + signerLen);
            offset += signerLen;
            statement.proof = { tag, value: { signature, signer } };
            break;
          }
          case PROOF_ON_CHAIN: {
            const who = data.slice(offset, offset + 32);
            offset += 32;
            const blockHash = data.slice(offset, offset + 32);
            offset += 32;
            const eventIndex = decodeU64(data, offset);
            offset += 8;
            statement.proof = { tag: 'onChain', value: { who, blockHash, eventIndex } };
            break;
          }
          default:
            throw new Error(`Unknown proof type index ${proofIdx}`);
        }
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
