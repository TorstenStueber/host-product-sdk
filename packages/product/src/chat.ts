/**
 * Product chat manager.
 *
 * Provides an API for registering chat rooms and bots, sending messages,
 * subscribing to chat lists and actions, and handling custom message
 * rendering requests from the host.
 *
 * Ported from product-sdk/chat.ts, adapted to use the Transport
 * abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';

import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
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
// Helpers
// ---------------------------------------------------------------------------

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a product chat manager bound to a transport.
 *
 * @param transport - The transport to use. Defaults to the sandbox transport.
 */
export const createProductChatManager = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);
  const roomRegistrationStatus: Record<string, ChatRoomRegistrationStatus> = {};
  const botRegistrationStatus: Record<string, ChatBotRegistrationStatus> = {};

  const chat = {
    /**
     * Register a chat room with the host.
     * Returns the registration status ('New' or 'Exists').
     * Idempotent: repeated calls for the same roomId return the cached result.
     */
    async registerRoom(params: {
      roomId: string;
      name: string;
      icon: string;
    }): Promise<ChatRoomRegistrationStatus> {
      const existingRegistration = roomRegistrationStatus[params.roomId];
      if (existingRegistration) {
        return existingRegistration;
      }

      const result = await hostApi.chatCreateRoom(enumValue('v1', params));

      return result.match(
        (payload: { tag: string; value: unknown }) => {
          switch (payload.tag) {
            case 'v1': {
              const v = payload.value as { status: ChatRoomRegistrationStatus };
              roomRegistrationStatus[params.roomId] = v.status;
              return v.status;
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        (err: { tag: string; value: unknown }) => {
          throw err.value;
        },
      );
    },

    /**
     * Register a chat bot with the host.
     * Returns the registration status ('New' or 'Exists').
     * Idempotent: repeated calls for the same botId return the cached result.
     */
    async registerBot(params: {
      botId: string;
      name: string;
      icon: string;
    }): Promise<ChatBotRegistrationStatus> {
      const existingRegistration = botRegistrationStatus[params.botId];
      if (existingRegistration) {
        return existingRegistration;
      }

      const result = await hostApi.chatRegisterBot(enumValue('v1', params));

      return result.match(
        (payload: { tag: string; value: unknown }) => {
          switch (payload.tag) {
            case 'v1': {
              const v = payload.value as { status: ChatBotRegistrationStatus };
              botRegistrationStatus[params.botId] = v.status;
              return v.status;
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        (err: { tag: string; value: unknown }) => {
          throw err.value;
        },
      );
    },

    /**
     * Send a message to a chat room.
     * Returns the message ID assigned by the host.
     */
    async sendMessage(
      roomId: string,
      payload: ChatMessageContent,
    ): Promise<{ messageId: string }> {
      const result = await hostApi.chatPostMessage(
        enumValue('v1', { roomId, payload }),
      );

      return result.match(
        (payload: { tag: string; value: unknown }) => {
          switch (payload.tag) {
            case 'v1': {
              const v = payload.value as { messageId: string };
              return { messageId: v.messageId };
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        },
        (err: { tag: string; value: unknown }) => {
          throw err.value;
        },
      );
    },

    /**
     * Subscribe to the list of chat rooms the product participates in.
     */
    subscribeChatList(callback: (rooms: ChatRoom[]) => void) {
      return hostApi.chatListSubscribe(
        enumValue('v1', undefined),
        (action: { tag: string; value: unknown }) => {
          if (action.tag === 'v1') {
            callback(action.value as ChatRoom[]);
          }
        },
      );
    },

    /**
     * Subscribe to incoming chat actions (messages, triggers, commands).
     */
    subscribeAction(callback: (action: ReceivedChatAction) => void) {
      return hostApi.chatActionSubscribe(
        enumValue('v1', undefined),
        (action: { tag: string; value: unknown }) => {
          switch (action.tag) {
            case 'v1':
              callback(action.value as ReceivedChatAction);
              break;
            default:
              console.error(`Unknown message version ${action.tag}`);
          }
        },
      );
    },

    /**
     * Register a handler for custom message rendering requests from the host.
     *
     * When the host wants to render a custom chat message, it sends a
     * subscription request. The provided callback receives the message
     * parameters and a `render` function to push UI node updates.
     *
     * Returns an unsubscribe function.
     */
    onCustomMessageRenderingRequest(callback: ChatCustomMessageRenderer) {
      return transport.handleSubscription(
        'product_chat_custom_message_render_subscribe',
        (params, send, interrupt) => {
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
              subscribeActions(
                actionCallback: (
                  actionId: string,
                  payload: Uint8Array | undefined,
                ) => void,
              ) {
                const actionsSubscription = hostApi.chatActionSubscribe(
                  enumValue('v1', undefined),
                  (action: { tag: string; value: unknown }) => {
                    if (action.tag === 'v1') {
                      const received = action.value as ReceivedChatAction;
                      if (
                        received.payload.tag === 'ActionTriggered' &&
                        received.payload.value.messageId === messageId
                      ) {
                        actionCallback(
                          received.payload.value.actionId,
                          received.payload.value.payload ?? undefined,
                        );
                      }
                    }
                  },
                );

                return actionsSubscription.unsubscribe;
              },
            },
            (node: CustomRendererNode) => send(enumValue('v1', node)),
          );
        },
      );
    },
  };

  return chat;
};

// ---------------------------------------------------------------------------
// Matcher utility
// ---------------------------------------------------------------------------

/**
 * Create a ChatCustomMessageRenderer that dispatches to a specific renderer
 * based on the `messageType` field.
 *
 * @param map - A record mapping message type strings to renderer functions.
 */
export function matchChatCustomRenderers(
  map: Record<string, ChatCustomMessageRenderer>,
): ChatCustomMessageRenderer {
  return (params, render) => {
    const { messageType } = params;
    const renderer = map[messageType];

    if (!renderer) {
      throw new Error(
        `Renderer for message type ${messageType} is not defined`,
      );
    }

    return renderer(params, render);
  };
}
