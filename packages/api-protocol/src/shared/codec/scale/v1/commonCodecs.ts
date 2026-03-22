import { Hex } from '../primitives.js';
import { Struct, str } from 'scale-ts';

export const GenesisHash = Hex();
export const GenericErr = Struct({ reason: str });

// -- Derived types ------------------------------------------------------------
