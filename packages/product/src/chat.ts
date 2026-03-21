/**
 * Product chat manager.
 *
 * Provides an API for registering chat rooms and bots, sending messages,
 * and subscribing to chat lists and actions.
 *
 * Custom message rendering handler registration is handled separately
 * via `handleCustomMessageRendering()`, which registers a
 * `transport.handleSubscription` at the transport level rather than
 * burying it inside a domain module.
 *
 * Ported from product-sdk/chat.ts, adapted to use the HostApi facade.
 */

import type { ReceiveCodecType } from '@polkadot/host-api';

import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi } from '@polkadot/host-api';
import type {
  ChatBotRegistrationStatus,
  ChatCustomMessageRenderer,
  ChatMessageContent,
  ChatRoom,
  ChatRoomRegistrationStatus,
  CustomRendererNode,
  ReceivedChatAction,
} from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a product chat manager.
 *
 * @param hostApi - The HostApi instance to use. Defaults to the singleton.
 */
export const createProductChatManager = (hostApi: HostApi = defaultHostApi) => {
  const roomRegistrationStatus: Record<string, ChatRoomRegistrationStatus> = {};
  const botRegistrationStatus: Record<string, ChatBotRegistrationStatus> = {};

  return {
    /**
     * Register a chat room with the host.
     * Returns the registration status ('New' or 'Exists').
     * Idempotent: repeated calls for the same roomId return the cached result.
     */
    async registerRoom(params: { roomId: string; name: string; icon: string }): Promise<ChatRoomRegistrationStatus> {
      const existingRegistration = roomRegistrationStatus[params.roomId];
      if (existingRegistration) {
        return existingRegistration;
      }

      const result = await hostApi.chatCreateRoom(params);

      return result.match(
        payload => {
          roomRegistrationStatus[params.roomId] = payload.status;
          return payload.status;
        },
        err => {
          throw err;
        },
      );
    },

    /**
     * Register a chat bot with the host.
     * Returns the registration status ('New' or 'Exists').
     * Idempotent: repeated calls for the same botId return the cached result.
     */
    async registerBot(params: { botId: string; name: string; icon: string }): Promise<ChatBotRegistrationStatus> {
      const existingRegistration = botRegistrationStatus[params.botId];
      if (existingRegistration) {
        return existingRegistration;
      }

      const result = await hostApi.chatRegisterBot(params);

      return result.match(
        payload => {
          botRegistrationStatus[params.botId] = payload.status;
          return payload.status;
        },
        err => {
          throw err;
        },
      );
    },

    /**
     * Send a message to a chat room.
     * Returns the message ID assigned by the host.
     */
    async sendMessage(roomId: string, payload: ChatMessageContent): Promise<{ messageId: string }> {
      const result = await hostApi.chatPostMessage({ roomId, payload });

      return result.match(
        payload => {
          return { messageId: payload.messageId };
        },
        err => {
          throw err;
        },
      );
    },

    /**
     * Subscribe to the list of chat rooms the product participates in.
     */
    subscribeChatList(callback: (rooms: ChatRoom[]) => void) {
      return hostApi.chatListSubscribe(undefined, action => {
        callback(action);
      });
    },

    /**
     * Subscribe to incoming chat actions (messages, triggers, commands).
     */
    subscribeAction(callback: (action: ReceivedChatAction) => void) {
      return hostApi.chatActionSubscribe(undefined, action => {
        callback(action);
      });
    },
  };
};

// ---------------------------------------------------------------------------
// Custom message rendering handler
// ---------------------------------------------------------------------------

/**
 * Register a handler for custom message rendering requests from the host.
 *
 * When the host wants to render a custom chat message, it sends a
 * subscription request to the product. The provided callback receives
 * the message parameters and a `render` function to push UI node updates.
 *
 * This is the one protocol method where the product is the handler
 * rather than the initiator. It is registered at the transport level,
 * separate from the chat manager which only acts as a client.
 *
 * @param callback - The renderer callback.
 * @param hostApi - The HostApi instance for action subscriptions. Defaults to the singleton.
 * @param transport - The transport for handler registration. Defaults to the sandbox transport.
 * @returns An unsubscribe function.
 */
export function handleCustomMessageRendering(
  callback: ChatCustomMessageRenderer,
  hostApi: HostApi = defaultHostApi,
): () => void {
  return hostApi.handleHostSubscription('product_chat_custom_message_render_subscribe', (params, send, interrupt) => {
    const typed = params as { tag: string; value: unknown };
    if (typed.tag !== 'v1') {
      interrupt();
      return () => {
        /* empty */
      };
    }

    const { messageId, messageType, payload } = typed.value as {
      messageId: string;
      messageType: string;
      payload: Uint8Array;
    };

    return callback(
      {
        messageId,
        messageType,
        payload,
        subscribeActions(actionCallback: (actionId: string, payload: Uint8Array | undefined) => void) {
          const actionsSubscription = hostApi.chatActionSubscribe(undefined, action => {
            if (action.payload.tag === 'ActionTriggered' && action.payload.value.messageId === messageId) {
              actionCallback(action.payload.value.actionId, action.payload.value.payload ?? undefined);
            }
          });

          return actionsSubscription.unsubscribe;
        },
      },
      (node: CustomRendererNode) =>
        send({ tag: 'v1', value: node } as ReceiveCodecType<'product_chat_custom_message_render_subscribe'>),
    );
  });
}

// ---------------------------------------------------------------------------
// Matcher utility
// ---------------------------------------------------------------------------

/**
 * Create a ChatCustomMessageRenderer that dispatches to a specific renderer
 * based on the `messageType` field.
 *
 * @param map - A record mapping message type strings to renderer functions.
 */
export function matchChatCustomRenderers(map: Record<string, ChatCustomMessageRenderer>): ChatCustomMessageRenderer {
  return (params, render) => {
    const { messageType } = params;
    const renderer = map[messageType];

    if (!renderer) {
      throw new Error(`Renderer for message type ${messageType} is not defined`);
    }

    return renderer(params, render);
  };
}
