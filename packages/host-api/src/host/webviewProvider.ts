/**
 * Electron webview-based provider (host side).
 *
 * Creates a MessageChannel, injects one end into the webview via
 * `executeJavaScript`, and wraps the other end with the shared
 * `createMessagePortProvider`.
 *
 * Ported from triangle-js-sdks host-container/createWebviewProvider.ts.
 */

import type { Provider } from '../shared/transport/provider.js';
import type { Logger } from '../shared/util/logger.js';
import { createMessagePortProvider } from '../shared/transport/messagePortProvider.js';
import { createIdFactory } from '../shared/util/idFactory.js';

const nextPortId = createIdFactory('port:');

const WEBVIEW_HOST_PORT_NAME = '__polkadot_host_port__';

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

export type CreateHostWebviewProviderParams = {
  webview: WebviewTag;
  logger?: Logger;
  openDevTools?: boolean;
};

/**
 * Acquire a MessagePort by injecting the other end into an Electron
 * `<webview>` tag.  Resolves once the webview's DOM is ready and the
 * port has been transferred.
 */
function acquireWebviewPort(
  webview: WebviewTag,
  openDevTools?: boolean,
): Promise<MessagePort> {
  return new Promise<MessagePort>((resolve, reject) => {
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

      (webview as unknown as { contentWindow: Window }).contentWindow.postMessage(
        portInitMessage,
        '*',
        [port2],
      );

      if (openDevTools) {
        webview.openDevTools();
      }

      resolve(port1);
    }) as (...args: unknown[]) => void);
  });
}

export function createHostWebviewProvider({
  webview,
  logger,
  openDevTools,
}: CreateHostWebviewProviderParams): Provider {
  return createMessagePortProvider(acquireWebviewPort(webview, openDevTools), logger);
}
