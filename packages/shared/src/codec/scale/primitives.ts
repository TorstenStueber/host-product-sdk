/**
 * SCALE codec primitives.
 *
 * Thin wrappers over scale-ts that provide Polkadot-specific conveniences:
 * Hex strings, nullable values, status enums, lazy codecs, and error enums.
 *
 * Previously provided by @novasamatech/scale — inlined here to remove
 * the external dependency.
 */

import type { Codec } from 'scale-ts';
import { Bytes, Enum, Option, createCodec, enhanceCodec, u8 } from 'scale-ts';

// Re-export Enum from scale-ts for use by protocol codec definitions.
export { Enum };

// ---------------------------------------------------------------------------
// OptionBool
// ---------------------------------------------------------------------------

/**
 * Optimized version of `Option(bool)` — encodes as a single u8:
 * 0 = undefined/null, 1 = false, 2 = true.
 */
export const OptionBool = enhanceCodec<number, boolean | void>(
  u8,
  value => {
    if (value === undefined) {
      return 0;
    }
    return value ? 2 : 1;
  },
  v => {
    switch (v) {
      case 0:
        return undefined;
      case 1:
        return false;
      case 2:
        return true;
      default:
        throw new Error(`Unknown value for OptionBool: ${v}. Should be 0, 1 or 2.`);
    }
  },
);

// ---------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------

export type HexString = `0x${string}`;

/**
 * Assert that a string is a valid hex string (`0x...`).
 */
export function toHexString(value: string): HexString {
  if (!value.startsWith('0x')) {
    throw new Error(`Expected hex string starting with 0x, got: ${value.slice(0, 20)}`);
  }
  return value as HexString;
}

function bytesToHex(bytes: Uint8Array): HexString {
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex as HexString;
}

function hexToBytes(hex: string): Uint8Array {
  const start = hex.startsWith('0x') ? 2 : 0;
  const length = (hex.length - start) >> 1;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.substring(start + i * 2, start + i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * SCALE codec for hex-encoded byte strings (`0x...`).
 */
export function Hex(length?: number): Codec<HexString> {
  return enhanceCodec(
    Bytes(length),
    hexToBytes as unknown as (v: HexString) => Uint8Array,
    bytesToHex,
  ) as unknown as Codec<HexString>;
}

// ---------------------------------------------------------------------------
// Nullable
// ---------------------------------------------------------------------------

/**
 * Like `Option` but uses `null` instead of `undefined` for the absent case.
 */
export function Nullable<T>(inner: Codec<T>): Codec<T | null> {
  return enhanceCodec(
    Option(inner),
    (v: T | null) => (v === null ? undefined : v) as T | undefined,
    (v: T | undefined) => (v === undefined ? null : v) as T | null,
  ) as unknown as Codec<T | null>;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Enum without values — maps string labels to u8 indices.
 */
export function Status<const T>(...list: T[]): Codec<T> {
  return enhanceCodec(
    u8,
    (v: unknown) => {
      const i = list.indexOf(v as T);
      if (i === -1) throw new Error(`Unknown status value: ${String(v)}`);
      return i;
    },
    (i: number) => {
      const v = list[i];
      if (v === undefined) throw new Error(`Unknown status index: ${i}`);
      return v;
    },
  ) as unknown as Codec<T>;
}

// ---------------------------------------------------------------------------
// lazy
// ---------------------------------------------------------------------------

/**
 * Deferred codec for recursive types.
 */
export function lazy<T>(fn: () => Codec<T>): Codec<T> {
  return createCodec(
    (v: T) => fn().enc(v),
    (v) => fn().dec(v),
  );
}

