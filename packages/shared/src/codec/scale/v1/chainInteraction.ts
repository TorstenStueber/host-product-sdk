import { Enum, Hex, Nullable, Status } from '../primitives.js';
import { Option, Result, Struct, Tuple, Vector, _void, bool, str, u32 } from 'scale-ts';
import { GenericErr, GenesisHash } from './commonCodecs.js';

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

// -- ChainHead follow (subscription) -----------------------------------------

export const ChainHeadFollowV1_start = Struct({
  genesisHash: GenesisHash,
  withRuntime: bool,
});

export const ChainHeadFollowV1_receive = ChainHeadEvent;

// -- ChainHead requests -------------------------------------------------------

// Header
export const ChainHeadHeaderV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
});
export const ChainHeadHeaderV1_response = Result(Nullable(Hex()), GenericErr);

// Body
export const ChainHeadBodyV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
});
export const ChainHeadBodyV1_response = Result(OperationStartedResult, GenericErr);

// Storage
export const ChainHeadStorageV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
  items: Vector(StorageQueryItem),
  childTrie: Nullable(Hex()),
});
export const ChainHeadStorageV1_response = Result(OperationStartedResult, GenericErr);

// Call
export const ChainHeadCallV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
  function: str,
  callParameters: Hex(),
});
export const ChainHeadCallV1_response = Result(OperationStartedResult, GenericErr);

// Unpin
export const ChainHeadUnpinV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hashes: Vector(BlockHash),
});
export const ChainHeadUnpinV1_response = Result(_void, GenericErr);

// Continue
export const ChainHeadContinueV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  operationId: OperationId,
});
export const ChainHeadContinueV1_response = Result(_void, GenericErr);

// StopOperation
export const ChainHeadStopOperationV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  operationId: OperationId,
});
export const ChainHeadStopOperationV1_response = Result(_void, GenericErr);

// -- ChainSpec requests -------------------------------------------------------

export const ChainSpecGenesisHashV1_request = GenesisHash;
export const ChainSpecGenesisHashV1_response = Result(Hex(), GenericErr);

export const ChainSpecChainNameV1_request = GenesisHash;
export const ChainSpecChainNameV1_response = Result(str, GenericErr);

export const ChainSpecPropertiesV1_request = GenesisHash;
export const ChainSpecPropertiesV1_response = Result(str, GenericErr);

// -- Transaction requests -----------------------------------------------------

export const TransactionBroadcastV1_request = Struct({
  genesisHash: GenesisHash,
  transaction: Hex(),
});
export const TransactionBroadcastV1_response = Result(Nullable(str), GenericErr);

export const TransactionStopV1_request = Struct({
  genesisHash: GenesisHash,
  operationId: str,
});
export const TransactionStopV1_response = Result(_void, GenericErr);

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
export type ChainHeadFollowParamsType = CodecType<typeof ChainHeadFollowV1_start>;
export type ChainHeadRequestParamsType = CodecType<typeof ChainHeadHeaderV1_request>;
export type ChainHeadStorageParamsType = CodecType<typeof ChainHeadStorageV1_request>;
export type ChainHeadCallParamsType = CodecType<typeof ChainHeadCallV1_request>;
export type ChainHeadUnpinParamsType = CodecType<typeof ChainHeadUnpinV1_request>;
export type ChainHeadOperationParamsType = CodecType<typeof ChainHeadContinueV1_request>;
export type TransactionBroadcastParamsType = CodecType<typeof TransactionBroadcastV1_request>;
export type TransactionStopParamsType = CodecType<typeof TransactionStopV1_request>;
