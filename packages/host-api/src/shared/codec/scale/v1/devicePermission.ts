import { Status } from '../primitives.js';

// -- Types --------------------------------------------------------------------

export const DevicePermissionRequest = Status('Camera', 'Microphone', 'Bluetooth', 'Location');

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type DevicePermissionRequestType = CodecType<typeof DevicePermissionRequest>;
