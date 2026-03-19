/**
 * Electron webview-based provider.
 *
 * Creates a Provider from an Electron `<webview>` tag, using MessageChannel
 * for bidirectional communication.
 *
 * Ported from triangle-js-sdks host-container/createWebviewProvider.ts.
 */

import type { Provider, Logger } from '@polkadot/shared';
import { createDefaultLogger, createIdFactory } from '@polkadot/shared';

const nextPortId = createIdFactory('port:');

const WEBVIEW_HOST_PORT_NAME = '__polkadot_host_port__';

function hasWindow(): boolean {
  try {
    return typeof window !== 'undefined';
  } catch {
    return false;
  }
}

function isValidMessage(event: MessageEvent): boolean {
  return (
    event.data != null &&
    (event.data instanceof Uint8Array ||
      (typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array'))
  );
}

/**
 * Electron's WebviewTag type. We define a minimal interface here to avoid
 * requiring the `electron` dependency at the type level.
 */
export type WebviewTag = HTMLElement & {
  addEventListener(event: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
  executeJavaScript(code: string): Promise<unknown>;
  openDevTools(): void;
  contentWindow: Window;
};

export type CreateWebviewProviderParams = {
  webview: WebviewTag;
  logger?: Logger;
  openDevTools?: boolean;
};

export function createWebviewProvider({ webview, logger, openDevTools }: CreateWebviewProviderParams): Provider {
  let disposed = false;
  let port: MessagePort | null = null;
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();

  const webviewPromise = new Promise<MessagePort>((resolve, reject) => {
    webview.addEventListener('did-fail-load', ((e: { errorDescription: string }) => {
      reject(new Error(e.errorDescription));
    }) as (...args: unknown[]) => void);

    webview.addEventListener('dom-ready', (async () => {
      const { port1, port2 } = new MessageChannel();
      const portInitMessage = `HOST_API_PORT_INIT_${nextPortId()}`;

      await webview
        .executeJavaScript(
          `
            window.addEventListener('message', e => {
              if (e.data === '${portInitMessage}') {
                const port = e.ports[0];
                if (port) {
                  window['${WEBVIEW_HOST_PORT_NAME}'] = port;
                }
              }
            });
          `,
        )
        .catch(reject);

      (webview as unknown as { contentWindow: Window }).contentWindow.postMessage(portInitMessage, '*', [port2]);

      if (openDevTools) {
        webview.openDevTools();
      }

      port = port1;
      port.start();
      port.addEventListener('message', messageHandler);
      resolve(port);
    }) as (...args: unknown[]) => void);
  });

  function waitForWebview(callback: (port: MessagePort) => void): void {
    if (port) {
      return callback(port);
    }
    webviewPromise.then(callback);
  }

  const messageHandler = (event: MessageEvent): void => {
    if (disposed) return;
    if (!isValidMessage(event)) return;

    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  return {
    logger: logger ?? createDefaultLogger(),

    isCorrectEnvironment() {
      return hasWindow();
    },

    postMessage(message) {
      if (disposed) return;

      waitForWebview((p) => {
        if (disposed) return;

        if (message instanceof Uint8Array) {
          p.postMessage(message, [message.buffer]);
        } else {
          p.postMessage(message);
        }
      });
    },

    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    dispose() {
      disposed = true;
      subscribers.clear();

      if (port) {
        port.removeEventListener('message', messageHandler);
      }
      port = null;
    },
  };
}
