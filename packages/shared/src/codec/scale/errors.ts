/**
 * Protocol error classes.
 *
 * Each error enum from the protocol has a corresponding namespace of error
 * classes that extend `Error` directly, matching the `CodecError` class
 * hierarchy from triangle-js-sdks `@novasamatech/scale`.
 *
 * Error class instances are used by host handlers (via `ctx.err(new X())`)
 * and received by product consumers after hydration in per-method wrappers.
 * On the wire, errors are always flattened to plain `{tag, value}` objects
 * since structured clone does not preserve custom Error properties.
 *
 * Each instance has:
 *   `.name`     — `'EnumName::VariantName'` (e.g. `'SigningErr::Rejected'`)
 *   `.message`  — human-readable message matching triangle-js-sdks
 *   `.instance` — variant name (e.g. `'Rejected'`)
 *   `.payload`  — inner value (matches `CodecError.payload` from triangle-js-sdks)
 *   `.tag`      — variant name (alias for `.instance`)
 *   `.value`    — inner value (alias for `.payload`)
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type VariantDef = {
  message: string | ((value: any) => string);
};

function createVariant(
  enumName: string,
  variantName: string,
  messageDef: string | ((value: any) => string),
): new (value?: any) => Error & { tag: string; value: unknown; payload: unknown; instance: string } {
  const fullName = `${enumName}::${variantName}`;
  return class extends Error {
    readonly tag: string = variantName;
    readonly value: unknown;
    readonly payload: unknown;
    readonly instance: string = variantName;
    constructor(value?: any) {
      const msg = typeof messageDef === 'function' ? messageDef(value) : messageDef;
      super(msg);
      this.name = fullName;
      this.value = value;
      this.payload = value;
    }
  } as any;
}

/** Instance type produced by any variant class within an error enum. */
type VariantInstance = Error & { tag: string; value: unknown; payload: unknown; instance: string };

type VariantMap<T extends Record<string, VariantDef>> = {
  [K in keyof T & string]: new (value?: any) => VariantInstance & { tag: K; instance: K };
};

function createErrorEnum<T extends Record<string, VariantDef>>(
  enumName: string,
  variants: T,
): VariantMap<T> & {
  fromPlain(plain: { tag: string; value: unknown }): VariantInstance;
} {
  const classes: Record<string, new (value?: any) => VariantInstance> = {};
  for (const [name, def] of Object.entries(variants)) {
    classes[name] = createVariant(enumName, name, def.message);
  }

  function fromPlain(plain: { tag: string; value: unknown }): VariantInstance {
    const Ctor = classes[plain.tag];
    if (Ctor) return new Ctor(plain.value);
    // Fallback for unknown variants — should not happen in practice
    const fallback = new Error(`${enumName}::${plain.tag}`) as VariantInstance;
    (fallback as any).tag = plain.tag;
    (fallback as any).value = plain.value;
    (fallback as any).payload = plain.value;
    (fallback as any).instance = plain.tag;
    fallback.name = `${enumName}::${plain.tag}`;
    return fallback;
  }

  return Object.assign(classes, { fromPlain }) as any;
}

// ---------------------------------------------------------------------------
// GenericError (standalone, not an enum — used for methods with { reason } errors)
// ---------------------------------------------------------------------------

export class GenericError extends Error {
  readonly tag: string = 'GenericError';
  readonly value: { reason: string };
  readonly payload: { reason: string };
  readonly instance: string = 'GenericError';
  constructor(data: { reason: string }) {
    super(`Unknown error: ${data.reason}`);
    this.name = 'GenericError';
    this.value = data;
    this.payload = data;
  }

  static fromPlain(plain: { reason: string }): GenericError {
    return new GenericError(plain);
  }
}

// ---------------------------------------------------------------------------
// Per-protocol error enums
// ---------------------------------------------------------------------------

export const HandshakeErr = createErrorEnum('HandshakeErr', {
  Timeout: { message: 'Handshake: timeout' },
  UnsupportedProtocolVersion: { message: 'Handshake: unsupported protocol version' },
  Unknown: { message: 'Handshake: unknown error' },
});

export const RequestCredentialsErr = createErrorEnum('RequestCredentialsErr', {
  NotConnected: { message: 'RequestCredentials: not connected' },
  Rejected: { message: 'RequestCredentials: rejected' },
  DomainNotValid: { message: 'RequestCredentials: domain not valid' },
  Unknown: { message: 'RequestCredentials: unknown error' },
});

export const CreateProofErr = createErrorEnum('CreateProofErr', {
  RingNotFound: { message: 'CreateProof: ring not found' },
  Rejected: { message: 'CreateProof: rejected' },
  Unknown: { message: 'CreateProof: unknown error' },
});

export const SigningErr = createErrorEnum('SigningErr', {
  FailedToDecode: { message: 'Failed to decode' },
  Rejected: { message: 'Rejected' },
  PermissionDenied: { message: 'Permission denied' },
  Unknown: { message: (v: { reason: string }) => v?.reason || 'Unknown error' },
});

export const CreateTransactionErr = createErrorEnum('CreateTransactionErr', {
  FailedToDecode: { message: 'Failed to decode' },
  Rejected: { message: 'Rejected' },
  NotSupported: { message: 'Not Supported' },
  PermissionDenied: { message: 'Permission denied' },
  Unknown: { message: 'Unknown error' },
});

export const StorageErr = createErrorEnum('StorageErr', {
  Full: { message: 'Storage is full' },
  Unknown: { message: 'Unknown storage error' },
});

export const NavigateToErr = createErrorEnum('NavigateToErr', {
  PermissionDenied: { message: 'Permission denied' },
  Unknown: { message: 'Unknown error' },
});

export const ChatRoomRegistrationErr = createErrorEnum('ChatRoomRegistrationErr', {
  PermissionDenied: { message: 'Permission denied' },
  Unknown: { message: 'Unknown error while chat registration' },
});

export const ChatBotRegistrationErr = createErrorEnum('ChatBotRegistrationErr', {
  PermissionDenied: { message: 'Permission denied' },
  Unknown: { message: 'Unknown error while chat registration' },
});

export const ChatMessagePostingErr = createErrorEnum('ChatMessagePostingErr', {
  MessageTooLarge: { message: 'ChatMessagePosting: message too large' },
  Unknown: { message: 'ChatMessagePosting: unknown error' },
});

export const StatementProofErr = createErrorEnum('StatementProofErr', {
  UnableToSign: { message: 'StatementProof: unable to sign' },
  UnknownAccount: { message: 'StatementProof: unknown account' },
  Unknown: { message: 'StatementProof: unknown error' },
});

export const PreimageSubmitErr = createErrorEnum('PreimageSubmitErr', {
  Unknown: { message: 'Unknown error' },
});
