/**
 * JSON-RPC provider bridge for Polkadot API (PAPI).
 *
 * Creates a `JsonRpcProvider` that translates standard JSON-RPC calls
 * (`chainHead_v1_follow`, `chainSpec_v1_genesisHash`, etc.) into typed
 * ProductFacade calls over the transport layer.
 *
 * Ported from product-sdk/papiProvider.ts -- the full ~460-line
 * JSON-RPC bridge implementation, adapted to use the Transport
 * abstraction from @polkadot/api-protocol.
 */

import type { SubscriptionPayload, RuntimeType, OperationStartedResult } from '@polkadot/api-protocol';
import type { JsonRpcProvider } from 'polkadot-api';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';

import type { ProductFacade } from '@polkadot/api-protocol';
import { productLogger } from './logger.js';
import type { HexString } from './types.js';

/**
 * Create a `JsonRpcProvider` for a given chain, identified by its genesis hash.
 *
 * The provider translates every incoming JSON-RPC message into the
 * corresponding ProductFacade method call and routes the response/subscription
 * events back as JSON-RPC responses.
 *
 * @param genesisHash - The genesis hash of the target chain.
 * @param __fallback  - Optional fallback provider for testing.
 * @param internal    - Internal parameters (transport override).
 */
export function createPapiProvider(
  genesisHash: HexString,
  facade: ProductFacade,
  __fallback?: JsonRpcProvider,
): JsonRpcProvider {
  // -------------------------------------------------------------------------
  // Follow state tracking3
  // -------------------------------------------------------------------------

  type FollowState = {
    subscription: { unsubscribe: () => void };
    genesisHash: HexString;
  };

  // -------------------------------------------------------------------------
  // The typed provider (inner provider that receives onMessage callback)
  // -------------------------------------------------------------------------

  const typedProvider: JsonRpcProvider = onMessage => {
    // Keyed by the transport-level `subscriptionId` that the product and
    // host both agree on — the same id we return as the `chainHead_v1_follow`
    // result and surface as `followSubscriptionId` on chain-op requests.
    const activeFollows = new Map<string, FollowState>();
    const activeBroadcasts = new Set<string>();

    // -- JSON-RPC response helpers ------------------------------------------

    function sendJsonRpcResponse(id: number | string, result: unknown): void {
      onMessage({ jsonrpc: '2.0', id, result });
    }

    function sendJsonRpcError(id: number | string, code: number, message: string, data?: unknown): void {
      const error: { code: number; message: string; data?: unknown } = { code, message };
      if (data !== undefined) error.data = data;
      onMessage({ jsonrpc: '2.0', id, error });
    }

    function sendFollowEvent(syntheticSubId: string, event: unknown): void {
      onMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: syntheticSubId, result: event },
      });
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

    /**
     * Forward a chain-op `GenericErr` to the PAPI JSON-RPC caller.
     *
     * The host side packs JSON-RPC 2.0 error objects into `error.reason`
     * (see `stringifyError` on the host). We try to round-trip that JSON:
     * if `reason` parses to a `{code, message, data?}` shape, the original
     * code/message/data are forwarded verbatim, so PAPI sees the node's
     * real error. Anything else (plain strings, parse failures) falls back
     * to `-32603 Internal error` with the raw reason as the message —
     * preserving the previous behavior for unknown shapes.
     */
    function forwardChainError(id: number | string, error: { reason: string }): void {
      try {
        const parsed: unknown = JSON.parse(error.reason);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { code?: unknown }).code === 'number' &&
          typeof (parsed as { message?: unknown }).message === 'string'
        ) {
          const { code, message, data } = parsed as { code: number; message: string; data?: unknown };
          sendJsonRpcError(id, code, message, data);
          return;
        }
      } catch {
        // Not JSON — fall through to the opaque-string path.
      }
      sendJsonRpcError(id, -32603, error.reason);
    }

    // -- Message handler ----------------------------------------------------

    function handleMessage(message: { id: number | string; method: string; params: unknown[] }): void {
      const { id, method, params } = message;

      switch (method) {
        // -- chainHead_v1_follow --------------------------------------------
        case 'chainHead_v1_follow': {
          const [withRuntime] = params as [boolean];

          const subscription = facade.chainHeadFollow({ genesisHash, withRuntime }, payload => {
            const jsonRpcEvent = convertTypedEventToJsonRpc(payload);
            sendFollowEvent(subscription.subscriptionId, jsonRpcEvent);
          });

          activeFollows.set(subscription.subscriptionId, {
            subscription,
            genesisHash,
          });
          sendJsonRpcResponse(id, subscription.subscriptionId);
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
          facade
            .chainHeadHeader({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
            })
            .match(
              result => sendJsonRpcResponse(id, result),
              error => forwardChainError(id, error),
            );
          break;
        }

        // -- chainHead_v1_body ----------------------------------------------
        case 'chainHead_v1_body': {
          const [followSubId, hash] = params as [string, HexString];
          facade
            .chainHeadBody({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
            })
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result)),
              error => forwardChainError(id, error),
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
          facade
            .chainHeadStorage({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
              items: typedItems,
              childTrie,
            })
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result)),
              error => forwardChainError(id, error),
            );
          break;
        }

        // -- chainHead_v1_call ----------------------------------------------
        case 'chainHead_v1_call': {
          const [followSubId, hash, fn, callParameters] = params as [string, HexString, string, HexString];
          facade
            .chainHeadCall({
              genesisHash,
              followSubscriptionId: followSubId,
              hash,
              function: fn,
              callParameters,
            })
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result)),
              error => forwardChainError(id, error),
            );
          break;
        }

        // -- chainHead_v1_unpin ---------------------------------------------
        case 'chainHead_v1_unpin': {
          const [followSubId, hashOrHashes] = params as [string, HexString | HexString[]];
          const hashes = Array.isArray(hashOrHashes) ? hashOrHashes : [hashOrHashes];
          facade
            .chainHeadUnpin({
              genesisHash,
              followSubscriptionId: followSubId,
              hashes,
            })
            .match(
              () => sendJsonRpcResponse(id, null),
              error => forwardChainError(id, error),
            );
          break;
        }

        // -- chainHead_v1_continue ------------------------------------------
        case 'chainHead_v1_continue': {
          const [followSubId, operationId] = params as [string, string];
          facade
            .chainHeadContinue({
              genesisHash,
              followSubscriptionId: followSubId,
              operationId,
            })
            .match(
              () => sendJsonRpcResponse(id, null),
              error => forwardChainError(id, error),
            );
          break;
        }

        // -- chainHead_v1_stopOperation -------------------------------------
        case 'chainHead_v1_stopOperation': {
          const [followSubId, operationId] = params as [string, string];
          facade
            .chainHeadStopOperation({
              genesisHash,
              followSubscriptionId: followSubId,
              operationId,
            })
            .match(
              () => sendJsonRpcResponse(id, null),
              error => forwardChainError(id, error),
            );
          break;
        }

        // -- chainSpec_v1_genesisHash ---------------------------------------
        case 'chainSpec_v1_genesisHash': {
          facade.chainSpecGenesisHash(genesisHash).match(
            result => sendJsonRpcResponse(id, result),
            error => forwardChainError(id, error),
          );
          break;
        }

        // -- chainSpec_v1_chainName -----------------------------------------
        case 'chainSpec_v1_chainName': {
          facade.chainSpecChainName(genesisHash).match(
            result => sendJsonRpcResponse(id, result),
            error => forwardChainError(id, error),
          );
          break;
        }

        // -- chainSpec_v1_properties ----------------------------------------
        case 'chainSpec_v1_properties': {
          facade.chainSpecProperties(genesisHash).match(
            result => {
              try {
                sendJsonRpcResponse(id, JSON.parse(result));
              } catch {
                sendJsonRpcResponse(id, result);
              }
            },
            error => forwardChainError(id, error),
          );
          break;
        }

        // -- transaction_v1_broadcast ---------------------------------------
        case 'transaction_v1_broadcast': {
          const [transaction] = params as [HexString];
          facade.chainTransactionBroadcast({ genesisHash, transaction }).match(
            result => {
              const opId = result;
              if (opId !== undefined) {
                activeBroadcasts.add(opId);
              }
              sendJsonRpcResponse(id, opId);
            },
            error => forwardChainError(id, error),
          );
          break;
        }

        // -- transaction_v1_stop --------------------------------------------
        case 'transaction_v1_stop': {
          const [operationId] = params as [string];
          activeBroadcasts.delete(operationId);
          facade.chainTransactionStop({ genesisHash, operationId }).match(
            () => sendJsonRpcResponse(id, null),
            error => forwardChainError(id, error),
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
      send(message): void {
        handleMessage(message as { id: number | string; method: string; params: unknown[] });
      },
      disconnect(): void {
        // Clean up all active follow subscriptions
        for (const follow of activeFollows.values()) {
          follow.subscription.unsubscribe();
        }
        activeFollows.clear();

        // Stop all active broadcasts
        for (const operationId of activeBroadcasts) {
          facade.chainTransactionStop({ genesisHash, operationId }).match(
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

  async function checkIfReady(): Promise<boolean> {
    try {
      await facade.whenReady();
      return await facade.featureSupported({ tag: 'Chain' as const, value: genesisHash }).match(
        supported => supported,
        () => false,
      );
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Return a sync provider that lazily initialises
  // -------------------------------------------------------------------------

  return getSyncProvider(onResult => {
    let cancelled = false;
    void (async () => {
      const ready = await checkIfReady();
      if (cancelled) return;
      if (ready) {
        onResult(onMessage => typedProvider(onMessage));
      } else if (__fallback) {
        const fallback = __fallback;
        onResult(onMessage => fallback(onMessage));
      } else {
        onResult(() => ({
          send() {
            productLogger.error(`Provider for chain ${genesisHash} was not started because Host doesn't support it`);
          },
          disconnect() {
            /* empty */
          },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  });
}
