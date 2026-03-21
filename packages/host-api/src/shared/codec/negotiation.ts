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
 * @returns The format that was selected, or `undefined` if the upgrade
 *   failed and the transport stays on the current codec.
 */
export async function requestCodecUpgrade(
  transport: Transport,
  adapters: CodecAdapterMap,
): Promise<CodecFormat | undefined> {
  const supportedFormats = Object.keys(adapters) as CodecFormat[];
  if (supportedFormats.length === 0) return undefined;

  const request: CodecUpgradeRequest = { supportedFormats };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Codec upgrade timeout'), UPGRADE_TIMEOUT);

    const response = await transport.request('host_codec_upgrade', { tag: 'v1', value: request }, controller.signal);

    clearTimeout(timeout);

    const selectedFormat = response.value.selectedFormat as CodecFormat | undefined;

    if (!selectedFormat || !adapters[selectedFormat]) return undefined;

    // Swap the codec adapter on the product side.
    transport.swapCodecAdapter(adapters[selectedFormat]!);
    return selectedFormat;
  } catch {
    // MethodNotSupportedError, timeout, or abort — stay on current codec.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Host side: handle a codec upgrade request
// ---------------------------------------------------------------------------

/**
 * Register a handler for codec upgrade requests on the host side.
 *
 * When the product sends `host_codec_upgrade`, this handler picks
 * the best format from the intersection of what both sides support
 * and responds with the selection.
 *
 * If structured clone is selected, the host swaps its outgoing codec
 * BEFORE sending the response. This means the response itself arrives
 * as a structured clone message, which forces the product's transport
 * to auto-upgrade its outgoing codec via `decodeIncoming`. This
 * eliminates the race condition: even if the product's timeout has
 * already fired, the next message from the host (in structured clone)
 * will trigger the product's auto-upgrade.
 *
 * @param transport - The host-side transport.
 * @param adapters - Map of format → CodecAdapter the host supports.
 * @returns An unsubscribe function that removes the handler.
 */
export function handleCodecUpgrade(transport: Transport, adapters: CodecAdapterMap): () => void {
  const preference: CodecFormat[] = ['structured_clone', 'scale'];
  const fallbackResponse = { tag: 'v1', value: { selectedFormat: 'scale' } };

  return transport.listenMessages('host_codec_upgrade_request', (requestId, value) => {
    const envelope = value as { tag: string; value: CodecUpgradeRequest };
    const request = envelope?.value;

    if (!request?.supportedFormats) {
      transport.postMessage(requestId, {
        tag: 'host_codec_upgrade_response',
        value: fallbackResponse,
      });
      return;
    }

    const productFormats = new Set(request.supportedFormats);

    // Pick the best format from the intersection (structured_clone preferred).
    let selected: CodecFormat | undefined;
    for (const format of preference) {
      if (productFormats.has(format) && adapters[format]) {
        selected = format;
        break;
      }
    }

    if (!selected) {
      transport.postMessage(requestId, {
        tag: 'host_codec_upgrade_response',
        value: fallbackResponse,
      });
      return;
    }

    // Swap BEFORE sending the response so the response itself is
    // encoded with the new codec. The product's decodeIncoming will
    // detect the format and auto-upgrade its outgoing codec too.
    transport.swapCodecAdapter(adapters[selected]!);

    transport.postMessage(requestId, {
      tag: 'host_codec_upgrade_response',
      value: { tag: 'v1', value: { selectedFormat: selected } },
    });
  });
}
