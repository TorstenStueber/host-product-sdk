/**
 * MessagePort provider tests.
 *
 * Exercises createMessagePortProvider with both sync and async port
 * delivery, message validation, subscribe/unsubscribe, and dispose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMessagePortProvider } from '@polkadot/host-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

function createMockPort() {
  const listeners: ((event: MessageEvent) => void)[] = [];
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    start: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
    _emit(data: unknown) {
      if (port.onmessage) {
        port.onmessage(new MessageEvent('message', { data }));
      }
    },
  };
  return port as unknown as MessagePort & { _emit: (data: unknown) => void; start: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMessagePortProvider', () => {
  let port: ReturnType<typeof createMockPort>;

  beforeEach(() => {
    port = createMockPort();
  });

  // -- Sync port ----------------------------------------------------------

  it('accepts a sync MessagePort and calls start()', async () => {
    createMessagePortProvider(port as unknown as MessagePort);
    await flush();
    expect(port.start).toHaveBeenCalled();
  });

  it('sets onmessage handler on sync port', async () => {
    createMessagePortProvider(port as unknown as MessagePort);
    await flush();
    expect(port.onmessage).toBeTypeOf('function');
  });

  it('delivers protocol messages to subscribers', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const received: unknown[] = [];
    provider.subscribe(msg => received.push(msg));

    const msg = { requestId: 'p:1', payload: { tag: 'test', value: 42 } };
    port._emit(msg);

    expect(received).toEqual([msg]);
  });

  it('delivers Uint8Array messages to subscribers', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const received: unknown[] = [];
    provider.subscribe(msg => received.push(msg));

    const bytes = new Uint8Array([1, 2, 3]);
    port._emit(bytes);

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(Uint8Array);
  });

  it('rejects messages with null data', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const received: unknown[] = [];
    provider.subscribe(msg => received.push(msg));

    port._emit(null);
    expect(received).toHaveLength(0);
  });

  it('rejects plain string messages', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const received: unknown[] = [];
    provider.subscribe(msg => received.push(msg));

    port._emit('not a protocol message');
    expect(received).toHaveLength(0);
  });

  // -- Async port ---------------------------------------------------------

  it('accepts a Promise<MessagePort> and resolves it', async () => {
    const provider = createMessagePortProvider(Promise.resolve(port as unknown as MessagePort));
    await flush();

    expect(port.onmessage).toBeTypeOf('function');
    expect(port.start).toHaveBeenCalled();
  });

  it('queues postMessage calls until port resolves', async () => {
    let resolvePort!: (port: MessagePort) => void;
    const portPromise = new Promise<MessagePort>(r => { resolvePort = r; });

    const provider = createMessagePortProvider(portPromise);

    // Send before port is ready
    const msg = { requestId: 'p:1', payload: { tag: 'test', value: 1 } };
    provider.postMessage(msg);
    expect(port.postMessage).not.toHaveBeenCalled();

    // Resolve port
    resolvePort(port as unknown as MessagePort);
    await flush();

    expect(port.postMessage).toHaveBeenCalledWith(msg);
  });

  // -- postMessage --------------------------------------------------------

  it('posts plain objects without transfer', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const msg = { requestId: 'p:1', payload: { tag: 'test', value: 1 } };
    provider.postMessage(msg);

    expect(port.postMessage).toHaveBeenCalledWith(msg);
  });

  it('posts Uint8Array with buffer transfer', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const bytes = new Uint8Array([1, 2, 3]);
    const buffer = bytes.buffer;
    provider.postMessage(bytes);

    expect(port.postMessage).toHaveBeenCalledWith(bytes, [buffer]);
  });

  // -- Subscribe/unsubscribe ---------------------------------------------

  it('unsubscribe stops delivery', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const received: unknown[] = [];
    const unsub = provider.subscribe(msg => received.push(msg));

    const msg1 = { requestId: 'p:1', payload: { tag: 'a', value: 1 } };
    port._emit(msg1);
    expect(received).toHaveLength(1);

    unsub();

    const msg2 = { requestId: 'p:2', payload: { tag: 'b', value: 2 } };
    port._emit(msg2);
    expect(received).toHaveLength(1);
  });

  it('multiple subscribers all receive messages', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const a: unknown[] = [];
    const b: unknown[] = [];
    provider.subscribe(msg => a.push(msg));
    provider.subscribe(msg => b.push(msg));

    const msg = { requestId: 'p:1', payload: { tag: 'test', value: 1 } };
    port._emit(msg);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  // -- Dispose ------------------------------------------------------------

  it('dispose stops message delivery', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    const received: unknown[] = [];
    provider.subscribe(msg => received.push(msg));

    provider.dispose();

    port._emit({ requestId: 'p:1', payload: { tag: 'test', value: 1 } });
    expect(received).toHaveLength(0);
  });

  it('dispose clears onmessage on sync port', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();
    expect(port.onmessage).not.toBeNull();

    provider.dispose();
    expect(port.onmessage).toBeNull();
  });

  it('dispose prevents postMessage from sending', async () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    await flush();

    provider.dispose();
    provider.postMessage({ requestId: 'p:1', payload: { tag: 'test', value: 1 } });

    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('dispose before async port resolves clears onmessage after resolve', async () => {
    let resolvePort!: (port: MessagePort) => void;
    const portPromise = new Promise<MessagePort>(r => { resolvePort = r; });

    const provider = createMessagePortProvider(portPromise);
    provider.dispose();

    resolvePort(port as unknown as MessagePort);
    await flush();

    // onmessage should be cleared even though we disposed before resolution
    expect(port.onmessage).toBeNull();
  });

  // -- isCorrectEnvironment -----------------------------------------------

  it('always returns true', () => {
    const provider = createMessagePortProvider(port as unknown as MessagePort);
    expect(provider.isCorrectEnvironment()).toBe(true);
  });
});
