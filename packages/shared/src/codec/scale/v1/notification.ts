import { Option, Result, Struct, _void, str } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Types --------------------------------------------------------------------

export const PushNotification = Struct({
  text: str,
  deeplink: Option(str),
});

// -- V1 request / response codecs --------------------------------------------

export const PushNotificationV1_request = PushNotification;
export const PushNotificationV1_response = Result(_void, GenericErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type PushNotificationType = CodecType<typeof PushNotification>;
