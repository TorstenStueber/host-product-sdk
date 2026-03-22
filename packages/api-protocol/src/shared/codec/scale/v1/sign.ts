import { Enum, Hex } from '../primitives.js';
import { Bytes, Option, Struct, Vector, _void, bool, str, u32 } from 'scale-ts';
import { GenericErr, GenesisHash } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const SigningErr = Enum({
  FailedToDecode: _void,
  Rejected: _void,
  PermissionDenied: _void,
  Unknown: GenericErr,
});

// -- Result / Payload types ---------------------------------------------------

export const SigningResult = Struct({
  signature: Hex(),
  signedTransaction: Option(Hex()),
});

const RawPayload = Enum({
  Bytes: Bytes(),
  Payload: str,
});

export const SigningRawPayload = Struct({
  address: str,
  data: RawPayload,
});

export const SigningPayload = Struct({
  address: str,
  blockHash: Hex(),
  blockNumber: Hex(),
  era: Hex(),
  genesisHash: GenesisHash,
  method: Hex(),
  nonce: Hex(),
  specVersion: Hex(),
  tip: Hex(),
  transactionVersion: Hex(),
  signedExtensions: Vector(str),
  version: u32,
  assetId: Option(Hex()),
  metadataHash: Option(Hex()),
  mode: Option(u32),
  withSignedTransaction: Option(bool),
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type SigningResultType = CodecType<typeof SigningResult>;
export type RawPayloadType = CodecType<typeof RawPayload>;
export type SigningRawPayloadType = CodecType<typeof SigningRawPayload>;
export type SigningPayloadType = CodecType<typeof SigningPayload>;
