/**
 * Codec format negotiation.
 *
 * After the initial handshake (which always uses SCALE for backwards
 * compatibility) the product may request a codec upgrade via the
 * `host_codec_upgrade` protocol method.  The host responds with the
 * format it selected (intersection of what both sides support).
 *
 * If the upgrade times out or the host doesn't support it, the
 * connection stays on the current codec (typically SCALE).
 *
 * ## Compatibility matrix
 *
 * | Product | Host | Wire format                            |
 * |---------|------|----------------------------------------|
 * | Old     | Old  | SCALE                                  |
 * | Old     | New  | SCALE (old product never sends upgrade) |
 * | New     | Old  | SCALE (upgrade times out)               |
 * | New     | New  | Structured clone (upgrade succeeds)     |
 */

import type { CodecAdapter } from './adapter.js';
import type { Transport } from '../transport/transport.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wire-format identifiers. */
export type CodecFormat = 'scale' | 'structured_clone';

/** Sent by the product after handshake. */
export type CodecUpgradeRequest = {
  supportedFormats: CodecFormat[];
};

/** Returned by the host. */
export type CodecUpgradeResponse = {
  selectedFormat: CodecFormat;
};

/**
 * Maximum time (ms) to wait for the host to reply to a codec upgrade
 * request before falling back to the current format.
 */
export const UPGRADE_TIMEOUT = 1_000;

/**
 * Map from format name to the CodecAdapter that implements it.
 */
export type CodecAdapterMap = Partial<Record<CodecFormat, CodecAdapter>>;

// ---------------------------------------------------------------------------
// Product side: request a codec upgrade
// ---------------------------------------------------------------------------

/**
 * Request a codec upgrade from the product side.
 *
 * Call this AFTER the handshake has completed (`transport.isReady()`
 * returned `true`). Sends a `host_codec_upgrade` request with the
 * list of formats the product supports. If the host responds with a
 * format both sides support, both swap their codec adapters.
 *
 * If the request times out or the host returns an unknown format,
 * the transport stays on its current codec. This is safe — the
 * product just keeps using whatever it was using before.
 *
 * @param transport - The product-side transport (must be connected).
 * @param adapters - Map of format → CodecAdapter the product supports.
 * @returns The format that was selected, or `null` if the upgrade
 *   failed and the transport stays on the current codec.
 */
export async function requestCodecUpgrade(
  transport: Transport,
  adapters: CodecAdapterMap,
): Promise<CodecFormat | null> {
  const supportedFormats = Object.keys(adapters) as CodecFormat[];
  if (supportedFormats.length === 0) return null;

  const request: CodecUpgradeRequest = { supportedFormats };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Codec upgrade timeout'), UPGRADE_TIMEOUT);

    const response = await transport.request(
      'host_codec_upgrade',
      { tag: 'v1', value: request },
      controller.signal,
    ) as { tag: string; value: CodecUpgradeResponse } | undefined;

    clearTimeout(timeout);

    if (!response || typeof response !== 'object') return null;

    const inner = (response as { tag: string; value: unknown }).value as CodecUpgradeResponse | undefined;
    const selectedFormat = inner?.selectedFormat;

    if (!selectedFormat || !adapters[selectedFormat]) return null;

    // Swap the codec adapter on the product side.
    transport.swapCodecAdapter(adapters[selectedFormat]!);
    return selectedFormat;
  } catch {
    // Timeout, abort, or host doesn't support the method — stay on current codec.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Host side: handle a codec upgrade request
// ---------------------------------------------------------------------------

/**
 * Register a handler for codec upgrade requests on the host side.
 *
 * When the product sends `host_codec_upgrade`, this handler picks
 * the best format from the intersection of what both sides support,
 * responds with the selection, and swaps the transport's codec adapter.
 *
 * Uses low-level `listenMessages`/`postMessage` instead of
 * `handleRequest` so that the codec swap happens synchronously
 * AFTER the response is encoded and sent with the old codec.
 *
 * @param transport - The host-side transport.
 * @param adapters - Map of format → CodecAdapter the host supports.
 * @param preference - Ordered list of formats the host prefers
 *   (first = most preferred). Defaults to `['structured_clone', 'scale']`.
 * @returns An unsubscribe function that removes the handler.
 */
export function handleCodecUpgrade(
  transport: Transport,
  adapters: CodecAdapterMap,
  preference: CodecFormat[] = ['structured_clone', 'scale'],
): VoidFunction {
  return transport.listenMessages(
    'host_codec_upgrade_request',
    (requestId, requestPayload) => {
      const wrapped = requestPayload.value as { tag: string; value: CodecUpgradeRequest } | undefined;
      const request = wrapped?.value;

      if (!request?.supportedFormats) {
        // Malformed request — respond with fallback, no swap.
        transport.postMessage(requestId, {
          tag: 'host_codec_upgrade_response',
          value: { tag: 'v1', value: { selectedFormat: 'scale' as CodecFormat } },
        });
        return;
      }

      const productFormats = new Set(request.supportedFormats);

      // Pick the host's most preferred format that the product also supports.
      let selected: CodecFormat | undefined;
      for (const format of preference) {
        if (productFormats.has(format) && adapters[format]) {
          selected = format;
          break;
        }
      }

      if (!selected) {
        // No common format — respond with fallback, no swap.
        transport.postMessage(requestId, {
          tag: 'host_codec_upgrade_response',
          value: { tag: 'v1', value: { selectedFormat: 'scale' as CodecFormat } },
        });
        return;
      }

      const response: CodecUpgradeResponse = { selectedFormat: selected };

      // Send the response — this encodes with the CURRENT codec adapter.
      transport.postMessage(requestId, {
        tag: 'host_codec_upgrade_response',
        value: { tag: 'v1', value: response },
      });

      // Swap AFTER postMessage — the response was already encoded above.
      transport.swapCodecAdapter(adapters[selected]!);
    },
  );
}
