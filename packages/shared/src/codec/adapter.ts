/**
 * CodecAdapter interface.
 *
 * Abstracts the wire encoding so that the transport layer does not care
 * whether messages travel as SCALE-encoded Uint8Arrays or as structured
 * clone objects. During codec negotiation the adapter can be swapped at
 * runtime.
 */

/**
 * The on-the-wire shape of every protocol message.
 *
 * `requestId` correlates requests with responses (and subscription
 * frames with their originating start message).
 * `payload` is a tagged union whose tag is the protocol action
 * (e.g. `host_handshake_request`, `host_account_get_response`).
 */
export type ProtocolMessage = {
  requestId: string;
  payload: { tag: string; value: unknown };
};

/**
 * The data that travels over `postMessage` / the provider channel.
 *
 * - `Uint8Array` when using a binary codec (SCALE).
 * - `ProtocolMessage` when using structured clone (same-origin iframes).
 */
export type PostMessageData = Uint8Array | ProtocolMessage;

/**
 * A codec adapter encodes ProtocolMessages into a wire format and
 * decodes incoming wire data back into ProtocolMessages.
 */
export interface CodecAdapter {
  /** Encode a protocol message for transmission. */
  encode(message: ProtocolMessage): PostMessageData;

  /** Decode incoming wire data into a protocol message. */
  decode(data: PostMessageData): ProtocolMessage;
}
