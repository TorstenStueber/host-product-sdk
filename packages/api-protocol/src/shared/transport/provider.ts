/**
 * Provider interface.
 *
 * A Provider is the low-level communication channel between host and
 * product (e.g. an iframe `postMessage` bridge, a WebSocket, a
 * MessagePort, etc.).
 *
 * The transport layer sits on top of a Provider and adds
 * request/response correlation, subscription multiplexing, and codec
 * negotiation.
 */

/**
 * Describes how to reach the other side.
 *
 * Both `createHostFacade` and `createProductFacade` accept this type and
 * build the appropriate Provider internally.
 */
export type Messaging =
  | { type: 'window'; target: Window | Promise<Window> }
  | { type: 'messagePort'; port: MessagePort | Promise<MessagePort> };

export type Provider = {
  /**
   * Send data to the other side.
   *
   * Accepts both `Uint8Array` (binary codecs) and plain objects
   * (structured clone codec).
   */
  postMessage(message: Uint8Array | unknown): void;

  /**
   * Register a listener for incoming messages.
   *
   * Returns an unsubscribe function.
   */
  subscribe(callback: (message: Uint8Array | unknown) => void): () => void;

  /** Tear down the provider and release resources. */
  dispose(): void;
};
