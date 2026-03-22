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

const TxPayloadExtension = Struct({
  id: str,
  extra: Hex(),
  additionalSigned: Hex(),
});

const TxPayloadContext = Struct({
  metadata: Hex(),
  tokenSymbol: str,
  tokenDecimals: u32,
  bestBlockHeight: u32,
});

const TxPayloadV1 = Struct({
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

export type TxPayloadExtensionType = CodecType<typeof TxPayloadExtension>;
export type TxPayloadContextType = CodecType<typeof TxPayloadContext>;
export type TxPayloadV1Type = CodecType<typeof TxPayloadV1>;
export type VersionedTxPayloadType = CodecType<typeof VersionedTxPayload>;
