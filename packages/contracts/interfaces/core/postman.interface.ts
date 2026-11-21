/**
 * Postman schema v2.1.0 types.
 * Official documentation: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 */

/**
 * @deprecated Import `IOperation` from `operation.interface.ts` instead.
 * This compatibility re-export is removed when the legacy surface is retired.
 */
export type { IOperation } from "./operation.interface.js";

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: Array<{
    key: string;
    value: string;
    description?: string;
    disabled?: boolean;
  }>;
}

/** An HTTP header as Postman stores it. */
export interface PostmanHeader {
  key: string;
  value: string;
  type?: string;
}

/** A Postman request body. */
export interface PostmanBody {
  mode: "raw" | "formdata" | "urlencoded" | "file";
  raw?: string;
  options?: { raw?: { language: string } };
}

/** The request stored on a Postman item. */
export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  description?: string;
  body?: PostmanBody;
}

/** A script that Postman runs around a request. */
export interface PostmanEvent {
  listen: "test" | "prerequest";
  script: { type: string; exec: string[] };
}

/** A folder or request node in a Postman collection tree. */
export interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  description?: string;
  event?: PostmanEvent[];
}

/** A collection or environment variable. */
export interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
}

/** A complete Postman v2.1.0 collection. */
export interface PostmanCollection {
  info: {
    name: string;
    description: string;
    schema: string;
    _postman_id?: string;
  };
  auth?: {
    type: string;
    bearer?: Array<{ key: string; value: string; type?: string }>;
  };
  variable: PostmanVariable[];
  item: PostmanItem[];
}

/** Postman v2.1.0 environment. */
export interface PostmanEnvironment {
  id: string;
  name: string;
  values: Array<{
    key: string;
    value: string;
    enabled: boolean;
    type?: "default" | "secret";
    description?: string;
  }>;
  _postman_id?: string;
  scope?: "environment";
  color?: string;
}