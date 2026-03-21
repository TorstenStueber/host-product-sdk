import { Enum, Hex, Nullable, Status } from '../primitives.js';
import { Option, Struct, Tuple, Vector, _void, str, u32 } from 'scale-ts';

// -- Primitives ---------------------------------------------------------------

export const BlockHash = Hex();
export const OperationId = str;

export const RuntimeApi = Tuple(str, u32);

export const RuntimeSpec = Struct({
  specName: str,
  implName: str,
  specVersion: u32,
  implVersion: u32,
  transactionVersion: Option(u32),
  apis: Vector(RuntimeApi),
});

export const RuntimeType = Enum({
  Valid: RuntimeSpec,
  Invalid: Struct({ error: str }),
});

// -- Storage query types ------------------------------------------------------

export const StorageQueryType = Status('Value', 'Hash', 'ClosestDescendantMerkleValue', 'DescendantsValues', 'DescendantsHashes');

export const StorageQueryItem = Struct({
  key: Hex(),
  type: StorageQueryType,
});

export const StorageResultItem = Struct({
  key: Hex(),
  value: Nullable(Hex()),
  hash: Nullable(Hex()),
  closestDescendantMerkleValue: Nullable(Hex()),
});

// -- Operation result ---------------------------------------------------------

export const OperationStartedResult = Enum({
  Started: Struct({ operationId: OperationId }),
  LimitReached: _void,
});

// -- ChainHead event (subscription receive) -----------------------------------

export const ChainHeadEvent = Enum({
  Initialized: Struct({
    finalizedBlockHashes: Vector(BlockHash),
    finalizedBlockRuntime: Option(RuntimeType),
  }),
  NewBlock: Struct({
    blockHash: BlockHash,
    parentBlockHash: BlockHash,
    newRuntime: Option(RuntimeType),
  }),
  BestBlockChanged: Struct({
    bestBlockHash: BlockHash,
  }),
  Finalized: Struct({
    finalizedBlockHashes: Vector(BlockHash),
    prunedBlockHashes: Vector(BlockHash),
  }),
  OperationBodyDone: Struct({
    operationId: OperationId,
    value: Vector(Hex()),
  }),
  OperationCallDone: Struct({
    operationId: OperationId,
    output: Hex(),
  }),
  OperationStorageItems: Struct({
    operationId: OperationId,
    items: Vector(StorageResultItem),
  }),
  OperationStorageDone: Struct({
    operationId: OperationId,
  }),
  OperationWaitingForContinue: Struct({
    operationId: OperationId,
  }),
  OperationInaccessible: Struct({
    operationId: OperationId,
  }),
  OperationError: Struct({
    operationId: OperationId,
    error: str,
  }),
  Stop: _void,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type BlockHashType = CodecType<typeof BlockHash>;
export type OperationIdType = CodecType<typeof OperationId>;
export type RuntimeApiType = CodecType<typeof RuntimeApi>;
export type RuntimeSpecType = CodecType<typeof RuntimeSpec>;
export type RuntimeTypeType = CodecType<typeof RuntimeType>;
export type StorageQueryTypeType = CodecType<typeof StorageQueryType>;
export type StorageQueryItemType = CodecType<typeof StorageQueryItem>;
export type StorageResultItemType = CodecType<typeof StorageResultItem>;
export type OperationStartedResultType = CodecType<typeof OperationStartedResult>;
export type ChainHeadEventType = CodecType<typeof ChainHeadEvent>;
