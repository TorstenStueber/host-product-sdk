/**
 * No-op handlers for all chat methods.
 *
 * Returns unsupported/permission denied errors by default.
 * Hosts that support chat should override these.
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import { errAsync } from '@polkadot/host-api';

export function wireChatHandlers(container: ProtocolHandler): (() => void)[] {
  const cleanups: (() => void)[] = [];

  cleanups.push(
    container.handleChatCreateRoom(_params => {
      return errAsync({ tag: 'PermissionDenied', value: undefined });
    }),
  );

  cleanups.push(
    container.handleChatRegisterBot(_params => {
      return errAsync({ tag: 'PermissionDenied', value: undefined });
    }),
  );

  cleanups.push(
    container.handleChatListSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handleChatPostMessage(_params => {
      return errAsync({ tag: 'Unknown', value: { reason: 'Chat not supported' } });
    }),
  );

  cleanups.push(
    container.handleChatActionSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  // Note: product_chat_custom_message_render_subscribe is host-initiated
  // (via container.renderChatCustomMessage), not product-initiated, so
  // there is no handler to register here.

  return cleanups;
}
