import { Enum } from '../primitives.js';
import { _void, str } from 'scale-ts';

// -- Types --------------------------------------------------------------------

export const RemotePermissionRequest = Enum({
  ExternalRequest: str,
  TransactionSubmit: _void,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type RemotePermissionRequestType = CodecType<typeof RemotePermissionRequest>;
