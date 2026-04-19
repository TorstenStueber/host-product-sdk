/**
 * Chain connection manager.
 *
 * Manages JSON-RPC connections per genesis hash, multiplexing follow
 * subscriptions and request/response correlation over a single connection
 * per chain. Ported from triangle-js-sdks host-container/chainConnectionManager.ts.
 */

import type { HexString } from '../shared/codec/scale/primitives.js';
import type { ChainHeadEvent, OperationStartedResult, RuntimeType } from '../api/types.js';
import type { JsonRpcProvider } from 'polkadot-api';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
};

type FollowSubscription = {
  /**
   * The `chainHead_v1_follow` subscription id returned by the substrate
   * node. Kept separate from the transport-level `subscriptionId` used
   * as this map's key — two different "subscription ids" are in play at
   * this boundary, and we never want to confuse them.
   */
  followId: string;
  eventListener: (event: unknown) => void;
};

type ChainEntry = {
  connection: ReturnType<JsonRpcProvider>;
  pendingRequests: Map<string, PendingRequest>;
  /**
   * Active follow subscriptions keyed by the transport-level
   * `subscriptionId` — i.e. the same id the product embeds in
   * `followSubscriptionId` on subsequent chain-op requests.
   */
  followSubscriptions: Map<string, FollowSubscription>;
  refCount: number;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let instanceCounter = 0;

export function createChainConnectionManager(factory: (genesisHash: HexString) => JsonRpcProvider | undefined) {
  const chains = new Map<HexString, ChainEntry>();
  const instanceId = instanceCounter++;
  let nextId = 0;

  function getNextId(): string {
    return `ccm_${instanceId}_${nextId++}`;
  }

  function getOrCreateChain(genesisHash: HexString): ChainEntry | undefined {
    const existing = chains.get(genesisHash);
    if (existing) {
      existing.refCount++;
      return existing;
    }

    const provider = factory(genesisHash);
    if (!provider) return undefined;

    const pendingRequests = new Map<string, PendingRequest>();
    const followSubscriptions = new Map<string, FollowSubscription>();

    const entry: ChainEntry = {
      connection: undefined!,
      pendingRequests,
      followSubscriptions,
      refCount: 1,
    };

    entry.connection = provider(message => {
      const parsed = message as Record<string, unknown>;

      // Request-response (has 'id' field)
      if ('id' in parsed && parsed.id != null) {
        const pending = pendingRequests.get(String(parsed.id));
        if (pending) {
          pendingRequests.delete(String(parsed.id));
          if ('error' in parsed) {
            pending.reject(parsed.error);
          } else {
            pending.resolve(parsed.result);
          }
          return;
        }
      }

      // Subscription notification (has params.subscription).
      // Node-assigned followId → host-local FollowSubscription lookup.
      // Linear scan is fine: at most one follow per consumer, and consumers
      // per chain are typically O(1).
      const params = parsed.params as Record<string, unknown> | undefined;
      if (params?.subscription) {
        const followId = String(params.subscription);
        for (const follow of followSubscriptions.values()) {
          if (follow.followId === followId) {
            follow.eventListener(params.result);
            break;
          }
        }
      }
    });

    chains.set(genesisHash, entry);
    return entry;
  }

  /**
   * Build a JSON-RPC 2.0-shaped error object for transport-level failures
   * (e.g. `connection.send` throwing synchronously on a closed socket).
   * Using the same `{code, message, data?}` shape as real node errors means
   * callers of `sendRequest` / `startFollow` only ever see one error shape.
   * Code -32603 is "Internal error" per the spec.
   */
  function transportError(e: unknown): { code: number; message: string } {
    return { code: -32603, message: e instanceof Error ? e.message : String(e) };
  }

  /**
   * Send a JSON-RPC 2.0 request on the given chain's connection and resolve
   * with the node's `result` (or reject with the node's `error` object,
   * shape `{code, message, data?}`). Synchronous failures of
   * `connection.send` are converted to the same shape via `transportError`.
   *
   * Takes a `ChainEntry` directly rather than a `genesisHash` so the
   * "chain not found" case is impossible by construction — every call site
   * has already obtained an entry via `getOrCreateChain` or `resolveFollow`.
   */
  function sendRequest(entry: ChainEntry, method: string, params: unknown[]): Promise<unknown> {
    const id = getNextId();
    return new Promise((resolve, reject) => {
      entry.pendingRequests.set(id, { resolve, reject });
      try {
        entry.connection.send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        entry.pendingRequests.delete(id);
        reject(transportError(e));
      }
    });
  }

  /**
   * Start a `chainHead_v1_follow` subscription on the given chain.
   *
   * Two subscription ids are in play at this boundary and we keep them
   * strictly separate:
   *
   * - `subscriptionId` (argument): the transport-level id of the
   *   originating TrUAPI subscription, chosen by the caller. Keys the
   *   local `followSubscriptions` map and is what subsequent chain-op
   *   requests carry as `followSubscriptionId`.
   * - `followId` (resolved asynchronously from the node response): the
   *   `chainHead_v1_follow` subscription id chosen by the substrate
   *   node. Used for `chainHead_v1_*` calls on the wire to the node
   *   and for routing incoming notifications.
   *
   * `onRejected` is invoked with a `{code, message, data?}` JSON-RPC error
   * if the node rejects the follow request, or with a transport-level
   * error if `connection.send` throws synchronously. The caller is
   * expected to translate this into a protocol-level termination signal
   * (e.g. `interrupt()` on the TrUAPI subscription) -- without this hook
   * the product would silently receive no events and never learn the
   * follow failed.
   *
   * The returned function stops the follow. It is idempotent and handles
   * all three states: (1) the node response hasn't arrived yet (stop is
   * deferred — `unfollow` is sent once the response arrives), (2) the
   * follow is active (sends `unfollow` immediately), (3) the follow was
   * already stopped (no-op).
   */
  function startFollow(
    entry: ChainEntry,
    subscriptionId: string,
    withRuntime: boolean,
    onEvent: (event: unknown) => void,
    onRejected: (error: unknown) => void,
  ): () => void {
    const requestId = getNextId();
    let stopped = false;
    let followId: string | undefined;

    entry.pendingRequests.set(requestId, {
      resolve: result => {
        followId = result as string;
        if (stopped) {
          // Stop was called before the node responded — unfollow immediately.
          if (followId) sendUnfollow(entry, followId);
          return;
        }
        entry.followSubscriptions.set(subscriptionId, { followId, eventListener: onEvent });
      },
      reject: error => {
        // Node rejected the follow request — notify the caller so the
        // subscription is torn down cleanly on the product side.
        if (!stopped) onRejected(error);
      },
    });
    try {
      entry.connection.send({ jsonrpc: '2.0', id: requestId, method: 'chainHead_v1_follow', params: [withRuntime] });
    } catch (e) {
      entry.pendingRequests.delete(requestId);
      onRejected(transportError(e));
      return () => {};
    }

    return () => {
      if (stopped) return;
      stopped = true;
      if (followId) {
        entry.followSubscriptions.delete(subscriptionId);
        sendUnfollow(entry, followId);
      }
      // If followId is not yet known, the pending-request resolve closure
      // above observes `stopped` and issues the unfollow when it arrives.
    };
  }

  function sendUnfollow(entry: ChainEntry, followId: string): void {
    const id = getNextId();
    entry.connection.send({ jsonrpc: '2.0', id, method: 'chainHead_v1_unfollow', params: [followId] });
  }

  /**
   * Look up an active follow by the transport-level `subscriptionId` on the
   * given chain. Returns both the `ChainEntry` (needed for `sendRequest`)
   * and the node-assigned `followId` (needed as the first positional
   * argument on every `chainHead_v1_*` call). Returns `undefined` if the
   * chain is gone, no follow matches the id, or the node hasn't yet
   * responded with a follow id for it.
   */
  function resolveFollow(
    genesisHash: HexString,
    subscriptionId: string,
  ): { entry: ChainEntry; followId: string } | undefined {
    const entry = chains.get(genesisHash);
    const followId = entry?.followSubscriptions.get(subscriptionId)?.followId;
    if (!entry || !followId) return undefined;
    return { entry, followId };
  }

  function unfollowAll(entry: ChainEntry): void {
    for (const follow of entry.followSubscriptions.values()) {
      if (follow.followId) sendUnfollow(entry, follow.followId);
    }
    entry.followSubscriptions.clear();
  }

  function releaseChain(genesisHash: HexString): void {
    const entry = chains.get(genesisHash);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      unfollowAll(entry);
      entry.connection.disconnect();
      chains.delete(genesisHash);
    }
  }

  function dispose(): void {
    for (const entry of chains.values()) {
      unfollowAll(entry);
      entry.connection.disconnect();
    }
    chains.clear();
  }

  // -- JSON-RPC to typed conversion helpers ---------------------------------

  function convertJsonRpcEventToTyped(event: Record<string, unknown>): ChainHeadEvent {
    const eventType = event.event as string;

    switch (eventType) {
      case 'initialized':
        return {
          tag: 'Initialized',
          value: {
            finalizedBlockHashes: event.finalizedBlockHashes as HexString[],
            finalizedBlockRuntime: convertRuntime(event.finalizedBlockRuntime),
          },
        };
      case 'newBlock':
        return {
          tag: 'NewBlock',
          value: {
            blockHash: event.blockHash as HexString,
            parentBlockHash: event.parentBlockHash as HexString,
            newRuntime: convertRuntime(event.newRuntime),
          },
        };
      case 'bestBlockChanged':
        return {
          tag: 'BestBlockChanged',
          value: { bestBlockHash: event.bestBlockHash as HexString },
        };
      case 'finalized':
        return {
          tag: 'Finalized',
          value: {
            finalizedBlockHashes: event.finalizedBlockHashes as HexString[],
            prunedBlockHashes: event.prunedBlockHashes as HexString[],
          },
        };
      case 'operationBodyDone':
        return {
          tag: 'OperationBodyDone',
          value: {
            operationId: event.operationId as string,
            value: event.value as HexString[],
          },
        };
      case 'operationCallDone':
        return {
          tag: 'OperationCallDone',
          value: {
            operationId: event.operationId as string,
            output: event.output as HexString,
          },
        };
      case 'operationStorageItems':
        return {
          tag: 'OperationStorageItems',
          value: {
            operationId: event.operationId as string,
            items: (event.items as Record<string, unknown>[]).map(item => ({
              key: item.key as HexString,
              value: (item.value as HexString) ?? undefined,
              hash: (item.hash as HexString) ?? undefined,
              closestDescendantMerkleValue: (item.closestDescendantMerkleValue as HexString) ?? undefined,
            })),
          },
        };
      case 'operationStorageDone':
        return {
          tag: 'OperationStorageDone',
          value: { operationId: event.operationId as string },
        };
      case 'operationWaitingForContinue':
        return {
          tag: 'OperationWaitingForContinue',
          value: { operationId: event.operationId as string },
        };
      case 'operationInaccessible':
        return {
          tag: 'OperationInaccessible',
          value: { operationId: event.operationId as string },
        };
      case 'operationError':
        return {
          tag: 'OperationError',
          value: {
            operationId: event.operationId as string,
            error: event.error as string,
          },
        };
      case 'stop':
      default:
        return { tag: 'Stop', value: undefined };
    }
  }

  function convertRuntime(runtime: unknown): RuntimeType | undefined {
    if (!runtime || typeof runtime !== 'object') return undefined;

    const rt = runtime as Record<string, unknown>;
    if (rt.type === 'valid') {
      const spec = rt.spec as Record<string, unknown>;
      const apis = spec.apis as Record<string, number> | undefined;
      return {
        tag: 'Valid',
        value: {
          specName: spec.specName as string,
          implName: spec.implName as string,
          specVersion: spec.specVersion as number,
          implVersion: spec.implVersion as number,
          transactionVersion: (spec.transactionVersion as number) ?? undefined,
          apis: apis ? Object.entries(apis).map(([name, version]) => [name, version] as [string, number]) : [],
        },
      };
    }
    if (rt.type === 'invalid') {
      return { tag: 'Invalid', value: { error: (rt as Record<string, unknown>).error as string } };
    }

    return undefined;
  }

  function convertOperationStartedResult(result: unknown): OperationStartedResult {
    if (typeof result === 'object' && result !== null) {
      const r = result as Record<string, unknown>;
      if (r.result === 'started') {
        return { tag: 'Started', value: { operationId: r.operationId as string } };
      }
    }
    return { tag: 'LimitReached', value: undefined };
  }

  function convertStorageQueryTypeToJsonRpc(type: string): string {
    const map: Record<string, string> = {
      Value: 'value',
      Hash: 'hash',
      ClosestDescendantMerkleValue: 'closestDescendantMerkleValue',
      DescendantsValues: 'descendantsValues',
      DescendantsHashes: 'descendantsHashes',
    };
    return map[type] ?? 'value';
  }

  return {
    getOrCreateChain,
    sendRequest,
    startFollow,
    resolveFollow,
    releaseChain,
    dispose,
    convertJsonRpcEventToTyped,
    convertOperationStartedResult,
    convertStorageQueryTypeToJsonRpc,
  };
}
