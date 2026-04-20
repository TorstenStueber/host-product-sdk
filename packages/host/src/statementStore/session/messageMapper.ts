/**
 * Translate a decoded {@link StatementData} into per-subscriber
 * {@link Message} objects, decoding each `request` payload through the
 * subscriber's codec.
 *
 * A single `StatementData::request` with N `data` elements produces N
 * `RequestMessage` objects sharing the same `requestId` with indexed
 * `localId`s. A `StatementData::response` produces a single
 * `ResponseMessage`.
 *
 * Payload decode failures are returned as `{ status: 'failed' }`
 * without throwing, so one bad element in a batch doesn't hide the
 * others.
 */

import type { Codec } from 'scale-ts';
import type { StatementData } from './statementData.js';
import type { Message, RequestMessage } from './types.js';

function decodePayload<T>(payload: Uint8Array, codec: Codec<T>): RequestMessage<T>['payload'] {
  try {
    return { status: 'parsed', value: codec.dec(payload) };
  } catch {
    return { status: 'failed', value: payload };
  }
}

export function toMessages<T>(data: StatementData, codec: Codec<T>): Message<T>[] {
  if (data.tag === 'request') {
    const { requestId, data: payloads } = data.value;
    return payloads.map<RequestMessage<T>>((payload, index) => ({
      type: 'request',
      localId: `${requestId}-${index}`,
      requestId,
      payload: decodePayload(payload, codec),
    }));
  }
  return [
    {
      type: 'response',
      localId: data.value.requestId,
      requestId: data.value.requestId,
      responseCode: data.value.responseCode,
    },
  ];
}
