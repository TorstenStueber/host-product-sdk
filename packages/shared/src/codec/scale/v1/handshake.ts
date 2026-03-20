import { Enum } from '../primitives.js';
import { _void } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

export const HandshakeErr = Enum({
  Timeout: _void,
  UnsupportedProtocolVersion: _void,
  Unknown: GenericErr,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type HandshakeErrType = CodecType<typeof HandshakeErr>;
