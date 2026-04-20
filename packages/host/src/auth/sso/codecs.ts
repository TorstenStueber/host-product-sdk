/**
 * SSO SCALE codecs for pairing and signing messages.
 *
 * These must be byte-identical to triangle-js-sdks for mobile wallet
 * compatibility. The mobile app parses these exact SCALE encodings.
 *
 * The session-level `StatementData` envelope lives in
 * `statementStore/session/statementData.ts` (protocol-level, shared
 * between SSO and anything else layered on top of the session).
 */

import { Bytes, Enum, Option, Result, Struct, Tuple, Vector, _void, str, u32 } from 'scale-ts';
import { Hex, OptionBool } from '@polkadot/api-protocol';

// ---------------------------------------------------------------------------
// Handshake (pairing)
// ---------------------------------------------------------------------------

export const HandshakeData = Enum({
  v1: Struct({
    ssPublicKey: Bytes(32),
    encrPublicKey: Bytes(65),
    metadata: str,
    hostVersion: Option(str),
    osType: Option(str),
    osVersion: Option(str),
  }),
});

export const HandshakeResponsePayload = Enum({
  v1: Struct({ encrypted: Bytes(), tmpKey: Bytes(65) }),
});

export const HandshakeResponseSensitiveData = Tuple(Bytes(65), Bytes(32));

// ---------------------------------------------------------------------------
// Signing request/response
// ---------------------------------------------------------------------------

export const SigningPayloadRequestCodec = Struct({
  address: str,
  blockHash: Hex(),
  blockNumber: Hex(),
  era: Hex(),
  genesisHash: Hex(),
  method: Hex(),
  nonce: Hex(),
  specVersion: Hex(),
  tip: Hex(),
  transactionVersion: Hex(),
  signedExtensions: Vector(str),
  version: u32,
  assetId: Option(Hex()),
  metadataHash: Option(Hex()),
  mode: Option(u32),
  withSignedTransaction: OptionBool,
});

export const SigningRawRequestCodec = Struct({
  address: str,
  data: Enum({
    Bytes: Bytes(),
    Payload: str,
  }),
});

export const SigningRequestCodec = Enum({
  Payload: SigningPayloadRequestCodec,
  Raw: SigningRawRequestCodec,
});

export const SigningPayloadResponseDataCodec = Struct({
  signature: Bytes(),
  signedTransaction: Option(Bytes()),
});

export const SigningResponseCodec = Struct({
  respondingTo: str,
  payload: Result(SigningPayloadResponseDataCodec, str),
});

// ---------------------------------------------------------------------------
// Remote message (versioned envelope for SSO channel)
// ---------------------------------------------------------------------------

export const RemoteMessageCodec = Struct({
  messageId: str,
  data: Enum({
    v1: Enum({
      Disconnected: _void,
      SignRequest: SigningRequestCodec,
      SignResponse: SigningResponseCodec,
    }),
  }),
});

// ---------------------------------------------------------------------------
// Derived types (inferred from codecs via CodecType)
// ---------------------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type SigningPayloadRequest = CodecType<typeof SigningPayloadRequestCodec>;
export type SigningRawRequest = CodecType<typeof SigningRawRequestCodec>;
export type SigningPayloadResponseData = CodecType<typeof SigningPayloadResponseDataCodec>;
export type SigningResponse = CodecType<typeof SigningResponseCodec>;
export type RemoteMessage = CodecType<typeof RemoteMessageCodec>;
