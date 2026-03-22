import { Enum, Hex } from '../primitives.js';
import { Bytes } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const PreimageKey = Hex();
export const PreimageValue = Bytes();

// -- Errors -------------------------------------------------------------------

export const PreimageSubmitErr = Enum({
  Unknown: GenericErr,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type PreimageKeyType = CodecType<typeof PreimageKey>;
export type PreimageValueType = CodecType<typeof PreimageValue>;
