import { Enum, Hex, Nullable } from '../primitives.js';
import { Result, Struct, Tuple, Vector, _void, str, u32, u8 } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';
import { ProductAccountId } from './accounts.js';

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
  signer: Nullable(str),
  callData: Hex(),
  extensions: Vector(TxPayloadExtension),
  txExtVersion: u8,
  context: TxPayloadContext,
});

export const VersionedTxPayload = Enum({
  v1: TxPayloadV1,
});

// -- V1 request / response codecs --------------------------------------------

// host_create_transaction
export const CreateTransactionV1_request = Tuple(ProductAccountId, VersionedTxPayload);
export const CreateTransactionV1_response = Result(Hex(), CreateTransactionErr);

// host_create_transaction_with_non_product_account
export const CreateTransactionWithNonProductV1_request = VersionedTxPayload;
export const CreateTransactionWithNonProductV1_response = Result(Hex(), CreateTransactionErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type CreateTransactionErrType = CodecType<typeof CreateTransactionErr>;
export type TxPayloadExtensionType = CodecType<typeof TxPayloadExtension>;
export type TxPayloadContextType = CodecType<typeof TxPayloadContext>;
export type TxPayloadV1Type = CodecType<typeof TxPayloadV1>;
export type VersionedTxPayloadType = CodecType<typeof VersionedTxPayload>;
export type CreateTransactionRequestType = CodecType<typeof CreateTransactionV1_request>;
export type CreateTransactionWithNonProductRequestType = CodecType<typeof CreateTransactionWithNonProductV1_request>;
