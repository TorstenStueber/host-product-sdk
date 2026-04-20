/**
 * Session-topic and channel derivation.
 *
 * These helpers are protocol-level (shared between host and wallet in
 * SSO). Byte-for-byte compatible with triangle-js-sdks' formulas as
 * specified in `sso-protocol.md §4.1`:
 *
 *   outgoingSessionId = khash(key, "session" || accountA || accountB || "/" || "/")
 *   incomingSessionId = khash(key, "session" || accountB || accountA || "/" || "/")
 *   requestChannel    = khash(outgoingSessionId, "request")
 *   responseChannel   = khash(incomingSessionId, "response")
 *
 * The keying material is the ECDH-derived shared session secret, so the
 * two peers (swapping local ↔ remote) compute identical session IDs —
 * every outgoingSessionId on one side equals incomingSessionId on the
 * other. The `/`×2 suffix encodes two empty pins; a future protocol
 * revision could use non-empty pins for multi-slot peers without
 * changing this derivation.
 */

import { blake2b } from '@noble/hashes/blake2.js';

const textEncoder = new TextEncoder();
const SESSION_PREFIX = textEncoder.encode('session');
const PIN_SEPARATOR = textEncoder.encode('/');
const REQUEST_TAG = textEncoder.encode('request');
const RESPONSE_TAG = textEncoder.encode('response');

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function khash(key: Uint8Array, message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32, key });
}

function makePin(pin?: string): Uint8Array {
  return pin ? concat(PIN_SEPARATOR, textEncoder.encode(pin)) : PIN_SEPARATOR;
}

/**
 * Derive a session ID. The `sharedSecret` is the keyed-hash key; in
 * SSO this is the 32-byte ECDH-derived session key. `accountA` and
 * `accountB` are ordered — swapping them gives the opposite direction.
 */
export function createSessionId(
  sharedSecret: Uint8Array,
  accountA: { accountId: Uint8Array; pin?: string },
  accountB: { accountId: Uint8Array; pin?: string },
): Uint8Array {
  return khash(
    sharedSecret,
    concat(SESSION_PREFIX, accountA.accountId, accountB.accountId, makePin(accountA.pin), makePin(accountB.pin)),
  );
}

export function createRequestChannel(outgoingSessionId: Uint8Array): Uint8Array {
  return khash(outgoingSessionId, REQUEST_TAG);
}

export function createResponseChannel(incomingSessionId: Uint8Array): Uint8Array {
  return khash(incomingSessionId, RESPONSE_TAG);
}
