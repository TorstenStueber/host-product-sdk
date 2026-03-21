import { Option, Struct, str } from 'scale-ts';

// -- Types --------------------------------------------------------------------

export const PushNotification = Struct({
  text: str,
  deeplink: Option(str),
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type PushNotificationType = CodecType<typeof PushNotification>;
