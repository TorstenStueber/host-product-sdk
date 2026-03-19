import { Enum } from '../primitives.js';
import { Result, bool } from 'scale-ts';
import { GenericErr, GenesisHash } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const Feature = Enum({
  Chain: GenesisHash,
});

// -- V1 request / response codecs --------------------------------------------

export const FeatureV1_request = Feature;
export const FeatureV1_response = Result(bool, GenericErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type FeatureType = CodecType<typeof Feature>;
