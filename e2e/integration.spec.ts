/**
 * E2E integration tests.
 *
 * Uses Playwright with a Vite dev server to run real host/product code
 * in actual browser iframes with real postMessage communication.
 *
 * Each test suite runs twice: once with structured clone codec and once
 * with SCALE codec, selected via `?codec=` query parameter.
 */
import { test, expect } from '@playwright/test';
import type { Page, Frame } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForHostReady(page: Page): Promise<void> {
  await page.waitForSelector('#status:has-text("host-ready")', { timeout: 10_000 });
}

async function getProductFrame(page: Page): Promise<Frame> {
  const frameElement = page.frameLocator('#product-frame');
  // Wait for product frame to be ready
  await frameElement.locator('#status:has-text("product-ready")').waitFor({ timeout: 10_000 });

  const frame = page.frame({ url: /product\.html/ });
  if (!frame) throw new Error('Product frame not found');
  return frame;
}

async function runProductTest(frame: Frame, testName: string): Promise<unknown> {
  return frame.evaluate(
    (name: string) => (window as unknown as { __e2e: { run: (name: string) => Promise<unknown> } }).__e2e.run(name),
    testName,
  );
}

async function getHostE2e(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const e2e = (window as unknown as { __e2e: Record<string, unknown> }).__e2e;
    return {
      ready: e2e.ready,
      signPayloadCalls: e2e.signPayloadCalls,
      signRawCalls: e2e.signRawCalls,
      storageBacking: e2e.storageBacking,
      connectionStatuses: e2e.connectionStatuses,
    };
  });
}

// ---------------------------------------------------------------------------
// Parameterized tests — run once per codec
// ---------------------------------------------------------------------------

const codecs = ['structured_clone', 'scale', 'upgrade'] as const;

for (const codec of codecs) {
  test.describe(`Host-Product E2E [${codec}]`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`http://localhost:3199/?codec=${codec}`);
      await waitForHostReady(page);
    });

    test('handshake completes and product becomes ready', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'waitReady');
      expect(result).toBe(true);
    });

    test('feature supported: known chain returns true', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'featureSupported_abc123') as Record<string, unknown>;
      expect(result).toMatchObject({ tag: 'v1', value: { success: true, value: true } });
    });

    test('feature supported: unknown chain returns false', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'featureSupported_unknown') as Record<string, unknown>;
      expect(result).toMatchObject({ tag: 'v1', value: { success: true, value: false } });
    });

    test('account get returns mock account', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'accountGet') as Record<string, unknown>;
      // Should be success with an account object
      const envelope = result as { tag: string; value: { tag: string; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(true);

      const account = envelope.value.value as { publicKey: unknown; name: string };
      expect(account.name).toBe('TestAccount');
      expect(account.publicKey).toBeDefined();
    });

    test('get non-product accounts returns array', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'getNonProductAccounts') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { tag: string; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(true);

      const accounts = envelope.value.value as { publicKey: unknown; name: string }[];
      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBe(1);
      expect(accounts[0]!.name).toBe('RootAccount');
    });

    test('sign payload: product sends request, host receives and returns signature', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'signPayload') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { tag: string; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(true);

      const sigResult = envelope.value.value as { signature: string; signedTransaction?: string | null };
      expect(sigResult.signature).toBe('0x' + 'ab'.repeat(64));
      expect(sigResult.signedTransaction).toBeFalsy();

      // Verify host received the call
      const hostState = await getHostE2e(page);
      expect((hostState.signPayloadCalls as unknown[]).length).toBe(1);
    });

    test('sign raw: returns signature', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'signRaw') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { tag: string; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(true);

      const sigResult = envelope.value.value as { signature: string };
      expect(sigResult.signature).toBe('0x' + 'cd'.repeat(64));

      const hostState = await getHostE2e(page);
      expect((hostState.signRawCalls as unknown[]).length).toBe(1);
    });

    test('local storage: write, read, clear cycle', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'localStorage') as Record<string, unknown>;

      const { readResult, readAfterClear } = result as {
        readResult: { tag: string; value: { tag: string; value: unknown } };
        readAfterClear: { tag: string; value: { tag: string; value: unknown } };
      };

      // Read after write should return the value
      expect(readResult.tag).toBe('v1');
      expect(readResult.value.success).toBe(true);
      expect(readResult.value.value).not.toBeNull();

      // Read after clear should return null/undefined
      expect(readAfterClear.tag).toBe('v1');
      expect(readAfterClear.value.success).toBe(true);
      expect(readAfterClear.value.value).toBeFalsy();
    });

    test('connection status subscription receives connected', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'connectionStatus') as unknown[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      // First status should be 'connected' (wrapped in v1 envelope by subscription)
      const first = result[0] as { tag?: string; value?: unknown } | string;
      const statusValue = typeof first === 'object' && first !== null && 'value' in first
        ? first.value
        : first;
      expect(statusValue).toBe('connected');
    });

    test('navigate to sends URL to host', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'navigateTo') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { tag: string; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(true);
    });

    test('device permission returns false (denied)', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'devicePermission') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { tag: string; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(true);
      expect(envelope.value.value).toBe(false);
    });

    // -- Error path tests -------------------------------------------------------

    test('sign payload: rejected error is transmitted correctly', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'signPayloadRejected') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { success: boolean; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(false);

      const err = envelope.value.value as { tag: string };
      expect(err.tag).toBe('Rejected');
    });

    test('create transaction: NotSupported error is transmitted correctly', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'createTransactionError') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { success: boolean; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(false);

      const err = envelope.value.value as { tag: string; value: string };
      expect(err.tag).toBe('NotSupported');
      expect(err.value).toBe('Not implemented in E2E');
    });

    test('account get alias: Unknown error with reason is transmitted correctly', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'accountGetAliasError') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { success: boolean; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(false);

      const err = envelope.value.value as { tag: string; value: { reason: string } };
      expect(err.tag).toBe('Unknown');
      expect(err.value.reason).toBe('Not supported');
    });

    test('navigate to: PermissionDenied error is transmitted correctly', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'navigateToBlocked') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { success: boolean; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(false);

      const err = envelope.value.value as { tag: string };
      expect(err.tag).toBe('PermissionDenied');
    });

    test('storage write: Full error is transmitted correctly', async ({ page }) => {
      const frame = await getProductFrame(page);
      const result = await runProductTest(frame, 'storageWriteFull') as Record<string, unknown>;

      const envelope = result as { tag: string; value: { success: boolean; value: unknown } };
      expect(envelope.tag).toBe('v1');
      expect(envelope.value.success).toBe(false);

      const err = envelope.value.value as { tag: string };
      expect(err.tag).toBe('Full');
    });

    // -- Misc tests -------------------------------------------------------------

    test('multiple sequential requests work correctly', async ({ page }) => {
      const frame = await getProductFrame(page);

      // Run multiple requests in sequence
      const r1 = await runProductTest(frame, 'accountGet');
      const r2 = await runProductTest(frame, 'featureSupported_abc123');
      const r3 = await runProductTest(frame, 'devicePermission');

      // All should succeed
      expect((r1 as { tag: string }).tag).toBe('v1');
      expect((r2 as { tag: string }).tag).toBe('v1');
      expect((r3 as { tag: string }).tag).toBe('v1');
    });
  });
}
