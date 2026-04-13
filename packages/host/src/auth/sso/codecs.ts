/**
 * SSO SCALE codecs for pairing and signing messages.
 *
 * These must be byte-identical to triangle-js-sdks for mobile wallet
 * compatibility. The mobile app parses these exact SCALE encodings.
 */

import { Bytes, Enum, Option, Result, Struct, Tuple, Vector, _void, enhanceCodec, str, u8, u32 } from 'scale-ts';
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
// Statement data (session-level wrapper from triangle-js-sdks statement-store)
// ---------------------------------------------------------------------------

const ResponseCode = enhanceCodec<number, string>(
  u8,
  (status: string) => {
    switch (status) {
      case 'success':
        return 0;
      case 'decryptionFailed':
        return 1;
      case 'decodingFailed':
        return 2;
      default:
        return 255;
    }
  },
  (code: number) => {
    switch (code) {
      case 0:
        return 'success';
      case 1:
        return 'decryptionFailed';
      case 2:
        return 'decodingFailed';
      default:
        return 'unknown';
    }
  },
);

export const StatementDataCodec = Enum({
  request: Struct({
    requestId: str,
    data: Vector(Bytes()),
  }),
  response: Struct({
    requestId: str,
    responseCode: ResponseCode,
  }),
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
