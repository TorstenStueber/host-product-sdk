import { Hex } from '../primitives.js';
import type { CodecType } from 'scale-ts';
import { Struct, str } from 'scale-ts';

export const GenesisHash = Hex();
export const GenericErr = Struct({ reason: str });

// -- Derived types ------------------------------------------------------------

export type GenericErrType = CodecType<typeof GenericErr>;
