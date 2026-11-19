/** JSON-RPC 2.0 wire types shared by the application bridges. */
export type JsonRpcId = number | string;

export interface IJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface IJsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface IJsonRpcSuccessResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface IJsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: Readonly<Record<string, unknown>>;
  };
}

export type IJsonRpcResponse =
  | IJsonRpcSuccessResponse
  | IJsonRpcErrorResponse;

export type IJsonRpcFrame =
  | IJsonRpcRequest
  | IJsonRpcNotification
  | IJsonRpcResponse;

export type StandardJsonRpcErrorCode =
  (typeof import("../../constants/core/json-rpc.constant.js").JSON_RPC_ERROR_CODES)[keyof typeof import("../../constants/core/json-rpc.constant.js").JSON_RPC_ERROR_CODES];