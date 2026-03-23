/**
 * Attestation service for lite person registration on the People parachain.
 *
 * Registers a new user on the People pallet by submitting a PeopleLite.attest
 * extrinsic with ring-VRF proofs. Follows triangle-js-sdks' attestation flow
 * exactly for wire compatibility.
 *
 * Dependencies:
 * - verifiablejs: WASM-based Bandersnatch ring-VRF (member_from_entropy, sign)
 * - polkadot-api: for submitting extrinsics
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { AccountId, Binary } from 'polkadot-api';
import { getPolkadotSigner } from 'polkadot-api/signer';
import type { PolkadotSigner } from 'polkadot-api/signer';
import { Bytes, Option, Tuple, str } from 'scale-ts';

import {
  createAccountId,
  createP256Secret,
  getP256PublicKey,
  deriveSr25519PublicKey,
  signWithSr25519,
  concatBytes,
} from './crypto.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttestationConfig = {
  /** Function returning the polkadot-api unsafe API for the People parachain. */
  getUnsafeApi: () => unknown;
};

export type DerivedAccount = {
  secret: Uint8Array;
  publicKey: Uint8Array;
  entropy: Uint8Array;
  sign: (message: Uint8Array) => Uint8Array;
};

// ---------------------------------------------------------------------------
// Username generation
// ---------------------------------------------------------------------------

function randomChars(len: number, alphabet: string): string {
  let result = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    result += alphabet[b % alphabet.length];
  }
  return result;
}

export function claimUsername(): string {
  const name = randomChars(4, 'abcdefghijklmnopqrstuvwxyz');
  const digits = randomChars(4, '0123456789');
  return `guest${name}.${digits}`;
}

// ---------------------------------------------------------------------------
// Sudo Alice verifier (testnet only)
// ---------------------------------------------------------------------------

import { createSr25519Secret } from './crypto.js';
import { mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';

export function createSudoAliceVerifier(): DerivedAccount {
  const mnemonic = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
  const entropy = mnemonicToEntropy(mnemonic);
  const secret = createSr25519Secret(entropy, '//Alice');
  const publicKey = deriveSr25519PublicKey(secret);
  return {
    secret,
    publicKey,
    entropy,
    sign: (message: Uint8Array) => signWithSr25519(secret, message),
  };
}

// ---------------------------------------------------------------------------
// People chain signer with custom signed extensions
// ---------------------------------------------------------------------------

function createPeopleSigner(account: DerivedAccount): PolkadotSigner {
  const baseSigner = getPolkadotSigner(account.publicKey, 'Sr25519', account.sign);

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      const extensionsWithCustom = {
        ...signedExtensions,
        VerifyMultiSignature: {
          identifier: 'VerifyMultiSignature',
          value: new Uint8Array([1]),
          additionalSigned: new Uint8Array([]),
        },
        AsPerson: {
          identifier: 'AsPerson',
          value: new Uint8Array([0]),
          additionalSigned: new Uint8Array([]),
        },
      };
      return baseSigner.signTx(callData, extensionsWithCustom, metadata, atBlockNumber, hasher);
    },
  };
}

// ---------------------------------------------------------------------------
// Attestation
// ---------------------------------------------------------------------------

/**
 * Run the attestation flow: grant verifier allowance + register lite person.
 *
 * This is CPU-intensive (VRF crypto) but runs while the user is scanning
 * the QR code, so the latency is masked by user interaction.
 *
 * @param candidate - The sr25519 account derived from the pairing mnemonic.
 * @param getUnsafeApi - Returns the polkadot-api unsafe API for the People parachain.
 * @param signal - Abort signal for cancellation.
 */
export async function runAttestation(
  candidate: DerivedAccount,
  getUnsafeApi: () => unknown,
  signal: AbortSignal,
): Promise<void> {
  // Lazy-load verifiablejs WASM (5.8 MB) — only when actually pairing
  const { member_from_entropy, sign: vrfSign } = await import('verifiablejs/bundler');

  if (signal.aborted) return;

  const accountId = AccountId();
  const api = getUnsafeApi() as {
    query?: {
      PeopleLite?: {
        AttestationAllowance?: {
          getValue?: (address: string) => Promise<number>;
        };
      };
    };
    tx?: {
      PeopleLite?: {
        increase_attestation_allowance?: (params: unknown) => { decodedCall: unknown };
        attest?: (params: unknown) => {
          signSubmitAndWatch: (signer: PolkadotSigner) => {
            subscribe: (observer: {
              next: (event: { type: string; ok?: boolean; dispatchError?: unknown }) => void;
              error: (err: unknown) => void;
            }) => { unsubscribe: () => void };
          };
        };
      };
      Sudo?: {
        sudo?: (params: unknown) => {
          signAndSubmit: (signer: PolkadotSigner) => Promise<void>;
        };
      };
    };
  };

  const verifier = createSudoAliceVerifier();
  const verifierAddress = accountId.dec(verifier.publicKey);
  const username = claimUsername();

  // 1. Grant verifier allowance if needed
  const allowance = await api.query?.PeopleLite?.AttestationAllowance?.getValue?.(verifierAddress);
  if (allowance !== undefined && allowance <= 0) {
    if (signal.aborted) return;
    const increaseCall = api.tx?.PeopleLite?.increase_attestation_allowance?.({
      account: verifierAddress,
      count: 10,
    });
    if (increaseCall && api.tx?.Sudo?.sudo) {
      const sudoCall = api.tx.Sudo.sudo({ call: increaseCall.decodedCall });
      await sudoCall.signAndSubmit(createPeopleSigner(verifier));
    }
  }

  if (signal.aborted) return;

  // 2. Derive attestation parameters
  const verifiableEntropy = blake2b(candidate.entropy, { dkLen: 32 });
  const ringVrfKey = member_from_entropy(verifiableEntropy);

  // Identifier key: P-256 public key from blake2b256 of candidate's secret
  const identifierKeySecret = createP256Secret(blake2b(candidate.secret, { dkLen: 32 }));
  const identifierKey = getP256PublicKey(identifierKeySecret);

  // Proof message
  const textEncoder = new TextEncoder();
  const proofMessage = concatBytes(
    textEncoder.encode('pop:people-lite:register using'),
    candidate.publicKey,
    ringVrfKey,
  );

  const candidateSignature = candidate.sign(proofMessage);
  const proofOfOwnership = vrfSign(verifiableEntropy, proofMessage);

  // Username without numeric suffix
  const usernameWithoutDigits = username.split('.')[0] ?? username;

  // Consumer registration signature
  const ResourceSignatureCodec = Tuple(Bytes(32), Bytes(32), Bytes(65), str, Option(Bytes()));
  const resourcesSignatureData = ResourceSignatureCodec.enc([
    candidate.publicKey,
    createAccountId(verifier.publicKey),
    identifierKey,
    usernameWithoutDigits,
    undefined,
  ]);
  const consumerRegistrationSignature = candidate.sign(resourcesSignatureData);

  if (signal.aborted) return;

  // 3. Submit attestation extrinsic
  const attestCall = api.tx?.PeopleLite?.attest?.({
    candidate: accountId.dec(candidate.publicKey),
    candidate_signature: {
      type: 'Sr25519',
      value: Binary.fromOpaque(candidateSignature),
    },
    ring_vrf_key: Binary.fromOpaque(ringVrfKey),
    proof_of_ownership: Binary.fromOpaque(proofOfOwnership),
    consumer_registration: {
      signature: {
        type: 'Sr25519',
        value: Binary.fromOpaque(consumerRegistrationSignature),
      },
      account: accountId.dec(candidate.publicKey),
      identifier_key: Binary.fromOpaque(identifierKey),
      username: Binary.fromText(username),
      reserved_username: undefined,
    },
  });

  if (!attestCall) {
    throw new Error('PeopleLite.attest not available on this chain');
  }

  await new Promise<void>((resolve, reject) => {
    const subscription = attestCall.signSubmitAndWatch(createPeopleSigner(verifier)).subscribe({
      next(event) {
        if (event.type === 'finalized') {
          subscription.unsubscribe();
          if (event.ok) {
            resolve();
          } else {
            reject(new Error('Attestation transaction failed'));
          }
        }
      },
      error(err) {
        subscription.unsubscribe();
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
}
