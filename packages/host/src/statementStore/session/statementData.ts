/**
 * SCALE codec for the session wire envelope.
 *
 * Matches triangle-js-sdks' `StatementData` byte-for-byte:
 *
 *   StatementData = Enum {
 *     request  (index 0): { requestId: str, data: Vector(Bytes()) }
 *     response (index 1): { requestId: str, responseCode: u8 }
 *   }
 *
 * The `responseCode` is a plain `u8`; our TypeScript layer maps it to
 * the {@link ResponseCode} string union. Unknown codes decode to
 * `'unknown'`, encoding `'unknown'` emits `0xff`.
 */

import { Bytes, Enum, Struct, Vector, enhanceCodec, str, u8, type CodecType } from 'scale-ts';
import type { ResponseCode } from './types.js';

const ResponseCodeCodec = enhanceCodec<number, ResponseCode>(
  u8,
  (status: ResponseCode) => {
    switch (status) {
      case 'success':
        return 0;
      case 'decryptionFailed':
        return 1;
      case 'decodingFailed':
        return 2;
      case 'unknown':
        return 255;
    }
  },
  (code: number): ResponseCode => {
    switch (code) {
      case 0:
        return 'success';
      case 1:
        return 'decryptionFailed';
      case 2:
        return 'decodingFailed';
      default:
        return 'unknown';
    }
  },
);

export const StatementDataCodec = Enum({
  request: Struct({
    requestId: str,
    data: Vector(Bytes()),
  }),
  response: Struct({
    requestId: str,
    responseCode: ResponseCodeCodec,
  }),
});

export type StatementData = CodecType<typeof StatementDataCodec>;
