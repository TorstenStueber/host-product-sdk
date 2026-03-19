/**
 * JSON-RPC provider bridge for Polkadot API (PAPI).
 *
 * Creates a `JsonRpcProvider` that translates standard JSON-RPC calls
 * (`chainHead_v1_follow`, `chainSpec_v1_genesisHash`, etc.) into typed
 * HostApi calls over the transport layer.
 *
 * Ported from product-sdk/papiProvider.ts -- the full ~460-line
 * JSON-RPC bridge implementation, adapted to use the Transport
 * abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';

import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
import type { HexString } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type InternalParams = {
  transport?: Transport;
};

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
  internal?: InternalParams,
): JsonRpcProvider {
  const version = 'v1';
  const transport = internal?.transport ?? sandboxTransport;

  if (!transport.isCorrectEnvironment()) {
    throw new Error('PapiProvider can only be used in a product environment');
  }

  const hostApi = createHostApi(transport);

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

  const typedProvider: JsonRpcProvider = (onMessage) => {
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

    function convertTypedEventToJsonRpc(event: { tag: string; value: unknown }): unknown {
      switch (event.tag) {
        case 'Initialized': {
          const v = event.value as {
            finalizedBlockHashes: HexString[];
            finalizedBlockRuntime: unknown;
          };
          return {
            event: 'initialized',
            finalizedBlockHashes: v.finalizedBlockHashes,
            finalizedBlockRuntime: convertRuntimeToJsonRpc(v.finalizedBlockRuntime),
          };
        }
        case 'NewBlock': {
          const v = event.value as {
            blockHash: HexString;
            parentBlockHash: HexString;
            newRuntime: unknown;
          };
          return {
            event: 'newBlock',
            blockHash: v.blockHash,
            parentBlockHash: v.parentBlockHash,
            newRuntime: convertRuntimeToJsonRpc(v.newRuntime),
          };
        }
        case 'BestBlockChanged': {
          const v = event.value as { bestBlockHash: HexString };
          return { event: 'bestBlockChanged', bestBlockHash: v.bestBlockHash };
        }
        case 'Finalized': {
          const v = event.value as {
            finalizedBlockHashes: HexString[];
            prunedBlockHashes: HexString[];
          };
          return {
            event: 'finalized',
            finalizedBlockHashes: v.finalizedBlockHashes,
            prunedBlockHashes: v.prunedBlockHashes,
          };
        }
        case 'OperationBodyDone': {
          const v = event.value as { operationId: string; value: HexString[] };
          return {
            event: 'operationBodyDone',
            operationId: v.operationId,
            value: v.value,
          };
        }
        case 'OperationCallDone': {
          const v = event.value as { operationId: string; output: HexString };
          return {
            event: 'operationCallDone',
            operationId: v.operationId,
            output: v.output,
          };
        }
        case 'OperationStorageItems': {
          const v = event.value as {
            operationId: string;
            items: {
              key: HexString;
              value: HexString | null;
              hash: HexString | null;
              closestDescendantMerkleValue: HexString | null;
            }[];
          };
          return {
            event: 'operationStorageItems',
            operationId: v.operationId,
            items: v.items,
          };
        }
        case 'OperationStorageDone': {
          const v = event.value as { operationId: string };
          return { event: 'operationStorageDone', operationId: v.operationId };
        }
        case 'OperationWaitingForContinue': {
          const v = event.value as { operationId: string };
          return {
            event: 'operationWaitingForContinue',
            operationId: v.operationId,
          };
        }
        case 'OperationInaccessible': {
          const v = event.value as { operationId: string };
          return {
            event: 'operationInaccessible',
            operationId: v.operationId,
          };
        }
        case 'OperationError': {
          const v = event.value as { operationId: string; error: string };
          return {
            event: 'operationError',
            operationId: v.operationId,
            error: v.error,
          };
        }
        case 'Stop':
          return { event: 'stop' };
        default:
          return { event: 'stop' };
      }
    }

    function convertRuntimeToJsonRpc(runtime: unknown): unknown {
      if (!runtime || typeof runtime !== 'object') return null;

      const rt = runtime as { tag: string; value: unknown };
      if (rt.tag === 'Valid') {
        const spec = rt.value as {
          specName: string;
          implName: string;
          specVersion: number;
          implVersion: number;
          transactionVersion: number | undefined;
          apis: [string, number][];
        };
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
      if (rt.tag === 'Invalid') {
        const v = rt.value as { error: string };
        return { type: 'invalid', error: v.error };
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

    function convertOperationResultToJsonRpc(result: {
      tag: string;
      value: unknown;
    }): unknown {
      if (result.tag === 'Started') {
        const v = result.value as { operationId: string };
        return { result: 'started', operationId: v.operationId };
      }
      return { result: 'limitReached' };
    }

    // -- Error extraction helper --------------------------------------------

    function extractErrorReason(error: { tag: string; value: unknown }): string {
      const v = error.value as { payload?: { reason?: string }; reason?: string } | undefined;
      return v?.payload?.reason ?? v?.reason ?? 'Unknown error';
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

          const subscription = hostApi.chainHeadFollow(
            enumValue(version, { genesisHash, withRuntime }),
            (payload: { tag: string; value: unknown }) => {
              if (payload.tag === version) {
                const jsonRpcEvent = convertTypedEventToJsonRpc(
                  payload.value as { tag: string; value: unknown },
                );
                sendFollowEvent(syntheticSubId, jsonRpcEvent);
              }
            },
          );

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
            .chainHeadHeader(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hash,
              }),
            )
            .match(
              (result: { tag: string; value: unknown }) =>
                sendJsonRpcResponse(id, (result as { value: unknown }).value),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_body ----------------------------------------------
        case 'chainHead_v1_body': {
          const [followSubId, hash] = params as [string, HexString];
          hostApi
            .chainHeadBody(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hash,
              }),
            )
            .match(
              (result: { tag: string; value: unknown }) =>
                sendJsonRpcResponse(
                  id,
                  convertOperationResultToJsonRpc(
                    result.value as { tag: string; value: unknown },
                  ),
                ),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_storage -------------------------------------------
        case 'chainHead_v1_storage': {
          const [followSubId, hash, items, childTrie] = params as [
            string,
            HexString,
            { key: HexString; type: string }[],
            HexString | null,
          ];
          const typedItems = items.map(item => ({
            key: item.key,
            type: convertStorageTypeToTyped(item.type),
          }));
          hostApi
            .chainHeadStorage(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hash,
                items: typedItems,
                childTrie,
              }),
            )
            .match(
              (result: { tag: string; value: unknown }) =>
                sendJsonRpcResponse(
                  id,
                  convertOperationResultToJsonRpc(
                    result.value as { tag: string; value: unknown },
                  ),
                ),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_call ----------------------------------------------
        case 'chainHead_v1_call': {
          const [followSubId, hash, fn, callParameters] = params as [
            string,
            HexString,
            string,
            HexString,
          ];
          hostApi
            .chainHeadCall(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hash,
                function: fn,
                callParameters,
              }),
            )
            .match(
              (result: { tag: string; value: unknown }) =>
                sendJsonRpcResponse(
                  id,
                  convertOperationResultToJsonRpc(
                    result.value as { tag: string; value: unknown },
                  ),
                ),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_unpin ---------------------------------------------
        case 'chainHead_v1_unpin': {
          const [followSubId, hashOrHashes] = params as [
            string,
            HexString | HexString[],
          ];
          const hashes = Array.isArray(hashOrHashes)
            ? hashOrHashes
            : [hashOrHashes];
          hostApi
            .chainHeadUnpin(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hashes,
              }),
            )
            .match(
              () => sendJsonRpcResponse(id, null),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_continue ------------------------------------------
        case 'chainHead_v1_continue': {
          const [followSubId, operationId] = params as [string, string];
          hostApi
            .chainHeadContinue(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                operationId,
              }),
            )
            .match(
              () => sendJsonRpcResponse(id, null),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainHead_v1_stopOperation -------------------------------------
        case 'chainHead_v1_stopOperation': {
          const [followSubId, operationId] = params as [string, string];
          hostApi
            .chainHeadStopOperation(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                operationId,
              }),
            )
            .match(
              () => sendJsonRpcResponse(id, null),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- chainSpec_v1_genesisHash ---------------------------------------
        case 'chainSpec_v1_genesisHash': {
          hostApi.chainSpecGenesisHash(enumValue(version, genesisHash)).match(
            (result: { tag: string; value: unknown }) =>
              sendJsonRpcResponse(id, result.value),
            (error: { tag: string; value: unknown }) =>
              sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- chainSpec_v1_chainName -----------------------------------------
        case 'chainSpec_v1_chainName': {
          hostApi.chainSpecChainName(enumValue(version, genesisHash)).match(
            (result: { tag: string; value: unknown }) =>
              sendJsonRpcResponse(id, result.value),
            (error: { tag: string; value: unknown }) =>
              sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- chainSpec_v1_properties ----------------------------------------
        case 'chainSpec_v1_properties': {
          hostApi.chainSpecProperties(enumValue(version, genesisHash)).match(
            (result: { tag: string; value: unknown }) => {
              try {
                sendJsonRpcResponse(id, JSON.parse(result.value as string));
              } catch {
                sendJsonRpcResponse(id, result.value);
              }
            },
            (error: { tag: string; value: unknown }) =>
              sendJsonRpcError(id, -32603, extractErrorReason(error)),
          );
          break;
        }

        // -- transaction_v1_broadcast ---------------------------------------
        case 'transaction_v1_broadcast': {
          const [transaction] = params as [HexString];
          hostApi
            .chainTransactionBroadcast(
              enumValue(version, { genesisHash, transaction }),
            )
            .match(
              (result: { tag: string; value: unknown }) => {
                const opId = result.value as string | null;
                if (opId !== null) {
                  activeBroadcasts.add(opId);
                }
                sendJsonRpcResponse(id, opId);
              },
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- transaction_v1_stop --------------------------------------------
        case 'transaction_v1_stop': {
          const [operationId] = params as [string];
          activeBroadcasts.delete(operationId);
          hostApi
            .chainTransactionStop(
              enumValue(version, { genesisHash, operationId }),
            )
            .match(
              () => sendJsonRpcResponse(id, null),
              (error: { tag: string; value: unknown }) =>
                sendJsonRpcError(id, -32603, extractErrorReason(error)),
            );
          break;
        }

        // -- Unsupported method ---------------------------------------------
        default: {
          sendJsonRpcError(
            id,
            -32601,
            `Method "${method}" is not supported by HostAPI`,
          );
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
          hostApi
            .chainTransactionStop(
              enumValue(version, { genesisHash, operationId }),
            )
            .match(
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
    return transport.isReady().then(ready => {
      if (!ready) return false;

      return transport
        .request(
          'host_feature_supported',
          enumValue('v1', enumValue('Chain', genesisHash)),
        )
        .then((payload) => {
          const typed = payload as { tag: string; value: { success: boolean; value: unknown } };
          switch (typed.tag) {
            case 'v1': {
              if (typed.value.success) {
                return typed.value.value as boolean;
              }
              const err = typed.value.value as { payload?: { reason?: string } };
              throw new Error(err?.payload?.reason ?? 'Feature check failed');
            }
            default:
              throw new Error(`Unknown message version ${typed.tag}`);
          }
        })
        .catch(e => {
          transport.provider.logger.error('Error checking chain support', e);
          return false;
        });
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
            transport.provider.logger.error(
              `Provider for chain ${genesisHash} was not started because Host doesn't support it`,
            );
          },
          disconnect() {
            /* empty */
          },
        };
      };
    }),
  );
}
