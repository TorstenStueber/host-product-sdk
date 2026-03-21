import { Enum } from '../primitives.js';
import { Bytes, Option, Struct, Vector, _void, u64 } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Primitives ---------------------------------------------------------------

export const Topic = Bytes(32);
const Channel = Bytes(32);
const DecryptionKey = Bytes(32);

// -- Statement proofs ---------------------------------------------------------

const Sr25519StatementProof = Struct({
  signature: Bytes(64),
  signer: Bytes(32),
});

const Ed25519StatementProof = Struct({
  signature: Bytes(64),
  signer: Bytes(32),
});

const EcdsaStatementProof = Struct({
  signature: Bytes(65),
  signer: Bytes(33),
});

const OnChainStatementProof = Struct({
  who: Bytes(32),
  blockHash: Bytes(32),
  event: u64,
});

export const StatementProof = Enum({
  Sr25519: Sr25519StatementProof,
  Ed25519: Ed25519StatementProof,
  Ecdsa: EcdsaStatementProof,
  OnChain: OnChainStatementProof,
});

// -- Statement ----------------------------------------------------------------

export const Statement = Struct({
  proof: Option(StatementProof),
  decryptionKey: Option(DecryptionKey),
  expiry: Option(u64),
  channel: Option(Channel),
  topics: Vector(Topic),
  data: Option(Bytes()),
});

export const SignedStatement = Struct({
  proof: StatementProof,
  decryptionKey: Option(DecryptionKey),
  expiry: Option(u64),
  channel: Option(Channel),
  topics: Vector(Topic),
  data: Option(Bytes()),
});

// -- Errors -------------------------------------------------------------------

export const StatementProofErr = Enum({
  UnableToSign: _void,
  UnknownAccount: _void,
  Unknown: GenericErr,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type TopicType = CodecType<typeof Topic>;
export type ChannelType = CodecType<typeof Channel>;
export type DecryptionKeyType = CodecType<typeof DecryptionKey>;
export type Sr25519StatementProofType = CodecType<typeof Sr25519StatementProof>;
export type Ed25519StatementProofType = CodecType<typeof Ed25519StatementProof>;
export type EcdsaStatementProofType = CodecType<typeof EcdsaStatementProof>;
export type OnChainStatementProofType = CodecType<typeof OnChainStatementProof>;
export type StatementProofType = CodecType<typeof StatementProof>;
export type StatementType = CodecType<typeof Statement>;
export type SignedStatementType = CodecType<typeof SignedStatement>;
