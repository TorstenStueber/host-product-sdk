/**
 * Chain connection manager.
 *
 * Manages JSON-RPC connections per genesis hash, multiplexing follow
 * subscriptions and request/response correlation over a single connection
 * per chain. Ported from triangle-js-sdks host-container/chainConnectionManager.ts.
 */

import type { HexString } from '@polkadot/shared';
import type {
  ChainHeadEvent,
  OperationStartedResult,
  RuntimeType,
} from '@polkadot/shared';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
};

type FollowSubscription = {
  chainSubId: string;
  eventListener: (event: unknown) => void;
  pendingRequestId?: string;
};

type ChainEntry = {
  connection: { send: (msg: string) => void; disconnect: () => void };
  pendingRequests: Map<string, PendingRequest>;
  followSubscriptions: Map<string, FollowSubscription>;
  refCount: number;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ChainConnectionManager = ReturnType<typeof createChainConnectionManager>;

let instanceCounter = 0;

export function createChainConnectionManager(
  factory: (genesisHash: HexString) => JsonRpcProvider | null,
) {
  const chains = new Map<HexString, ChainEntry>();
  const instanceId = instanceCounter++;
  let nextId = 0;

  function getNextId(): string {
    return `ccm_${instanceId}_${nextId++}`;
  }

  function getOrCreateChain(genesisHash: HexString): ChainEntry | null {
    const existing = chains.get(genesisHash);
    if (existing) {
      existing.refCount++;
      return existing;
    }

    const provider = factory(genesisHash);
    if (!provider) return null;

    const pendingRequests = new Map<string, PendingRequest>();
    const followSubscriptions = new Map<string, FollowSubscription>();

    const entry: ChainEntry = {
      connection: null!,
      pendingRequests,
      followSubscriptions,
      refCount: 1,
    };

    entry.connection = provider((message: string) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }

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

      // Subscription notification (has params.subscription)
      const params = parsed.params as Record<string, unknown> | undefined;
      if (params?.subscription) {
        const subId = String(params.subscription);
        for (const follow of followSubscriptions.values()) {
          if (follow.chainSubId === subId) {
            follow.eventListener(params.result);
            break;
          }
        }
      }
    });

    chains.set(genesisHash, entry);
    return entry;
  }

  function sendRequest(genesisHash: HexString, method: string, params: unknown[]): Promise<unknown> {
    const entry = chains.get(genesisHash);
    if (!entry) return Promise.reject(new Error(`No connection for chain ${genesisHash}`));

    const id = getNextId();
    return new Promise((resolve, reject) => {
      entry.pendingRequests.set(id, { resolve, reject });
      entry.connection.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  function startFollow(
    genesisHash: HexString,
    withRuntime: boolean,
    onEvent: (event: unknown) => void,
  ): { followId: string } {
    const entry = chains.get(genesisHash);
    if (!entry) throw new Error(`No connection for chain ${genesisHash}`);

    const followId = getNextId();
    const requestId = getNextId();
    const follow: FollowSubscription = {
      chainSubId: '',
      eventListener: onEvent,
      pendingRequestId: requestId,
    };
    entry.followSubscriptions.set(followId, follow);

    entry.pendingRequests.set(requestId, {
      resolve: (result) => {
        follow.chainSubId = result as string;
        follow.pendingRequestId = undefined;
      },
      reject: () => {
        follow.pendingRequestId = undefined;
        entry.followSubscriptions.delete(followId);
      },
    });
    entry.connection.send(
      JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'chainHead_v1_follow', params: [withRuntime] }),
    );

    return { followId };
  }

  function stopFollow(genesisHash: HexString, followId: string): void {
    const entry = chains.get(genesisHash);
    if (!entry) return;

    const follow = entry.followSubscriptions.get(followId);
    if (!follow) return;

    entry.followSubscriptions.delete(followId);

    if (follow.chainSubId) {
      const id = getNextId();
      entry.connection.send(
        JSON.stringify({ jsonrpc: '2.0', id, method: 'chainHead_v1_unfollow', params: [follow.chainSubId] }),
      );
    } else if (follow.pendingRequestId) {
      entry.pendingRequests.set(follow.pendingRequestId, {
        resolve: (result) => {
          const chainSubId = result as string;
          if (chainSubId) {
            const unfollowId = getNextId();
            entry.connection.send(
              JSON.stringify({ jsonrpc: '2.0', id: unfollowId, method: 'chainHead_v1_unfollow', params: [chainSubId] }),
            );
          }
        },
        reject: () => { /* follow already cleaned up */ },
      });
    }
  }

  function getChainFollowSubId(genesisHash: HexString): string | null {
    const entry = chains.get(genesisHash);
    if (!entry) return null;

    for (const follow of entry.followSubscriptions.values()) {
      if (follow.chainSubId) return follow.chainSubId;
    }
    return null;
  }

  function releaseChain(genesisHash: HexString): void {
    const entry = chains.get(genesisHash);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      for (const follow of entry.followSubscriptions.values()) {
        if (follow.chainSubId) {
          const id = getNextId();
          entry.connection.send(
            JSON.stringify({ jsonrpc: '2.0', id, method: 'chainHead_v1_unfollow', params: [follow.chainSubId] }),
          );
        }
      }
      entry.followSubscriptions.clear();
      entry.connection.disconnect();
      chains.delete(genesisHash);
    }
  }

  function dispose(): void {
    for (const entry of chains.values()) {
      for (const follow of entry.followSubscriptions.values()) {
        if (follow.chainSubId) {
          const id = getNextId();
          entry.connection.send(
            JSON.stringify({ jsonrpc: '2.0', id, method: 'chainHead_v1_unfollow', params: [follow.chainSubId] }),
          );
        }
      }
      entry.followSubscriptions.clear();
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
            items: (event.items as Record<string, unknown>[]).map((item) => ({
              key: item.key as HexString,
              value: (item.value as HexString) ?? null,
              hash: (item.hash as HexString) ?? null,
              closestDescendantMerkleValue: (item.closestDescendantMerkleValue as HexString) ?? null,
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
    stopFollow,
    getChainFollowSubId,
    releaseChain,
    dispose,
    convertJsonRpcEventToTyped,
    convertOperationStartedResult,
    convertStorageQueryTypeToJsonRpc,
  };
}
