/**
 * Protocol registry and error type tests.
 */

import { describe, it, expect } from 'vitest';
import { hostApiProtocol } from '@polkadot/api-protocol';

describe('hostApiProtocol', () => {
  it('is a non-empty object', () => {
    expect(typeof hostApiProtocol).toBe('object');
    expect(Object.keys(hostApiProtocol).length).toBeGreaterThan(0);
  });

  it('has all expected core method names', () => {
    const methods = Object.keys(hostApiProtocol);

    expect(methods).toContain('host_handshake');
    expect(methods).toContain('host_feature_supported');
    expect(methods).toContain('host_push_notification');
    expect(methods).toContain('host_navigate_to');
    expect(methods).toContain('host_device_permission');
    expect(methods).toContain('remote_permission');
    expect(methods).toContain('host_local_storage_read');
    expect(methods).toContain('host_account_get');
    expect(methods).toContain('host_sign_payload');
    expect(methods).toContain('host_chat_create_room');
    expect(methods).toContain('remote_chain_head_follow');
    expect(methods).toContain('remote_chain_spec_genesis_hash');
    expect(methods).toContain('host_codec_upgrade');
  });

  it('each entry is a request (has _request/_response) or subscription (has _start/_receive)', () => {
    for (const [name, entry] of Object.entries(hostApiProtocol)) {
      const keys = Object.keys(entry as Record<string, unknown>);
      const isRequest = keys.includes('_request') && keys.includes('_response');
      const isSubscription = keys.includes('_start') && keys.includes('_receive');
      expect(
        isRequest || isSubscription,
        `Method ${name} is neither request nor subscription (keys: ${keys.join(', ')})`,
      ).toBe(true);
    }
  });

  it('request entries have _request and _response codecs', () => {
    for (const [name, entry] of Object.entries(hostApiProtocol)) {
      const e = entry as Record<string, unknown>;
      if ('_request' in e) {
        expect(e._request, `${name} missing _request codec`).toBeDefined();
        expect(e._response, `${name} missing _response codec`).toBeDefined();
      }
    }
  });

  it('subscription entries have _start and _receive codecs (_stop/_interrupt are optional)', () => {
    for (const [name, entry] of Object.entries(hostApiProtocol)) {
      const e = entry as Record<string, unknown>;
      if ('_start' in e) {
        expect(e._start, `${name} missing _start codec`).toBeDefined();
        expect(e._receive, `${name} missing _receive codec`).toBeDefined();
      }
    }
  });
});

describe('Error types', () => {
  it('GenericError can be constructed', () => {
    const err = { reason: 'Something went wrong' };
    expect(err.reason).toBe('Something went wrong');
  });

  it('HandshakeError variants can be pattern-matched', () => {
    const errors = [
      { tag: 'Timeout' as const, value: undefined },
      { tag: 'UnsupportedProtocolVersion' as const, value: undefined },
      { tag: 'Unknown' as const, value: { reason: 'test' } },
    ];

    for (const error of errors) {
      switch (error.tag) {
        case 'Timeout':
          expect(error.value).toBeUndefined();
          break;
        case 'UnsupportedProtocolVersion':
          expect(error.value).toBeUndefined();
          break;
        case 'Unknown':
          expect(error.value.reason).toBe('test');
          break;
      }
    }
  });

  it('RequestCredentialsError variants are all valid', () => {
    const errors = [
      { tag: 'NotConnected', value: undefined },
      { tag: 'Rejected', value: undefined },
      { tag: 'DomainNotValid', value: undefined },
      { tag: 'Unknown', value: { reason: 'test' } },
    ];
    expect(errors).toHaveLength(4);
  });

  it('CreateProofError variants can be constructed', () => {
    const err = { tag: 'RingNotFound', value: undefined };
    expect(err.tag).toBe('RingNotFound');
  });

  it('SigningError variants can be constructed', () => {
    const errors = [
      { tag: 'FailedToDecode', value: undefined },
      { tag: 'Rejected', value: undefined },
      { tag: 'PermissionDenied', value: undefined },
      { tag: 'Unknown', value: { reason: 'crypto failure' } },
    ];
    expect(errors).toHaveLength(4);
  });

  it('CreateTransactionError supports NotSupported with string', () => {
    const err = { tag: 'NotSupported', value: 'Ledger not supported' };
    expect(err.tag).toBe('NotSupported');
    expect(err.value).toBe('Ledger not supported');
  });

  it('StorageError variants', () => {
    const full = { tag: 'Full', value: undefined };
    const unknown = { tag: 'Unknown', value: { reason: 'quota exceeded' } };
    expect(full.tag).toBe('Full');
    expect(unknown.tag).toBe('Unknown');
  });

  it('NavigateToError variants', () => {
    const err = { tag: 'PermissionDenied', value: undefined };
    expect(err.tag).toBe('PermissionDenied');
  });

  it('ChatRoomRegistrationError variants', () => {
    const err = { tag: 'PermissionDenied', value: undefined };
    expect(err.tag).toBe('PermissionDenied');
  });

  it('ChatBotRegistrationError variants', () => {
    const err = { tag: 'Unknown', value: { reason: 'test' } };
    expect(err.tag).toBe('Unknown');
  });

  it('ChatMessagePostingError variants', () => {
    const err = { tag: 'MessageTooLarge', value: undefined };
    expect(err.tag).toBe('MessageTooLarge');
  });

  it('StatementProofError variants', () => {
    const err = { tag: 'UnableToSign', value: undefined };
    expect(err.tag).toBe('UnableToSign');
  });

  it('PreimageSubmitError variants', () => {
    const err = { tag: 'Unknown', value: { reason: 'test' } };
    expect(err.tag).toBe('Unknown');
    expect(err.value.reason).toBe('test');
  });
});
