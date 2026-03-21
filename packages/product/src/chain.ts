/**
 * JSON-RPC provider bridge for Polkadot API (PAPI).
 *
 * Creates a `JsonRpcProvider` that translates standard JSON-RPC calls
 * (`chainHead_v1_follow`, `chainSpec_v1_genesisHash`, etc.) into typed
 * HostApi calls over the transport layer.
 *
 * Ported from product-sdk/papiProvider.ts -- the full ~460-line
 * JSON-RPC bridge implementation, adapted to use the Transport
 * abstraction from @polkadot/host-api.
 */

import type { SubscriptionPayload, RuntimeType, OperationStartedResult } from '@polkadot/host-api';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';

import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi, productLogger } from '@polkadot/host-api';
import type { HexString } from './types.js';

/**
 * Create a `JsonRpcProvider` for a given chain, identified by its genesis hash.
 *
 * The provider translates every incoming JSON-RPC message into the
 * corresponding HostApi method call and routes the response/subscription
 * events back as JSON-RPC responses.
 *
 * @param genesisHash - The genesis hash of the target chain.
 * @param __fallback  - Optional fallback provider for testing.
 * @param internal    - Internal parameters (transport override).
 */
export function createPapiProvider(
  genesisHash: HexString,
  __fallback?: JsonRpcProvider,
  hostApi: HostApi = defaultHostApi,
): JsonRpcProvider {
  if (!hostApi.isCorrectEnvironment()) {
    throw new Error('PapiProvider can only be used in a product environment');
  }

  // -------------------------------------------------------------------------
  // Follow state tracking
  // -------------------------------------------------------------------------

  type FollowState = {
    syntheticSubId: string;
    subscription: { unsubscribe: () => void };
    genesisHash: HexString;
  };

  // -------------------------------------------------------------------------
  // The typed provider (inner provider that receives onMessage callback)
  // -------------------------------------------------------------------------

  const typedProvider: JsonRpcProvider = onMessage => {
    const activeFollows = new Map<string, FollowState>();
    const activeBroadcasts = new Set<string>();
    let nextSubId = 0;

    function getNextSubId(): string {
      return `follow_${nextSubId++}`;
    }

    // -- JSON-RPC response helpers ------------------------------------------

    function sendJsonRpcResponse(id: number | string, result: unknown): void {
      onMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }

    function sendJsonRpcError(id: number | string, code: number, message: string): void {
      onMessage(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
    }

    function sendFollowEvent(syntheticSubId: string, event: unknown): void {
      onMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'chainHead_v1_followEvent',
          params: { subscription: syntheticSubId, result: event },
        }),
      );
    }

    // -- Event conversion ---------------------------------------------------

    type ChainHeadEvent = SubscriptionPayload<'remote_chain_head_follow', 'v1'>;

    function convertTypedEventToJsonRpc(event: ChainHeadEvent): unknown {
      switch (event.tag) {
        case 'Initialized':
          return {
            event: 'initialized',
            finalizedBlockHashes: event.value.finalizedBlockHashes,
            finalizedBlockRuntime: convertRuntimeToJsonRpc(event.value.finalizedBlockRuntime),
          };
        case 'NewBlock':
          return {
            event: 'newBlock',
            blockHash: event.value.blockHash,
            parentBlockHash: event.value.parentBlockHash,
            newRuntime: convertRuntimeToJsonRpc(event.value.newRuntime),
          };
        case 'BestBlockChanged':
          return { event: 'bestBlockChanged', bestBlockHash: event.value.bestBlockHash };
        case 'Finalized':
          return {
            event: 'finalized',
            finalizedBlockHashes: event.value.finalizedBlockHashes,
            prunedBlockHashes: event.value.prunedBlockHashes,
          };
        case 'OperationBodyDone':
          return {
            event: 'operationBodyDone',
            operationId: event.value.operationId,
            value: event.value.value,
          };
        case 'OperationCallDone':
          return {
            event: 'operationCallDone',
            operationId: event.value.operationId,
            output: event.value.output,
          };
        case 'OperationStorageItems':
          return {
            event: 'operationStorageItems',
            operationId: event.value.operationId,
            items: event.value.items,
          };
        case 'OperationStorageDone':
          return { event: 'operationStorageDone', operationId: event.value.operationId };
        case 'OperationWaitingForContinue':
          return { event: 'operationWaitingForContinue', operationId: event.value.operationId };
        case 'OperationInaccessible':
          return { event: 'operationInaccessible', operationId: event.value.operationId };
        case 'OperationError':
          return {
            event: 'operationError',
            operationId: event.value.operationId,
            error: event.value.error,
          };
        case 'Stop':
          return { event: 'stop' };
        default:
          return { event: 'stop' };
      }
    }

    function convertRuntimeToJsonRpc(runtime: RuntimeType | undefined): unknown {
      if (!runtime) return null;

      if (runtime.tag === 'Valid') {
        const spec = runtime.value;
        const apisObj: Record<string, number> = {};
        for (const [name, ver] of spec.apis) {
          apisObj[name] = ver;
        }
        return {
          type: 'valid',
          spec: {
            specName: spec.specName,
            implName: spec.implName,
            specVersion: spec.specVersion,
            implVersion: spec.implVersion,
            transactionVersion: spec.transactionVersion,
            apis: apisObj,
          },
        };
      }
      if (runtime.tag === 'Invalid') {
        return { type: 'invalid', error: runtime.value.error };
      }

      return null;
    }

    // -- Storage type conversion --------------------------------------------

    type StorageQueryTypeValue =
      | 'Value'
      | 'Hash'
      | 'ClosestDescendantMerkleValue'
      | 'DescendantsValues'
      | 'DescendantsHashes';

    function convertStorageTypeToTyped(type: string): StorageQueryTypeValue {
      const map: Record<string, StorageQueryTypeValue> = {
        value: 'Value',
        hash: 'Hash',
        closestDescendantMerkleValue: 'ClosestDescendantMerkleValue',
        descendantsValues: 'DescendantsValues',
        descendantsHashes: 'DescendantsHashes',
      };
      return map[type] ?? 'Value';
    }

    // -- Operation result conversion ----------------------------------------

    function convertOperationResultToJsonRpc(result: OperationStartedResult): unknown {
      if (result.tag === 'Started') {
        return { result: 'started', operationId: result.value.operationId };
      }
      return { result: 'limitReached' };
    }

    // -- Error extraction helper --------------------------------------------

    function extractErrorReason(error: { reason: string }): string {
      return error.reason;
    }

    // -- Message handler ----------------------------------------------------

    function handleMessage(message: string): void {
      let parsed: { id: number | string; method: string; params: unknown[] };
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }

      const { id, method, params } = parsed;

      switch (method) {
        // -- chainHead_v1_follow --------------------------------------------
        case 'chainHead_v1_follow': {
          const [withRuntime] = params as [boolean];
          const syntheticSubId = getNextSubId();

          const subscription = hostApi.chainHeadFollow({ genesisHash, withRuntime }, payload => {
            const jsonRpcEvent = convertTypedEventToJsonRpc(payload);
            sendFollowEvent(syntheticSubId, jsonRpcEvent);
          });

          activeFollows.set(syntheticSubId, {
            syntheticSubId,
            subscription,
            genesisHash,
          });
          sendJsonRpcResponse(id, syntheticSubId);
          break;
        }

        // -- chainHead_v1_unfollow ------------------------------------------
        case 'chainHead_v1_unfollow': {
          const [followSubId] = params as [string];
          const follow = activeFollows.get(followSubId);
          if (follow) {
            follow.subscription.unsubscribe();
            activeFollows.delete(followSubId);
          }
          sendJsonRpcResponse(id, null);
          break;
        }

        // -- chainHead_v1_header --------------------------------------------
        case 'chainHead_v1_header': {
          const [followSubId, hash] = params as [string, HexString];
          hostApi
            .chainHeadHeader({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
            })
            .match(
              result => sendJsonRpcResponse(id, result),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_body ----------------------------------------------
        case 'chainHead_v1_body': {
          const [followSubId, hash] = params as [string, HexString];
          hostApi
            .chainHeadBody({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
            })
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result)),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_storage -------------------------------------------
        case 'chainHead_v1_storage': {
          const [followSubId, hash, items, childTrieRaw] = params as [
            string,
            HexString,
            { key: HexString; type: string }[],
            HexString | null,
          ];
          const childTrie = childTrieRaw ?? undefined;
          const typedItems = items.map(item => ({
            key: item.key,
            type: convertStorageTypeToTyped(item.type),
          }));
          hostApi
            .chainHeadStorage({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
              items: typedItems,
              childTrie,
            })
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result)),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_call ----------------------------------------------
        case 'chainHead_v1_call': {
          const [followSubId, hash, fn, callParameters] = params as [string, HexString, string, HexString];
          hostApi
            .chainHeadCall({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
              function: fn,
              callParameters,
            })
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result)),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_unpin ---------------------------------------------
        case 'chainHead_v1_unpin': {
          const [followSubId, hashOrHashes] = params as [string, HexString | HexString[]];
          const hashes = Array.isArray(hashOrHashes) ? hashOrHashes : [hashOrHashes];
          hostApi
            .chainHeadUnpin({
              genesisHash,
              followSubscriptionId: followSubId,
              hashes,
            })
            .match(
              () => sendJsonRpcResponse(id, null),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_continue ------------------------------------------
        case 'chainHead_v1_continue': {
          const [followSubId, operationId] = params as [string, string];
          hostApi
            .chainHeadContinue({
              genesisHash,
              followSubscriptionId: followSubId,
              operationId,
            })
            .match(
              () => sendJsonRpcResponse(id, null),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_stopOperation -------------------------------------
        case 'chainHead_v1_stopOperation': {
          const [followSubId, operationId] = params as [string, string];
          hostApi
            .chainHeadStopOperation({
              genesisHash,
              followSubscriptionId: followSubId,
              operationId,
            })
            .match(
              () => sendJsonRpcResponse(id, null),
              error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainSpec_v1_genesisHash ---------------------------------------
        case 'chainSpec_v1_genesisHash': {
          hostApi.chainSpecGenesisHash(genesisHash).match(
            result => sendJsonRpcResponse(id, result),
            error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- chainSpec_v1_chainName -----------------------------------------
        case 'chainSpec_v1_chainName': {
          hostApi.chainSpecChainName(genesisHash).match(
            result => sendJsonRpcResponse(id, result),
            error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- chainSpec_v1_properties ----------------------------------------
        case 'chainSpec_v1_properties': {
          hostApi.chainSpecProperties(genesisHash).match(
            result => {
              try {
                sendJsonRpcResponse(id, JSON.parse(result));
              } catch {
                sendJsonRpcResponse(id, result);
              }
            },
            error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- transaction_v1_broadcast ---------------------------------------
        case 'transaction_v1_broadcast': {
          const [transaction] = params as [HexString];
          hostApi.chainTransactionBroadcast({ genesisHash, transaction }).match(
            result => {
              const opId = result;
              if (opId !== undefined) {
                activeBroadcasts.add(opId);
              }
              sendJsonRpcResponse(id, opId);
            },
            error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- transaction_v1_stop --------------------------------------------
        case 'transaction_v1_stop': {
          const [operationId] = params as [string];
          activeBroadcasts.delete(operationId);
          hostApi.chainTransactionStop({ genesisHash, operationId }).match(
            () => sendJsonRpcResponse(id, null),
            error => sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- Unsupported method ---------------------------------------------
        default: {
          sendJsonRpcError(id, -32601, `Method "${method}" is not supported by HostAPI`);
          break;
        }
      }
    }

    // Return the connection handle
    return {
      send(message: string): void {
        handleMessage(message);
      },
      disconnect(): void {
        // Clean up all active follow subscriptions
        for (const follow of activeFollows.values()) {
          follow.subscription.unsubscribe();
        }
        activeFollows.clear();

        // Stop all active broadcasts
        for (const operationId of activeBroadcasts) {
          hostApi.chainTransactionStop({ genesisHash, operationId }).match(
            () => {
              /* fire-and-forget on disconnect */
            },
            () => {
              /* transport may already be torn down */
            },
          );
        }
        activeBroadcasts.clear();
      },
    };
  };

  // -------------------------------------------------------------------------
  // Feature check -- verify chain is supported before starting
  // -------------------------------------------------------------------------

  function checkIfReady(): Promise<boolean> {
    return hostApi.isReady().then(ready => {
      if (!ready) return false;

      return hostApi.featureSupported({ tag: 'Chain' as const, value: genesisHash }).match(
        supported => supported,
        () => false,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Return a sync provider that lazily initialises
  // -------------------------------------------------------------------------

  return getSyncProvider(() =>
    checkIfReady().then(ready => {
      if (ready) return typedProvider;
      if (__fallback) return __fallback;

      // Return a no-op provider when the chain is not supported
      return () => {
        return {
          send() {
            productLogger.error(`Provider for chain ${genesisHash} was not started because Host doesn't support it`);
          },
          disconnect() {
            /* empty */
          },
        };
      };
    }),
  );
}
