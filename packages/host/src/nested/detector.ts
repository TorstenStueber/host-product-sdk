/**
 * Nested bridge detector.
 *
 * Listens for Uint8Array postMessage events from windows other than the
 * primary iframe. When a new source is detected, creates a full bridge
 * (Provider + Container + handlers) for that window.
 *
 * This enables nested dApps (dApp-in-dApp) to communicate with the host,
 * since all dApps send to window.top regardless of depth.
 *
 * Ported from dotli-clone/container.ts (setupNestedBridgeDetector).
 */

import { createContainer } from '../container/container.js';
import { wireAllHandlers, type HandlersConfig } from '../handlers/registry.js';
import { createWindowProvider } from '../container/windowProvider.js';

function isUint8ArrayLike(data: unknown): data is Uint8Array {
  if (data instanceof Uint8Array) return true;
  if (typeof data !== 'object' || data === null) return false;
  return (data as { constructor: { name: string } }).constructor.name === 'Uint8Array';
}

export type NestedBridgeDetectorOptions = {
  /** The primary iframe element whose messages are handled elsewhere. */
  primaryIframe: HTMLIFrameElement;
  /** Label for logging. */
  label: string;
  /** Handler configuration factory. Called for each new nested bridge. */
  createConfig: (nestedId: string) => HandlersConfig;
};

/**
 * Set up automatic detection and bridging of nested dApps.
 *
 * @returns A dispose function that tears down all nested bridges and
 *          stops listening for new ones.
 */
export function setupNestedBridgeDetector(options: NestedBridgeDetectorOptions): VoidFunction {
  const { primaryIframe, label, createConfig } = options;
  const knownWindows = new Set<MessageEventSource>();
  const disposers: VoidFunction[] = [];

  function messageHandler(event: MessageEvent): void {
    // Only handle protocol messages (Uint8Array)
    if (!isUint8ArrayLike(event.data)) return;
    // Skip messages from the primary iframe
    if (event.source === primaryIframe.contentWindow) return;
    // Skip messages from ourselves
    if (event.source === window) return;
    // Must have a source
    if (event.source === null) return;
    // Skip already-known nested windows
    if (knownWindows.has(event.source)) return;

    // New nested dApp detected
    knownWindows.add(event.source);
    const nestedId = String(knownWindows.size);
    console.warn(`[${label}] Nested dApp #${nestedId} detected, creating bridge`);

    const provider = createWindowProvider(event.source as Window);
    const container = createContainer({ provider });
    const config = createConfig(nestedId);
    const cleanup = wireAllHandlers(container, config);

    disposers.push(() => {
      cleanup();
      container.dispose();
    });
  }

  window.addEventListener('message', messageHandler);

  return () => {
    window.removeEventListener('message', messageHandler);
    for (const dispose of disposers) {
      dispose();
    }
    knownWindows.clear();
    disposers.length = 0;
  };
}
