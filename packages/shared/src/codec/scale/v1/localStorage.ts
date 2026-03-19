import { Enum } from '../primitives.js';
import { Bytes, Option, Result, Tuple, _void, str } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const StorageErr = Enum({
  Full: _void,
  Unknown: GenericErr,
});

// -- Key / Value --------------------------------------------------------------

export const StorageKey = str;
export const StorageValue = Bytes();

// -- V1 request / response codecs --------------------------------------------

export const StorageReadV1_request = StorageKey;
export const StorageReadV1_response = Result(Option(StorageValue), StorageErr);

export const StorageWriteV1_request = Tuple(StorageKey, StorageValue);
export const StorageWriteV1_response = Result(_void, StorageErr);

export const StorageClearV1_request = StorageKey;
export const StorageClearV1_response = Result(_void, StorageErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type StorageErrType = CodecType<typeof StorageErr>;
export type StorageKeyType = CodecType<typeof StorageKey>;
export type StorageValueType = CodecType<typeof StorageValue>;
