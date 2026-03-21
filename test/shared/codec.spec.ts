/**
 * Codec adapter tests.
 */

import { describe, it, expect } from 'vitest';
import { structuredCloneCodecAdapter, createScaleCodecAdapter } from '@polkadot/host-api';
import type { ProtocolMessage } from '@polkadot/host-api';

describe('structuredCloneCodecAdapter', () => {
  const codec = structuredCloneCodecAdapter;

  it('encode/decode round-trip preserves message structure', () => {
    const message: ProtocolMessage = {
      requestId: 'abc12345',
      payload: { tag: 'test_action', value: { foo: 'bar', num: 42 } },
    };

    const encoded = codec.encode(message);
    const decoded = codec.decode(encoded);

    expect(decoded).toEqual(message);
    expect(decoded.requestId).toBe('abc12345');
    expect(decoded.payload.tag).toBe('test_action');
    expect(decoded.payload.value).toEqual({ foo: 'bar', num: 42 });
  });

  it('encode returns the message as-is (identity pass-through)', () => {
    const message: ProtocolMessage = {
      requestId: 'xyz',
      payload: { tag: 'action', value: null },
    };

    const encoded = codec.encode(message);
    expect(encoded).toBe(message);
  });

  it('decode rejects Uint8Array input', () => {
    const binaryData = new Uint8Array([1, 2, 3]);
    expect(() => codec.decode(binaryData)).toThrow('StructuredClone codec does not accept Uint8Array');
  });

  it('round-trip with nested objects', () => {
    const message: ProtocolMessage = {
      requestId: 'nested',
      payload: {
        tag: 'deep',
        value: { a: { b: { c: [1, 2, 3] } }, d: null, e: true },
      },
    };

    const decoded = codec.decode(codec.encode(message));
    expect(decoded).toEqual(message);
  });

  it('round-trip with undefined value', () => {
    const message: ProtocolMessage = {
      requestId: 'undef',
      payload: { tag: 'void_response', value: undefined },
    };

    const decoded = codec.decode(codec.encode(message));
    expect(decoded.requestId).toBe('undef');
    expect(decoded.payload.tag).toBe('void_response');
    expect(decoded.payload.value).toBeUndefined();
  });
});

describe('createScaleCodecAdapter', () => {
  it('is exported from shared package', () => {
    expect(typeof createScaleCodecAdapter).toBe('function');
  });
});
