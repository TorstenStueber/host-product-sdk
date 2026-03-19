import { Enum, Hex, Nullable } from '../primitives.js';
import { Bytes, Result } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const PreimageKey = Hex();
export const PreimageValue = Bytes();

// -- Errors -------------------------------------------------------------------

export const PreimageSubmitErr = Enum({
  Unknown: GenericErr,
});

// -- V1 request / response codecs --------------------------------------------

// remote_preimage_lookup_subscribe
export const PreimageLookupV1_start = PreimageKey;
export const PreimageLookupV1_receive = Nullable(PreimageValue);

// remote_preimage_submit
export const PreimageSubmitV1_request = PreimageValue;
export const PreimageSubmitV1_response = Result(PreimageKey, PreimageSubmitErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type PreimageKeyType = CodecType<typeof PreimageKey>;
export type PreimageValueType = CodecType<typeof PreimageValue>;
export type PreimageSubmitErrType = CodecType<typeof PreimageSubmitErr>;
