/**
 * Shared utility tests.
 *
 * Tests for logger, request ID generation, delay, promiseWithResolvers,
 * composeAction, and extractErrorMessage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDefaultLogger,
  createIdFactory,
  delay,
  promiseWithResolvers,
  composeAction,
  extractErrorMessage,
  toHexString,
} from '@polkadot/api-protocol';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

describe('createDefaultLogger', () => {
  it('returns an object with info, warn, error, log, and withPrefix', () => {
    const logger = createDefaultLogger();

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.log).toBe('function');
    expect(typeof logger.withPrefix).toBe('function');
  });

  it('info calls console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createDefaultLogger();

    logger.info('hello', 'world');

    expect(spy).toHaveBeenCalledWith('', 'hello', 'world');
    spy.mockRestore();
  });

  it('warn calls console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createDefaultLogger();

    logger.warn('warning!');

    expect(spy).toHaveBeenCalledWith('', 'warning!');
    spy.mockRestore();
  });

  it('error calls console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDefaultLogger();

    logger.error('oh no');

    expect(spy).toHaveBeenCalledWith('', 'oh no');
    spy.mockRestore();
  });

  it('log calls console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createDefaultLogger();

    logger.log('debug');

    expect(spy).toHaveBeenCalledWith('', 'debug');
    spy.mockRestore();
  });

  it('with prefix prepends the prefix to every message', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createDefaultLogger('Transport');

    logger.info('connected');

    expect(spy).toHaveBeenCalledWith('[Transport]', 'connected');
    spy.mockRestore();
  });

  it('withPrefix creates a new logger with a different prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createDefaultLogger('Parent');
    const child = logger.withPrefix('Child');

    child.info('test');

    expect(spy).toHaveBeenCalledWith('[Child]', 'test');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createIdFactory
// ---------------------------------------------------------------------------

describe('createIdFactory', () => {
  it('returns a function that generates prefixed IDs', () => {
    const nextId = createIdFactory('h:');
    expect(nextId()).toBe('h:1');
    expect(nextId()).toBe('h:2');
    expect(nextId()).toBe('h:3');
  });

  it('two factories with different prefixes never collide', () => {
    const hostId = createIdFactory('h:');
    const productId = createIdFactory('p:');
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(hostId());
      ids.add(productId());
    }
    expect(ids.size).toBe(100);
  });

  it('each factory has its own counter', () => {
    const a = createIdFactory('a:');
    const b = createIdFactory('b:');
    expect(a()).toBe('a:1');
    expect(b()).toBe('b:1');
    expect(a()).toBe('a:2');
    expect(b()).toBe('b:2');
  });
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe('delay', () => {
  it('resolves after the specified timeout', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;

    // Allow some tolerance
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('resolves with undefined', async () => {
    const result = await delay(1);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// promiseWithResolvers
// ---------------------------------------------------------------------------

describe('promiseWithResolvers', () => {
  it('returns promise, resolve, and reject', () => {
    const { promise, resolve, reject } = promiseWithResolvers<string>();

    expect(promise).toBeInstanceOf(Promise);
    expect(typeof resolve).toBe('function');
    expect(typeof reject).toBe('function');
  });

  it('resolve settles the promise with the value', async () => {
    const { promise, resolve } = promiseWithResolvers<number>();

    resolve(42);

    const result = await promise;
    expect(result).toBe(42);
  });

  it('reject settles the promise with the error', async () => {
    const { promise, reject } = promiseWithResolvers<number>();

    reject(new Error('test error'));

    await expect(promise).rejects.toThrow('test error');
  });

  it('only the first settlement takes effect', async () => {
    const { promise, resolve, reject } = promiseWithResolvers<string>();

    resolve('first');
    resolve('second'); // Should be ignored
    reject(new Error('nope')); // Should be ignored

    const result = await promise;
    expect(result).toBe('first');
  });
});

// ---------------------------------------------------------------------------
// composeAction
// ---------------------------------------------------------------------------

describe('composeAction', () => {
  it('concatenates method and suffix with underscore', () => {
    expect(composeAction('host_account_get', 'request')).toBe('host_account_get_request');
    expect(composeAction('host_account_get', 'response')).toBe('host_account_get_response');
  });

  it('works with subscription actions', () => {
    expect(composeAction('counter', 'start')).toBe('counter_start');
    expect(composeAction('counter', 'stop')).toBe('counter_stop');
    expect(composeAction('counter', 'receive')).toBe('counter_receive');
    expect(composeAction('counter', 'interrupt')).toBe('counter_interrupt');
  });

  it('handles empty strings', () => {
    expect(composeAction('', 'suffix')).toBe('_suffix');
    expect(composeAction('method', '')).toBe('method_');
  });
});

// ---------------------------------------------------------------------------
// extractErrorMessage
// ---------------------------------------------------------------------------

describe('extractErrorMessage', () => {
  it('extracts message from Error instances', () => {
    expect(extractErrorMessage(new Error('test'))).toBe('test');
  });

  it('converts non-Error truthy values to string', () => {
    expect(extractErrorMessage('string error')).toBe('string error');
    expect(extractErrorMessage(42)).toBe('42');
  });

  it('returns default message for falsy values', () => {
    expect(extractErrorMessage(null)).toBe('Unknown error occurred.');
    expect(extractErrorMessage(undefined)).toBe('Unknown error occurred.');
    expect(extractErrorMessage('')).toBe('Unknown error occurred.');
    expect(extractErrorMessage(0)).toBe('Unknown error occurred.');
  });
});

// ---------------------------------------------------------------------------
// Common type helpers
// ---------------------------------------------------------------------------

describe('common type helpers', () => {
  describe('toHexString', () => {
    it('accepts valid hex strings', () => {
      const hex = toHexString('0xabcdef');
      expect(hex).toBe('0xabcdef');
    });

    it('rejects strings not starting with 0x', () => {
      expect(() => toHexString('abcdef')).toThrow('Expected hex string starting with 0x');
    });
  });
});
