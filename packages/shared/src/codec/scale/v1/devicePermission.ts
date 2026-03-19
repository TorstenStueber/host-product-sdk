import { Status } from '../primitives.js';
import { Result, bool } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const DevicePermissionRequest = Status('Camera', 'Microphone', 'Bluetooth', 'Location');

// -- V1 request / response codecs --------------------------------------------

export const DevicePermissionV1_request = DevicePermissionRequest;
export const DevicePermissionV1_response = Result(bool, GenericErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type DevicePermissionRequestType = CodecType<typeof DevicePermissionRequest>;
