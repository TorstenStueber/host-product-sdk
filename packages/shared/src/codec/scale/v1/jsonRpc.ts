import { Result, Tuple, _void, str } from 'scale-ts';
import { GenericErr, GenesisHash } from './commonCodecs.js';

// -- V1 request / response codecs --------------------------------------------

// host_jsonrpc_message_send
export const JsonRpcMessageSendV1_request = Tuple(GenesisHash, str);
export const JsonRpcMessageSendV1_response = Result(_void, GenericErr);

// host_jsonrpc_message_subscribe
export const JsonRpcMessageSubscribeV1_start = GenesisHash;
export const JsonRpcMessageSubscribeV1_receive = str;
