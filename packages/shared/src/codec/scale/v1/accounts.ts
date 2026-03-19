import { Enum, Hex, Status } from '../primitives.js';
import { Bytes, Option, Result, Struct, Tuple, Vector, _void, str, u32 } from 'scale-ts';
import { GenericErr } from './commonCodecs.js';

// -- Primitives ---------------------------------------------------------------

export const AccountId = Bytes(32);
export const PublicKey = Bytes();
export const DotNsIdentifier = str;
export const DerivationIndex = u32;
export const ProductAccountId = Tuple(DotNsIdentifier, DerivationIndex);
export const RingVrfProof = Bytes();
export const RingVrgAlias = Bytes();

// -- Account ------------------------------------------------------------------

export const Account = Struct({
  publicKey: PublicKey,
  name: Option(str),
});

// -- Alias / Ring -------------------------------------------------------------

export const ContextualAlias = Struct({
  context: Bytes(32),
  alias: Bytes(), // RingVrfAlias
});

export const RingLocationHint = Struct({
  palletInstance: Option(u32),
});

export const RingLocation = Struct({
  genesisHash: Hex(),
  ringRootHash: Hex(),
  hints: Option(RingLocationHint),
});

// -- Errors -------------------------------------------------------------------

export const RequestCredentialsErr = Enum({
  NotConnected: _void,
  Rejected: _void,
  DomainNotValid: _void,
  Unknown: GenericErr,
});

export const CreateProofErr = Enum({
  RingNotFound: _void,
  Rejected: _void,
  Unknown: GenericErr,
});

// -- Status -------------------------------------------------------------------

export const AccountConnectionStatus = Status('disconnected', 'connected');

// -- V1 request / response codecs --------------------------------------------

// host_account_connection_status_subscribe
export const AccountConnectionStatusV1_start = _void;
export const AccountConnectionStatusV1_receive = AccountConnectionStatus;

// host_account_get
export const AccountGetV1_request = ProductAccountId;
export const AccountGetV1_response = Result(Account, RequestCredentialsErr);

// host_account_get_alias
export const AccountGetAliasV1_request = ProductAccountId;
export const AccountGetAliasV1_response = Result(ContextualAlias, RequestCredentialsErr);

// host_account_create_proof
export const AccountCreateProofV1_request = Tuple(ProductAccountId, RingLocation, Bytes());
export const AccountCreateProofV1_response = Result(RingVrfProof, CreateProofErr);

// host_get_non_product_accounts
export const GetNonProductAccountsV1_request = _void;
export const GetNonProductAccountsV1_response = Result(Vector(Account), RequestCredentialsErr);

// -- Derived types ------------------------------------------------------------

import type { CodecType } from 'scale-ts';

export type AccountIdType = CodecType<typeof AccountId>;
export type PublicKeyType = CodecType<typeof PublicKey>;
export type DotNsIdentifierType = CodecType<typeof DotNsIdentifier>;
export type DerivationIndexType = CodecType<typeof DerivationIndex>;
export type ProductAccountIdType = CodecType<typeof ProductAccountId>;
export type AccountType = CodecType<typeof Account>;
export type ContextualAliasType = CodecType<typeof ContextualAlias>;
export type RingLocationHintType = CodecType<typeof RingLocationHint>;
export type RingLocationType = CodecType<typeof RingLocation>;
export type AccountConnectionStatusType = CodecType<typeof AccountConnectionStatus>;
export type RequestCredentialsErrType = CodecType<typeof RequestCredentialsErr>;
export type CreateProofErrType = CodecType<typeof CreateProofErr>;
