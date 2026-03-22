import { Enum } from '../primitives.js';
import { _void } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const NavigateToErr = Enum({
  PermissionDenied: _void,
  Unknown: GenericErr,
});

// -- Derived types ------------------------------------------------------------
