import type { SUPPORTED_METHODS } from "../../../constants/core/postman.constant.js";

export type HttpMethod = (typeof SUPPORTED_METHODS)[number];

export interface IHttpTransport {
  readonly kind: "http";
  readonly method: HttpMethod;
  readonly path: string;
}

export type HttpTransport = IHttpTransport;