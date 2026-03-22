/**
 * SCALE codec adapter.
 *
 * Wraps the protocol's `Message` codec into a `CodecAdapter` for use by
 * the transport layer.
 */

import type { Codec } from 'scale-ts';
import type { CodecAdapter, PostMessageData, ProtocolMessage } from '../adapter.js';
import { Message } from '../../../api/protocol.js';

export function createScaleCodecAdapter(
  messageCodec: Codec<{ requestId: string; payload: { tag: string; value: unknown } }>,
): CodecAdapter {
  return {
    encode(message: ProtocolMessage): PostMessageData {
      return messageCodec.enc(message) as Uint8Array;
    },
    decode(data: PostMessageData): ProtocolMessage {
      if (!(data instanceof Uint8Array)) {
        throw new Error('SCALE codec expects Uint8Array input');
      }
      return messageCodec.dec(data);
    },
  };
}

/** Ready-to-use SCALE codec adapter for the full protocol. */
export const scaleCodecAdapter = createScaleCodecAdapter(Message);
