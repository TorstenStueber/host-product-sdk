# SSO Protocol Specification

This document specifies the wire protocol between a **host** (web or native application) and the **Polkadot mobile
wallet** (the "papp") for QR-code-based pairing and remote transaction signing. An implementor of either side can use
this document to build a conforming implementation.

All communication flows through the **statement store** — a decentralized off-chain message bus on the People parachain.
Neither party communicates directly with the other.

---

## Notation

- `||` denotes byte concatenation.
- `SCALE(T, value)` denotes SCALE encoding of `value` according to type `T`.
- `khash(key, message)` = `blake2b(message, key=key, dkLen=32)` — blake2b-256 with keyed mode.
- `HKDF(ikm)` = `HKDF-SHA256(ikm, salt=<empty>, info=<empty>, dkLen=32)`.
- `ECDH(secret, publicKey)` = x-coordinate of the P-256 ECDH point (32 bytes).
- `AES-GCM-ENC(key, plaintext)` = `nonce(12 random bytes) || AES-256-GCM(HKDF(key), nonce, plaintext)`.
- `AES-GCM-DEC(key, ciphertext)` = `AES-256-GCM-decrypt(HKDF(key), ciphertext[0:12], ciphertext[12:])`.
- All byte sizes are in bytes unless noted otherwise.
- All SCALE integers are little-endian.

---

## 1. Key Types

| Key type | Curve                  | Sizes                                                  | Purpose                                         |
| -------- | ---------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Sr25519  | Ristretto255 (Schnorr) | Secret: 64B, Public: 32B                               | Identity, statement proofs, on-chain operations |
| P-256    | secp256r1 / NIST P-256 | Secret: 32B, Public: 65B (uncompressed, `0x04` prefix) | ECDH key agreement for AES session keys         |

---

## 2. Account ID

The account ID is the **raw 32-byte sr25519 public key**. No hashing is applied. For an sr25519 public key `pk`,
`accountId = pk[0..32]`.

---

## 3. Pairing (Handshake)

### 3.1 Host: Generate Identity

The host generates a fresh 12-word BIP-39 mnemonic and converts it to 16 bytes of entropy. From this entropy:

1. **Sr25519 keypair**: Derive via Substrate BIP-39 (`entropyToMiniSecret`) then HDKD at path `//wallet//sso`. This
   produces a 64-byte secret key (`ssSecret`) and 32-byte public key (`ssPublicKey`).
2. **P-256 keypair**: Derive via `entropyToMiniSecret`, then P-256 key generation from a 48-byte seed (mini-secret
   zero-padded to 48 bytes). This produces a 32-byte secret key (`encrSecret`) and 65-byte uncompressed public key
   (`encrPublicKey`).
3. **Account ID**: `accountId = ssPublicKey` (raw, no hash).

### 3.2 Host: Build QR Code

SCALE-encode the handshake payload:

```
HandshakeData = Enum {
  v1 (index 0): Struct {
    ssPublicKey:  Bytes(32)       -- sr25519 public key
    encrPublicKey: Bytes(65)      -- P-256 uncompressed public key
    metadata:     str             -- URL to host metadata JSON
    hostVersion:  Option(str)     -- host application version
    osType:       Option(str)     -- operating system type
    osVersion:    Option(str)     -- operating system version
  }
}
```

Encode as a deeplink: `polkadotapp://pair?handshake={hex(SCALE(HandshakeData, v1(...)))}`.

Display as a QR code.

### 3.3 Handshake Topic

Both sides must derive the same topic to find each other on the statement store:

```
handshakeTopic = khash(accountId, encrPublicKey || UTF8("topic"))
```

where `accountId` and `encrPublicKey` are from the HandshakeData.

### 3.4 Host: Subscribe

The host subscribes to `handshakeTopic` on the statement store (via `statement_subscribeStatement` with
`matchAny: [hex(handshakeTopic)]`) and waits for the wallet's response.

### 3.5 Wallet: Respond

The wallet scans the QR code, decodes the HandshakeData, and derives the same `handshakeTopic`.

The wallet then:

1. Generate an **ephemeral** P-256 keypair: `tmpSecret`, `tmpKey` (65 bytes, uncompressed).
2. Compute the temporary symmetric key: `tempSymKey = ECDH(tmpSecret, encrPublicKey)`.
3. Encrypt sensitive data:
   `encrypted = AES-GCM-ENC(tempSymKey, SCALE(SensitiveData, [walletEncrPublicKey, walletAccountId]))`.

```
HandshakeResponseSensitiveData = Tuple(Bytes(65), Bytes(32))
  -- [0]: wallet's long-term P-256 public key (65B, uncompressed)
  -- [1]: wallet's sr25519 account ID (32B, raw public key)
```

4. SCALE-encode the response:

```
HandshakeResponsePayload = Enum {
  v1 (index 0): Struct {
    encrypted: Bytes()     -- AES-GCM ciphertext of SensitiveData
    tmpKey:    Bytes(65)   -- wallet's ephemeral P-256 public key
  }
}
```

5. Publish the encoded response as a signed statement on `handshakeTopic`.

The statement must have:

- `topics: [handshakeTopic]`
- `data: SCALE(HandshakeResponsePayload, v1(...))`
- `proof`: sr25519 signature from the wallet's signing key

### 3.6 Host: Complete Handshake

The host receives the statement, decodes `HandshakeResponsePayload.v1`, and:

1. **Ephemeral ECDH**: `tempSymKey = ECDH(encrSecret, tmpKey)`.
2. **Decrypt**: `AES-GCM-DEC(tempSymKey, encrypted)` → decode as `HandshakeResponseSensitiveData` → extract
   `walletEncrPublicKey` (65B) and `walletAccountId` (32B).
3. **Session key**: `sessionKey = ECDH(encrSecret, walletEncrPublicKey)` — 32-byte persistent shared secret.
4. **Wallet address**: SS58-decode `walletAccountId` to get the display address.

### 3.7 Why the Wallet's Account ID Is Needed

The wallet's account ID (its raw sr25519 public key) extracted from the handshake response serves three purposes beyond
the handshake:

- **Session topic derivation** (section 4.1): both account IDs are mixed into the session ID formula, so the host cannot
  derive the correct signing topics without it.
- **Product account derivation**: the wallet's public key is the HDKD root from which per-product account addresses are
  derived (via soft junctions `/product/{productId}/{index}`). Product dApps use these derived keys for user-specific
  on-chain operations.
- **Identity resolution**: the host queries the People parachain's `Resources.Consumers` storage using the wallet's
  account ID to look up the user's on-chain username.

### 3.8 Persisted State

After a successful handshake, the host persists:

| Data                    | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `ssSecret` (64B)        | Sr25519 secret for signing statement proofs                  |
| `encrSecret` (32B)      | P-256 secret (for potential future re-derivation)            |
| `entropy` (16B)         | BIP-39 entropy (for potential future re-derivation)          |
| `sessionKey` (32B)      | AES session key for all future encrypted communication       |
| `walletAccountId` (32B) | Wallet's account ID (session topics, product keys, identity) |
| `accountId` (32B)       | Host's own account ID (session topic derivation)             |

On page reload, the host restores these and rebuilds the signing channel without repeating the handshake.

---

## 4. Remote Signing

### 4.1 Session Topology

Two directional session IDs are derived from the shared session key:

```
outgoingSessionId = khash(sessionKey, UTF8("session") || localAccountId || remoteAccountId || UTF8("/") || UTF8("/"))
incomingSessionId = khash(sessionKey, UTF8("session") || remoteAccountId || localAccountId || UTF8("/") || UTF8("/"))
```

Each side computes both IDs. The host's `outgoingSessionId` equals the wallet's `incomingSessionId`, and vice versa.

A request channel is derived from the outgoing session ID:

```
requestChannel = khash(outgoingSessionId, UTF8("request"))
```

A response channel is derived similarly (used by the transport-layer acknowledgment, not the application-layer sign
response):

```
responseChannel = khash(sessionId, UTF8("response"))
```

### 4.2 Message Layers

Messages are wrapped in three nested layers. From innermost to outermost:

**Layer 1: RemoteMessage** (application payload)

```
RemoteMessage = Struct {
  messageId: str                  -- unique request identifier
  data: Enum {
    v1 (index 0): Enum {
      Disconnected (index 0): void
      SignRequest  (index 1): SigningRequest
      SignResponse (index 2): SigningResponse
    }
  }
}
```

**Layer 2: StatementData** (session framing)

```
StatementData = Enum {
  request  (index 0): Struct {
    requestId: str                -- session-layer request identifier
    data:      Vector(Bytes())    -- one or more encoded payloads
  }
  response (index 1): Struct {
    requestId:    str             -- echoes the request's requestId
    responseCode: u8              -- 0=success, 1=decryptionFailed, 2=decodingFailed, 255=unknown
  }
}
```

The RemoteMessage is SCALE-encoded and placed as the first element of the `data` vector inside a
`StatementData.request`.

**Layer 3: Encryption + Statement**

The SCALE-encoded StatementData is AES-GCM encrypted with the session key, sr25519-signed, and submitted as a statement
to the statement store.

### 4.3 Host: Send Sign Request

1. Generate a random `messageId` string.
2. SCALE-encode a `RemoteMessage`:
   ```
   { messageId, data: v1(SignRequest(Payload({address, blockHash, ...}) | Raw({address, data}))) }
   ```
3. Wrap in `StatementData`: `{ tag: "request", value: { requestId: messageId, data: [encodedRemoteMessage] } }`.
4. Encrypt: `encryptedData = AES-GCM-ENC(sessionKey, SCALE(StatementData, ...))`.
5. **Subscribe** to `incomingSessionId` on the statement store (before submitting, to avoid race conditions).
6. **Submit** the statement:
   - `topics: [outgoingSessionId]`
   - `channel: requestChannel`
   - `data: encryptedData`
   - `expiry`: upper 32 bits = Unix timestamp 7 days from now, lower 32 bits = monotonic sequence number
   - `proof`: sr25519 signature from the host's `ssSecret`

### 4.4 Wallet: Receive and Respond

The wallet subscribes to its `incomingSessionId` (which equals the host's `outgoingSessionId`).

On receiving a statement:

1. Decrypt: `AES-GCM-DEC(sessionKey, statement.data)`.
2. Decode as `StatementData`. If `tag == "request"`, decode each element in `data` as `RemoteMessage`.
3. If the RemoteMessage contains `v1.SignRequest`, present the signing UI to the user.
4. If approved, sign the transaction with the wallet's private key.
5. Build the response `RemoteMessage`:
   ```
   { messageId: <new>, data: v1(SignResponse({ respondingTo: <original messageId>, payload: Ok({ signature, signedTransaction? }) | Err(reason) })) }
   ```
6. Wrap in `StatementData.request`, encrypt, and submit on the wallet's `outgoingSessionId` topic (which equals the
   host's `incomingSessionId`).

### 4.5 Host: Receive Response

The host's subscription on `incomingSessionId` fires. For each statement:

1. Decrypt with the session key.
2. Decode as `StatementData.request`.
3. Decode each payload as `RemoteMessage`.
4. Match `v1.SignResponse.respondingTo` against the pending `messageId`.
5. If `payload` is `Ok`, extract `signature` (and optional `signedTransaction`). If `Err`, propagate the error string.

### 4.6 Timeout

The host should enforce a timeout (recommended: 90 seconds). If no matching response arrives, reject the sign request.

### 4.7 Session Disconnect

Either side can send a `RemoteMessage { data: v1(Disconnected) }` wrapped in `StatementData.request` to signal clean
session teardown. The receiver should clear session state.

---

## 5. SCALE Codec Reference

All types use standard SCALE encoding. `Enum` variants are prefixed by a `u8` index. `Struct` fields are concatenated in
declaration order with no length prefix. `Option(T)` is `0x00` for None, `0x01 || SCALE(T, value)` for Some. `Vector(T)`
is `compact(length) || elements`. `str` is `compact(byte_length) || UTF-8 bytes`. `Bytes(n)` is `n` raw bytes
(fixed-length, no prefix). `Bytes()` is `compact(length) || raw bytes`.

### 5.1 OptionBool

A single-byte encoding distinct from `Option(bool)`:

| Byte   | Meaning     |
| ------ | ----------- |
| `0x00` | None        |
| `0x01` | Some(true)  |
| `0x02` | Some(false) |

### 5.2 Hex

Variable-length or fixed-length byte array, represented as a `0x`-prefixed hex string at the application level but
encoded as raw `Bytes()` or `Bytes(n)` on the wire.

### 5.3 SigningRequest

```
SigningRequest = Enum {
  Payload (index 0): Struct {
    address:              str
    blockHash:            Hex()
    blockNumber:          Hex()
    era:                  Hex()
    genesisHash:          Hex()
    method:               Hex()
    nonce:                Hex()
    specVersion:          Hex()
    tip:                  Hex()
    transactionVersion:   Hex()
    signedExtensions:     Vector(str)
    version:              u32
    assetId:              Option(Hex())
    metadataHash:         Option(Hex())
    mode:                 Option(u32)
    withSignedTransaction: OptionBool
  }
  Raw (index 1): Struct {
    address: str
    data: Enum {
      Bytes   (index 0): Bytes()
      Payload (index 1): str
    }
  }
}
```

### 5.4 SigningResponse

```
SigningResponse = Struct {
  respondingTo: str                              -- echoes RemoteMessage.messageId
  payload: Result(SigningPayloadResponseData, str)
}

SigningPayloadResponseData = Struct {
  signature:         Bytes()                     -- the cryptographic signature
  signedTransaction: Option(Bytes())             -- optional fully-signed extrinsic
}
```

`Result(Ok, Err)` encodes as: `0x00 || SCALE(Ok, value)` for success, `0x01 || SCALE(Err, value)` for failure.

---

## 6. Cryptographic Primitives

### 6.1 Sr25519 Key Derivation

From BIP-39 entropy:

1. `miniSecret = entropyToMiniSecret(entropy)` — Substrate-specific PBKDF2-SHA512 (salt = `"mnemonic"`, 2048 iterations,
   64-byte output truncated to 32 bytes). Note: this takes **raw entropy bytes**, not the mnemonic string.
2. `secret = sr25519SecretFromSeed(miniSecret)` — Expand 32-byte mini-secret to 64-byte sr25519 secret.
3. Apply HDKD derivations for path `//wallet//sso`:
   - Parse path into segments: `//wallet` (hard) and `//sso` (hard).
   - For each segment, create a 32-byte chain code: if the segment is numeric, encode as SCALE `u32` in a 32-byte
     buffer; otherwise encode as SCALE `str` (compact-length-prefixed UTF-8) in a 32-byte buffer.
   - Apply `HDKD.secretHard(secret, chainCode)` for `//` segments or `HDKD.secretSoft(secret, chainCode)` for `/`
     segments.

### 6.2 P-256 Key Derivation

From the same BIP-39 entropy:

1. `miniSecret = entropyToMiniSecret(entropy)`.
2. `seed = miniSecret || zeros(16)` — zero-pad to 48 bytes.
3. `{ secretKey } = p256.keygen(seed)` — derive the P-256 secret key.
4. `publicKey = p256.getPublicKey(secretKey, false)` — 65-byte uncompressed public key.

### 6.3 P-256 ECDH

`ECDH(secret, publicKey)` = `p256.getSharedSecret(secret, publicKey)[1:33]` — the x-coordinate only (first byte is the
`0x04` uncompressed prefix, skip it; take the next 32 bytes).

### 6.4 AES-256-GCM

Key derivation: `aesKey = HKDF-SHA256(ikm=sharedSecret, salt=<0 bytes>, info=<0 bytes>, dkLen=32)`.

Encrypt: generate 12 random bytes as nonce, AES-256-GCM encrypt, output `nonce(12) || ciphertext || tag(16)`.

Decrypt: first 12 bytes = nonce, remainder = ciphertext + authentication tag.

### 6.5 Keyed Hash (khash)

`khash(key, message) = blake2b(message, { dkLen: 32, key: key })`.

Used for topic derivation, session ID derivation, and channel derivation.

---

## 7. Statement Format

Statements are published via the `statement_submit` RPC and received via `statement_subscribeStatement`. Each statement
has:

| Field           | Type                                                                     | Description                                                                           |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `proof`         | `{ tag: "sr25519", value: { signature: Bytes(64), signer: Bytes(32) } }` | Sr25519 signature over the SCALE-encoded statement (excluding the proof field itself) |
| `topics`        | `Bytes(32)[]`                                                            | Up to 4 topic filters for routing (SSO uses 1 topic per statement)                    |
| `channel`       | `Bytes(32)?`                                                             | Optional. Provides replacement semantics — one statement per (account, channel) pair  |
| `data`          | `Bytes()?`                                                               | The encrypted payload                                                                 |
| `expiry`        | `u64`                                                                    | Upper 32 bits: Unix timestamp (seconds). Lower 32 bits: sequence/priority number      |
| `decryptionKey` | `Bytes(32)?`                                                             | Unused by SSO (deprecated field)                                                      |

---

## 8. Protocol Summary

### Pairing

```
Host                                    Wallet
 |                                        |
 |  1. Generate mnemonic, derive keys     |
 |  2. Encode HandshakeData, show QR      |
 |  3. Subscribe to handshakeTopic        |
 |                                        |
 |              <-- scan QR -->           |
 |                                        |
 |                                   4. Decode HandshakeData
 |                                   5. Generate ephemeral P-256 keypair
 |                                   6. ECDH(tmpSecret, host.encrPublicKey) → tempSymKey
 |                                   7. Encrypt [walletEncrPubKey, walletAccountId]
 |                                   8. Publish HandshakeResponsePayload on handshakeTopic
 |                                        |
 |  9. Receive response                   |
 | 10. ECDH(encrSecret, tmpKey) → tempSymKey
 | 11. Decrypt → walletEncrPubKey, walletAccountId
 | 12. ECDH(encrSecret, walletEncrPubKey) → sessionKey
 | 13. Persist session                    |
```

### Remote Signing

```
Host                                    Wallet
 |                                        |
 |  1. Encode RemoteMessage(SignRequest)   |
 |  2. Wrap in StatementData.request       |
 |  3. AES-GCM encrypt with sessionKey     |
 |  4. Subscribe to incomingSessionId      |
 |  5. Submit on outgoingSessionId topic   |
 |                                        |
 |                                   6. Receive on wallet.incomingSessionId
 |                                   7. Decrypt, decode SignRequest
 |                                   8. Show signing UI, user approves
 |                                   9. Sign transaction
 |                                  10. Encode RemoteMessage(SignResponse)
 |                                  11. Wrap in StatementData.request
 |                                  12. AES-GCM encrypt with sessionKey
 |                                  13. Submit on wallet.outgoingSessionId topic
 |                                        |
 | 14. Receive on host.incomingSessionId   |
 | 15. Decrypt, decode SignResponse        |
 | 16. Match respondingTo, return signature |
```
