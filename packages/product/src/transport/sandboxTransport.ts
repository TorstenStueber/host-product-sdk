/**
 * Product-side provider and transport.
 *
 * Detects whether the current window is running inside an iframe or a
 * native webview and creates the appropriate Provider + Transport pair.
 *
 * Ported from product-sdk/sandboxTransport.ts, adapted to use the new
 * Transport / CodecAdapter abstractions from @polkadot/shared.
 */

import type { Provider, Transport } from '@polkadot/shared';
import {
  scaleCodecAdapter,
  structuredCloneCodecAdapter,
  requestCodecUpgrade,
  createDefaultLogger,
  createTransport,
} from '@polkadot/shared';

// ---------------------------------------------------------------------------
// Global augmentation for webview ports
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __HOST_API_PORT__?: MessagePort;
    __HOST_WEBVIEW_MARK__?: boolean;
  }
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when running in a context that has a `window` object.
 */
export function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Returns `true` when the current window is an iframe (has a different parent).
 */
export function isIframe(): boolean {
  try {
    return hasWindow() && window !== window.top;
  } catch {
    return false;
  }
}

/**
 * Returns `true` when the current window is embedded via a native webview
 * and the host has injected `__HOST_WEBVIEW_MARK__`.
 */
export function isWebview(): boolean {
  try {
    return hasWindow() && window['__HOST_WEBVIEW_MARK__'] === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ttl: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ttl));
}

function getParentWindow(): Window {
  if (typeof window !== 'undefined' && window.top) {
    return window.top;
  }
  throw new Error('No parent window found');
}

async function getWebviewPort(iteration = 200): Promise<MessagePort> {
  if (iteration === 0) {
    throw new Error('No webview port found');
  }
  if (typeof window !== 'undefined' && window['__HOST_API_PORT__']) {
    return window['__HOST_API_PORT__'];
  }
  await delay(100);
  return getWebviewPort(iteration - 1);
}

function isProtocolMessage(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'requestId' in (data as Record<string, unknown>) &&
    'payload' in (data as Record<string, unknown>)
  );
}

function isValidIframeMessage(
  event: MessageEvent,
  sourceEnv: MessageEventSource,
  currentEnv: MessageEventSource,
): boolean {
  return (
    event.source !== currentEnv &&
    event.source === sourceEnv &&
    event.data != null &&
    (event.data instanceof Uint8Array ||
      (typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array') ||
      isProtocolMessage(event.data))
  );
}

function isValidWebviewMessage(event: MessageEvent): boolean {
  return (
    event.data != null &&
    (event.data instanceof Uint8Array ||
      (typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array') ||
      isProtocolMessage(event.data))
  );
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Create the default product-side provider.
 *
 * Supports two environments:
 * - **iframe**: messages are sent to / received from the parent window.
 * - **webview**: messages travel through a `MessagePort` injected by the
 *   native host as `window.__HOST_API_PORT__`.
 */
export function createDefaultSdkProvider(): Provider {
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();
  const logger = createDefaultLogger('ProductProvider');

  const handleIframeMessage = (event: MessageEvent): void => {
    if (!isValidIframeMessage(event, getParentWindow(), window)) return;
    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  const handleWebviewMessage = (event: MessageEvent): void => {
    if (!isValidWebviewMessage(event)) return;
    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  // Wire up listeners immediately based on the detected environment
  if (isIframe()) {
    window.addEventListener('message', handleIframeMessage);
  } else if (isWebview()) {
    getWebviewPort().then(port => {
      port.onmessage = handleWebviewMessage;
    });
  }

  return {
    logger,

    isCorrectEnvironment(): boolean {
      return isIframe() || isWebview();
    },

    postMessage(message: Uint8Array | unknown): void {
      if (isIframe()) {
        if (message instanceof Uint8Array) {
          getParentWindow().postMessage(message, '*', [message.buffer]);
        } else {
          getParentWindow().postMessage(message, '*');
        }
      } else if (isWebview()) {
        getWebviewPort().then(port => {
          if (message instanceof Uint8Array) {
            port.postMessage(message, [message.buffer]);
          } else {
            port.postMessage(message);
          }
        });
      }
    },

    subscribe(callback: (message: Uint8Array | unknown) => void): () => void {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    dispose(): void {
      subscribers.clear();
      if (isIframe()) {
        window.removeEventListener('message', handleIframeMessage);
      }
      if (isWebview()) {
        getWebviewPort().then(port => {
          port.onmessage = null;
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

/**
 * Default product-side provider singleton.
 */
export const sandboxProvider: Provider = createDefaultSdkProvider();

/**
 * Default product-side transport singleton.
 *
 * Starts with the SCALE codec adapter for backwards compatibility.
 * After handshake, automatically attempts a codec upgrade to
 * structured clone. If the host supports it, both sides swap;
 * otherwise the connection stays on SCALE.
 */
export const sandboxTransport: Transport = wrapWithAutoCodecUpgrade(
  createTransport({
    provider: sandboxProvider,
    idPrefix: 'p:',
  }),
);

/**
 * Wraps a transport so that the first successful `isReady()` call
 * automatically triggers a codec upgrade attempt before resolving.
 */
function wrapWithAutoCodecUpgrade(transport: Transport): Transport {
  let upgradePromise: Promise<boolean> | null = null;

  return {
    ...transport,
    isReady(): Promise<boolean> {
      if (upgradePromise) return upgradePromise;

      upgradePromise = transport.isReady().then(async (ready) => {
        if (!ready) return false;

        await requestCodecUpgrade(transport, {
          scale: scaleCodecAdapter,
          structured_clone: structuredCloneCodecAdapter,
        });

        return true;
      });

      return upgradePromise;
    },
  };
}
