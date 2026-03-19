/**
 * Structured clone codec adapter.
 *
 * Identity pass-through: messages are sent as plain objects via the
 * structured clone algorithm (e.g. same-origin iframes using
 * `window.postMessage`). No serialisation overhead.
 */

import type { CodecAdapter, PostMessageData, ProtocolMessage } from '../adapter.js';

export const structuredCloneCodecAdapter: CodecAdapter = {
  encode(message: ProtocolMessage): PostMessageData {
    return message;
  },

  decode(data: PostMessageData): ProtocolMessage {
    if (data instanceof Uint8Array) {
      throw new Error('StructuredClone codec does not accept Uint8Array');
    }
    return data as ProtocolMessage;
  },
};
