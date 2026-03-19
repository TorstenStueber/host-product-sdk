/**
 * No-op handlers for all chat methods.
 *
 * Returns unsupported/permission denied errors by default.
 * Hosts that support chat should override these.
 */

import type { Container } from '../container/types.js';

export function wireChatHandlers(container: Container): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleChatCreateRoom((_params, ctx) => {
      return ctx.err({ tag: 'PermissionDenied', value: undefined });
    }),
  );

  cleanups.push(
    container.handleChatRegisterBot((_params, ctx) => {
      return ctx.err({ tag: 'PermissionDenied', value: undefined });
    }),
  );

  cleanups.push(
    container.handleChatListSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handleChatPostMessage((_params, ctx) => {
      return ctx.err({ tag: 'Unknown', value: { reason: 'Chat not supported' } });
    }),
  );

  cleanups.push(
    container.handleChatActionSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handleChatCustomMessageRenderSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  return cleanups;
}
