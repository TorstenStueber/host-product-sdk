import { Enum } from '../primitives.js';
import { GenesisHash } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const Feature = Enum({
  Chain: GenesisHash,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type FeatureType = CodecType<typeof Feature>;
