import { Enum } from '../primitives.js';
import { Result, _void, u8 } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

export const HandshakeErr = Enum({
  Timeout: _void,
  UnsupportedProtocolVersion: _void,
  Unknown: GenericErr,
});

export const HandshakeV1_request = u8;
export const HandshakeV1_response = Result(_void, HandshakeErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type HandshakeErrType = CodecType<typeof HandshakeErr>;
