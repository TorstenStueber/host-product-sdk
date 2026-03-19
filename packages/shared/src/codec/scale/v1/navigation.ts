import { Enum } from '../primitives.js';
import { Result, _void, str } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const NavigateToErr = Enum({
  PermissionDenied: _void,
  Unknown: GenericErr,
});

// -- V1 request / response codecs --------------------------------------------

export const NavigateToV1_request = str;
export const NavigateToV1_response = Result(_void, NavigateToErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type NavigateToErrType = CodecType<typeof NavigateToErr>;
export type NavigateToRequestType = CodecType<typeof NavigateToV1_request>;
