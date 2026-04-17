/**
 * Product storage tests.
 *
 * Tests for createLocalStorage factory. Since the actual implementation
 * delegates to a host transport, we verify the API shape and that the
 * factory produces the expected interface.
 */

import { describe, it, expect } from 'vitest';
import { createLocalStorage } from '@polkadot/product';

describe('createLocalStorage', () => {
  it('is a function', () => {
    expect(typeof createLocalStorage).toBe('function');
  });

  it('returns an object with all expected methods', () => {
    const storage = createLocalStorage({} as any);

    expect(typeof storage.clear).toBe('function');
    expect(typeof storage.readBytes).toBe('function');
    expect(typeof storage.writeBytes).toBe('function');
    expect(typeof storage.readString).toBe('function');
    expect(typeof storage.writeString).toBe('function');
    expect(typeof storage.readJSON).toBe('function');
    expect(typeof storage.writeJSON).toBe('function');
  });

  it('each method returns a promise', () => {
    const storage = createLocalStorage({} as any);

    // These will fail because the sandbox transport is not connected,
    // but they should return promises regardless.
    const clearResult = storage.clear('key');
    const readResult = storage.readBytes('key');
    const writeResult = storage.writeBytes('key', new Uint8Array([1]));
    const readStringResult = storage.readString('key');
    const writeStringResult = storage.writeString('key', 'value');
    const readJsonResult = storage.readJSON('key');
    const writeJsonResult = storage.writeJSON('key', { a: 1 });

    expect(clearResult).toBeInstanceOf(Promise);
    expect(readResult).toBeInstanceOf(Promise);
    expect(writeResult).toBeInstanceOf(Promise);
    expect(readStringResult).toBeInstanceOf(Promise);
    expect(writeStringResult).toBeInstanceOf(Promise);
    expect(readJsonResult).toBeInstanceOf(Promise);
    expect(writeJsonResult).toBeInstanceOf(Promise);

    // Suppress unhandled rejections (these will fail due to no transport)
    clearResult.catch(() => {});
    readResult.catch(() => {});
    writeResult.catch(() => {});
    readStringResult.catch(() => {});
    writeStringResult.catch(() => {});
    readJsonResult.catch(() => {});
    writeJsonResult.catch(() => {});
  });
});
