# SSO Pairing and Remote Signing — Design Document

## Purpose

This document describes the SSO system that allows a host web application to authenticate a user via their Polkadot
mobile wallet and subsequently request transaction signatures from that wallet. The user's private keys never leave the
mobile device.

---

## Actors

- **Host**: A web application (e.g., dot.li) running in the browser. Embeds product dApps in iframes and manages the
  user's session.
- **Wallet**: The Polkadot mobile app (Nova Wallet / "papp"). Holds the user's private keys and signs transactions on
  request.
- **Statement store**: A decentralized off-chain message bus hosted by nodes on the People parachain. Routes signed,
  topic-addressed messages between the host and wallet. Neither actor talks to the other directly — all communication is
  mediated by the statement store.
- **People parachain**: The blockchain that hosts the statement store and on-chain identity registry. The host connects
  to it via a single JSON-RPC provider (WebSocket or Smoldot light client).

---

## Overview

The system has two phases:

1. **Pairing**: A one-time QR-code-based handshake that establishes a shared secret and persistent session between the
   host and wallet.
2. **Remote signing**: An ongoing encrypted message exchange that lets the host request transaction signatures from the
   wallet on behalf of embedded product dApps.

Both phases use the statement store as the transport layer. Messages are SCALE-encoded, AES-GCM encrypted, and published
as signed statements with topic-based routing.

---

## Cryptographic Primitives

Two key types serve complementary roles:

- **Sr25519** (Schnorr on Ristretto255): Substrate-native signing. Used for identity, statement proofs, and on-chain
  operations. Keys are derived from BIP-39 entropy via the Substrate-specific PBKDF2 derivation (`entropyToMiniSecret`),
  then optionally through HDKD hard/soft junctions.
- **P-256** (secp256r1 / NIST P-256): Encryption key agreement. Used for ECDH to establish symmetric AES keys. Chosen
  for broad hardware support on mobile devices. Keys are derived from the same BIP-39 entropy.

Symmetric encryption uses **AES-256-GCM** with keys derived via **HKDF-SHA256** (empty salt, empty info) from the ECDH
shared secret. Each message gets a fresh random 12-byte nonce. Wire format: `nonce(12) || ciphertext || tag(16)`.

Topic and session ID derivation uses **blake2b-256 with keyed hashing** (`khash(key, message)` =
`blake2b(message, key=key, dkLen=32)`).

---

## Phase 1: Pairing

### Goal

Establish a shared 32-byte AES session key between the host and wallet, authenticated by the wallet's long-term P-256
public key.

### Identity Generation

The host generates a fresh BIP-39 mnemonic and converts it to 16 bytes of entropy. From this single entropy source, it
derives:

- An sr25519 keypair at derivation path `//wallet//sso` (for signing statement proofs)
- A P-256 keypair (for ECDH key agreement)

The sr25519 public key serves as the host's **account ID** — a 32-byte value used in topic derivation and session
identification. The account ID is the raw public key with no hashing.

### QR Code

The host SCALE-encodes a `HandshakeData.v1` structure containing:

| Field           | Size            | Purpose                                         |
| --------------- | --------------- | ----------------------------------------------- |
| `ssPublicKey`   | 32 bytes        | Sr25519 public key (identity)                   |
| `encrPublicKey` | 65 bytes        | P-256 uncompressed public key (for ECDH)        |
| `metadata`      | string          | URL to host metadata JSON (displayed on wallet) |
| `hostVersion`   | optional string | Host application version                        |
| `osType`        | optional string | Operating system type                           |
| `osVersion`     | optional string | Operating system version                        |

This is hex-encoded into a deeplink: `polkadotapp://pair?handshake={hex}`.

### Topic Derivation

Both sides must independently derive the same handshake topic so they can find each other on the statement store. The
formula is:

```
handshakeTopic = khash(accountId, encrPublicKey || "topic")
```

The host subscribes to this topic before displaying the QR code. The wallet derives the same topic from the
HandshakeData after scanning, and publishes its response to it.

### Handshake Response

The wallet generates an **ephemeral** P-256 keypair (used only for this handshake). It performs ECDH between its
ephemeral secret key and the host's `encrPublicKey` to derive a temporary symmetric key, then encrypts its sensitive
data:

- Wallet's **long-term** P-256 public key (65 bytes, uncompressed) — used by the host for the second ECDH that produces
  the persistent session key.
- Wallet's sr25519 account ID (32 bytes, raw public key) — the wallet's on-chain identity, used by the host for session
  ID derivation, product account derivation, and identity resolution.

The response, published to the handshake topic, contains:

| Field       | Size     | Purpose                                                          |
| ----------- | -------- | ---------------------------------------------------------------- |
| `encrypted` | variable | AES-GCM encrypted long-term P-256 public key + account ID        |
| `tmpKey`    | 65 bytes | Wallet's ephemeral P-256 public key (for decrypting `encrypted`) |

### Session Key Establishment

The host receives the response and performs two sequential ECDH operations:

1. **Ephemeral ECDH**: `ECDH(hostEncrSecret, tmpKey)` produces a temporary symmetric key. The host decrypts the
   `encrypted` blob to extract the wallet's long-term P-256 public key and account ID.

2. **Long-term ECDH**: `ECDH(hostEncrSecret, walletP256PublicKey)` produces the **session key** — a 32-byte shared
   secret that persists for the lifetime of the pairing. All future encrypted communication uses this key.

The ephemeral key exchange protects the handshake response (an observer who intercepts the QR code cannot derive the
temporary key without the wallet's ephemeral secret). The long-term key exchange establishes a persistent shared secret
known only to the host and wallet.

### Persistence

The host stores two records in browser localStorage:

- **Session metadata** (key `sso_session`): wallet SS58 address, truncated address for display (e.g., `"5Grwva...utQY"`
  — a UI label used before identity resolution provides a proper username), session key (the P-256 shared secret),
  wallet account ID, and a storage key string `{localAccountIdHex}_{remoteAccountIdHex}` used to look up the
  corresponding secrets entry.
- **Cryptographic secrets** (key `sso_secrets_{storageKey}`): sr25519 secret key, P-256 secret key, BIP-39 entropy.

Note: this storage key string is unrelated to the `outgoingSessionId`/`incomingSessionId` described under Remote Signing
— those are 32-byte cryptographic hashes used for statement store topic routing.

On page reload, the host restores the session from localStorage without repeating the handshake. If session metadata
exists but secrets are missing (orphaned session), the metadata is cleared.

---

## Attestation (testnet only)

Attestation registers a new "lite person" identity on the People parachain so the user gets statement store quota. It
runs **in parallel** with the pairing handshake — while the user is scanning the QR code, the host is computing VRF
proofs and submitting the attestation extrinsic.

**This is a testnet convenience, not a production feature.** The current implementation uses the well-known Alice sudo
account as the attestation verifier, hardcodes her mnemonic, and tops up her attestation allowance via `Sudo.sudo` if
needed. None of this works on a production chain where sudo doesn't exist.

On a real network, attestation requires a governance-authorized verifier — a trusted entity that has been granted
attestation allowance through a governance process and has independently verified the candidate's personhood (via the
People-Lite pallet's `attest` extrinsic in the Individuality system). The host SDK cannot self-attest. Users would need
to have been attested before pairing, or the host would need to skip attestation and rely on the user already having an
on-chain identity with statement store quota.

The testnet attestation process:

1. Lazy-load a Bandersnatch ring-VRF WASM module (~5.8 MB)
2. Derive a VRF key and P-256 identifier key from the entropy
3. Compute proof-of-ownership and ring-VRF signatures
4. Generate a random username (`guestXXXX.YYYY`)
5. Check the Alice verifier's attestation allowance; if depleted, top up via
   `Sudo.sudo(PeopleLite.increase_attestation_allowance)`
6. Submit a `PeopleLite.attest` extrinsic with custom signed extensions (`VerifyMultiSignature`, `AsPerson`)

Attestation is **non-fatal** — pairing succeeds regardless of whether attestation completes. However, without
attestation (or an equivalent quota mechanism), the host's sr25519 signer account has no statement store allowance and
cannot submit sign requests. Pairing works (it only requires subscribing, not submitting), but remote signing fails.

### Production quota gap

On a production chain where sudo attestation is unavailable, the host needs an alternative path to statement store
quota. The likely mechanism is the **slot/voucher system** from the Individuality People-Lite pallet: the wallet (which
already has an on-chain identity with quota) would delegate statement store access to the host's sr25519 account by
assigning it to a slot (`set_stmt_store_associated_account_id_at_slot`), which grants `AccountsApiAllowance`. This
delegation step is not currently implemented in the SDK — it would need to happen after pairing, as an additional
wallet-to-chain transaction. This is an open design gap.

---

## Phase 2: Remote Signing

### Session Topology

After pairing, the host and wallet communicate through **directional session channels**. Two session IDs are derived
from the shared session key:

```
outgoingSessionId = khash(sessionKey, "session" || localAccountId || remoteAccountId || "/" || "/")
incomingSessionId = khash(sessionKey, "session" || remoteAccountId || localAccountId || "/" || "/")
```

The account order is swapped between outgoing and incoming. The wallet computes the same two IDs but sees them reversed
— its outgoing equals the host's incoming, and vice versa.

A **request channel** is derived from the outgoing session ID:

```
requestChannel = khash(outgoingSessionId, "request")
```

The channel field provides replacement semantics in the statement store — newer messages on the same channel supersede
older ones.

### Sign Request Flow

When a product dApp requests a signature:

1. The host encodes a `RemoteMessage` containing the sign request (structured extrinsic payload or raw bytes) with a
   random message ID.
2. The RemoteMessage is wrapped in a `StatementData.request` envelope (the session-layer framing).
3. The StatementData bytes are AES-GCM encrypted with the session key.
4. The host subscribes to the **incoming** session topic (to catch the response).
5. The encrypted blob is sr25519-signed (statement proof) and submitted as a statement with topic = `outgoingSessionId`
   and channel = `requestChannel`.
6. The wallet receives the statement on its matching incoming topic, decrypts, decodes the sign request, and presents
   its signing UI to the user.
7. If approved, the wallet signs the transaction, encodes a `RemoteMessage` with `SignResponse` (containing the
   signature and the original message ID in `respondingTo`), wraps it in `StatementData.request`, encrypts, and
   publishes on its outgoing topic (= host's incoming topic).
8. The host's subscription fires, it decrypts, matches the `respondingTo` message ID, and returns the signature to the
   product dApp.

A 90-second timeout protects against unresponsive wallets.

### Approval Gate

The host can optionally interpose a confirmation modal via an `onSignApproval` callback before forwarding a sign request
to the wallet. This is a host-side UX decision, not part of the cryptographic protocol. If the callback returns false,
the request is rejected without any network communication.

---

## Wire Format

All messages use SCALE encoding. The codec structures are versioned with `Enum({ v1: ... })` wrappers to allow future
protocol revisions without breaking existing decoders.

### Message Layers

From innermost to outermost:

1. **RemoteMessage**: `{ messageId: str, data: Enum { v1: Enum { Disconnected, SignRequest, SignResponse } } }` — The
   application-level payload.
2. **StatementData**:
   `Enum { request: { requestId: str, data: Vec<Bytes> }, response: { requestId: str, responseCode: u8 } }` — The
   session-layer framing. The RemoteMessage bytes go inside the `data` vector.
3. **AES-GCM encryption**: The StatementData bytes are encrypted. Wire format: `nonce(12) || ciphertext || tag`.
4. **Statement**: The encrypted blob becomes the `data` field of a signed statement with sr25519 proof, topic, channel,
   and expiry.

### Signing Payload Fields

The `SignRequest.Payload` variant carries all fields needed to sign a Substrate extrinsic: `address`, `blockHash`,
`blockNumber`, `era`, `genesisHash`, `method`, `nonce`, `specVersion`, `tip`, `transactionVersion`, `signedExtensions`,
`version`, and optional `assetId`, `metadataHash`, `mode`, `withSignedTransaction`. These mirror the standard Polkadot
signer payload interface.

The `SignRequest.Raw` variant carries an `address` and `data` (either raw bytes or a human-readable payload string).

---

## State Management

### SsoManager States

| State           | Meaning                                                     |
| --------------- | ----------------------------------------------------------- |
| `idle`          | No active session, ready to pair                            |
| `pairing`       | Handshake in progress (key generation, attestation started) |
| `awaiting_scan` | QR code displayed, waiting for wallet response              |
| `paired`        | Session established, secrets persisted                      |
| `failed`        | Pairing failed (can retry via `pair()`)                     |

### AuthManager States

The AuthManager is the consumer-facing state container. The SDK translates SsoManager states:

| SsoManager state           | AuthManager state                           |
| -------------------------- | ------------------------------------------- |
| `idle`                     | `idle`                                      |
| `awaiting_scan`            | `pairing` (with QR payload)                 |
| `paired` → building signer | `authenticated` (with session and identity) |
| `failed`                   | `error` (with reason)                       |

Product dApps and host UI subscribe to the AuthManager for connection status.

---

## Identity Resolution

After pairing, the SDK queries the People parachain's `Resources.Consumers` storage entry for the wallet's on-chain
identity. This returns a lite username, optional full username, and credibility data. The query uses the same JSON-RPC
connection as the statement store.

Results are cached in memory with concurrent-request deduplication. Identity resolution failure is non-fatal — the auth
state is set to `authenticated` with `identity: undefined`.

---

## Security Properties

- **Private keys never leave the wallet.** The host only ever sees signatures, never secret keys.
- **Forward secrecy for the handshake.** The ephemeral P-256 key exchange means a compromised QR code alone cannot
  decrypt the handshake response.
- **Session key compromise scope.** If the session key is compromised, an attacker can decrypt sign requests and
  responses but cannot forge signatures (those require the wallet's sr25519 private key).
- **Statement store is untrusted.** Messages are end-to-end encrypted and signed. The statement store nodes cannot read
  message contents or forge messages. They can only observe topic patterns and message timing.
- **Topic privacy.** Topics are derived from cryptographic material (account IDs, public keys) via keyed hashing. An
  observer cannot determine which topics belong to which user without knowing the underlying keys.

---

## Compatibility

The wire format must be byte-identical to the `triangle-js-sdks` implementation (packages
`@novasamatech/statement-store` and `host-papp`). The mobile wallet implements the same protocol. Key compatibility
constraints:

- SCALE codec field order and variant indices must match exactly.
- The account ID is the raw 32-byte sr25519 public key (no hashing).
- Session IDs include pin separator bytes (`"/"`) even though pins are currently unused.
- `OptionBool` uses the SCALE single-byte encoding (0x00=None, 0x01=true, 0x02=false), not the two-byte `Option(bool)`.
- The `v1` version envelope on all message types is mandatory.
