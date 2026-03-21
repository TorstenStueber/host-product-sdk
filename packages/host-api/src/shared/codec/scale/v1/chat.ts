import { Enum, Status } from '../primitives.js';
import { Bytes, Option, Struct, Vector, _void, str, u64 } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Errors -------------------------------------------------------------------

export const ChatRoomRegistrationErr = Enum({
  PermissionDenied: _void,
  Unknown: GenericErr,
});

export const ChatBotRegistrationErr = Enum({
  PermissionDenied: _void,
  Unknown: GenericErr,
});

export const ChatMessagePostingErr = Enum({
  MessageTooLarge: _void,
  Unknown: GenericErr,
});

// -- Room / Bot ---------------------------------------------------------------

export const ChatRoomRequest = Struct({
  roomId: str,
  name: str,
  icon: str,
});

export const ChatRoomRegistrationStatus = Status('New', 'Exists');
export const ChatRoomRegistrationResult = Struct({
  status: ChatRoomRegistrationStatus,
});

export const ChatBotRequest = Struct({
  botId: str,
  name: str,
  icon: str,
});

export const ChatBotRegistrationStatus = Status('New', 'Exists');
export const ChatBotRegistrationResult = Struct({
  status: ChatBotRegistrationStatus,
});

// -- Room participation -------------------------------------------------------

export const ChatRoomParticipation = Status('RoomHost', 'Bot');

export const ChatRoom = Struct({
  roomId: str,
  participatingAs: ChatRoomParticipation,
});

// -- Message content types ----------------------------------------------------

export const ChatAction = Struct({
  actionId: str,
  title: str,
});

export const ChatActionLayout = Status('Column', 'Grid');

export const ChatActions = Struct({
  text: Option(str),
  actions: Vector(ChatAction),
  layout: ChatActionLayout,
});

export const ChatMedia = Struct({ url: str });

export const ChatRichText = Struct({
  text: Option(str),
  media: Vector(ChatMedia),
});

export const ChatFile = Struct({
  url: str,
  fileName: str,
  mimeType: str,
  sizeBytes: u64,
  text: Option(str),
});

export const ChatReaction = Struct({
  messageId: str,
  emoji: str,
});

export const ChatCustomMessage = Struct({
  messageType: str,
  payload: Bytes(),
});

export const ChatMessageContent = Enum({
  Text: str,
  RichText: ChatRichText,
  Actions: ChatActions,
  File: ChatFile,
  Reaction: ChatReaction,
  ReactionRemoved: ChatReaction,
  Custom: ChatCustomMessage,
});

export const ChatPostMessageResult = Struct({
  messageId: str,
});

// -- Action payloads ----------------------------------------------------------

export const ActionTrigger = Struct({
  messageId: str,
  actionId: str,
  payload: Option(Bytes()),
});

export const ChatCommand = Struct({
  command: str,
  payload: str,
});

export const ChatActionPayload = Enum({
  MessagePosted: ChatMessageContent,
  ActionTriggered: ActionTrigger,
  Command: ChatCommand,
});

export const ReceivedChatAction = Struct({
  roomId: str,
  peer: str,
  payload: ChatActionPayload,
});

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type ChatRoomRegistrationErrType = CodecType<typeof ChatRoomRegistrationErr>;
export type ChatBotRegistrationErrType = CodecType<typeof ChatBotRegistrationErr>;
export type ChatMessagePostingErrType = CodecType<typeof ChatMessagePostingErr>;
export type ChatRoomRequestType = CodecType<typeof ChatRoomRequest>;
export type ChatRoomRegistrationStatusType = CodecType<typeof ChatRoomRegistrationStatus>;
export type ChatRoomRegistrationResultType = CodecType<typeof ChatRoomRegistrationResult>;
export type ChatBotRequestType = CodecType<typeof ChatBotRequest>;
export type ChatBotRegistrationStatusType = CodecType<typeof ChatBotRegistrationStatus>;
export type ChatBotRegistrationResultType = CodecType<typeof ChatBotRegistrationResult>;
export type ChatRoomParticipationType = CodecType<typeof ChatRoomParticipation>;
export type ChatRoomType = CodecType<typeof ChatRoom>;
export type ChatActionType = CodecType<typeof ChatAction>;
export type ChatActionLayoutType = CodecType<typeof ChatActionLayout>;
export type ChatActionsType = CodecType<typeof ChatActions>;
export type ChatMediaType = CodecType<typeof ChatMedia>;
export type ChatRichTextType = CodecType<typeof ChatRichText>;
export type ChatFileType = CodecType<typeof ChatFile>;
export type ChatReactionType = CodecType<typeof ChatReaction>;
export type ChatCustomMessageType = CodecType<typeof ChatCustomMessage>;
export type ChatMessageContentType = CodecType<typeof ChatMessageContent>;
export type ChatPostMessageResultType = CodecType<typeof ChatPostMessageResult>;
export type ActionTriggerType = CodecType<typeof ActionTrigger>;
export type ChatCommandType = CodecType<typeof ChatCommand>;
export type ChatActionPayloadType = CodecType<typeof ChatActionPayload>;
export type ReceivedChatActionType = CodecType<typeof ReceivedChatAction>;
