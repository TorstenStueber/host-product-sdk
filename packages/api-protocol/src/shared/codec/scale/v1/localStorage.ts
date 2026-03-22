import { Enum } from '../primitives.js';
import { Bytes, _void, str } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const StorageErr = Enum({
  Full: _void,
  Unknown: GenericErr,
});

// -- Key / Value --------------------------------------------------------------

export const StorageKey = str;
export const StorageValue = Bytes();

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type StorageKeyType = CodecType<typeof StorageKey>;
export type StorageValueType = CodecType<typeof StorageValue>;
