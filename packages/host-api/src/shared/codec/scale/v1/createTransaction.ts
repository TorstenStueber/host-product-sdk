import { Enum, Hex } from '../primitives.js';
import { Option, Struct, Vector, _void, str, u32, u8 } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const CreateTransactionErr = Enum({
  FailedToDecode: _void,
  Rejected: _void,
  NotSupported: str,
  PermissionDenied: _void,
  Unknown: GenericErr,
});

// -- Tx Payload types ---------------------------------------------------------

export const TxPayloadExtension = Struct({
  id: str,
  extra: Hex(),
  additionalSigned: Hex(),
});

export const TxPayloadContext = Struct({
  metadata: Hex(),
  tokenSymbol: str,
  tokenDecimals: u32,
  bestBlockHeight: u32,
});

export const TxPayloadV1 = Struct({
  signer: Option(str),
  callData: Hex(),
  extensions: Vector(TxPayloadExtension),
  txExtVersion: u8,
  context: TxPayloadContext,
});

export const VersionedTxPayload = Enum({
  v1: TxPayloadV1,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type CreateTransactionErrType = CodecType<typeof CreateTransactionErr>;
export type TxPayloadExtensionType = CodecType<typeof TxPayloadExtension>;
export type TxPayloadContextType = CodecType<typeof TxPayloadContext>;
export type TxPayloadV1Type = CodecType<typeof TxPayloadV1>;
export type VersionedTxPayloadType = CodecType<typeof VersionedTxPayload>;
