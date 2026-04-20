/**
 * Public entry for the statement-store session layer.
 *
 * Re-exports are centralised here so the package `index.ts` has a
 * single import target. No logic lives in this file.
 */

export type {
  Session,
  SessionError,
  LocalSessionAccount,
  RemoteSessionAccount,
  StatementProver,
  Encryption,
  ResponseCode,
  Message,
  RequestMessage,
  ResponseMessage,
  Filter,
} from './types.js';

export { createSession } from './session.js';
export type { SessionParams } from './session.js';

export { createSr25519Prover } from './prover.js';

export { createSessionId, createRequestChannel, createResponseChannel } from './channels.js';

export { StatementDataCodec } from './statementData.js';
export type { StatementData } from './statementData.js';
