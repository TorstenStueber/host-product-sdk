import { Enum } from '../primitives.js';
import { Result, _void, bool, str } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const RemotePermissionRequest = Enum({
  ExternalRequest: str,
  TransactionSubmit: _void,
});

// -- V1 request / response codecs --------------------------------------------

export const RemotePermissionV1_request = RemotePermissionRequest;
export const RemotePermissionV1_response = Result(bool, GenericErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type RemotePermissionRequestType = CodecType<typeof RemotePermissionRequest>;
