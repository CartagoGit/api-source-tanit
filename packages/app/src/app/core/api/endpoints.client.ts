import { Injectable, inject } from "@angular/core";

import {
  ENDPOINT_CONFIDENCES,
  type EndpointConfidence,
  type EndpointListResponse,
  type EndpointParameter,
  type EndpointQuery,
  type EndpointRecord,
  type EndpointResponse,
} from "../../../../../contracts/interfaces/core/endpoint.interface";
import type {
  GetEndpointOutput,
  GetSchemaOutput,
  ListEndpointsOutput,
} from "../../../../../contracts/interfaces/core/application-api.interface";
import { HostBridgeClient } from "./host-bridge.client";

export {
  ENDPOINT_CONFIDENCES,
  ENDPOINT_TRANSPORTS,
  type EndpointConfidence,
  type EndpointListResponse,
  type EndpointParameter,
  type EndpointQuery,
  type EndpointRecord,
  type EndpointResponse,
  type EndpointTransport,
} from "../../../../../contracts/interfaces/core/endpoint.interface";

/** How many endpoints the client asks for at a time. */
const PAGE_SIZE = 500;

/**
 * The endpoint explorer talks to the backend.
 *
 * ## What it used to do
 *
 * It answered from a generator: `createEndpointDataset()` built
 * five thousand endpoints out of an index number, each with an auth
 * scheme nobody detected and a source file that did not exist. The
 * explorer showed a full, plausible, completely fictional API, and
 * nobody could tell, because the numbers looked too good.
 *
 * A client that answers "here is your data" without asking anybody
 * is a mock wearing a client's clothes. This one asks.
 *
 * ## How the filters work
 *
 * The filters go to the backend, not to a client-side `filter()`.
 * The backend has every endpoint; the client has a page. Filtering a
 * page answers "is it in this page", not "does it exist" — and a
 * user who types a search term and sees "0 results" when there are
 * three would be right to distrust the tool.
 */
@Injectable({ providedIn: "root" })
export class EndpointsClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * Every endpoint that matches the filter.
   *
   * The pages are walked to the end: the explorer draws a list and a
   * count, and a count of "the first page" would be a lie.
   */
  async list(
    projectRoot: string,
    query: EndpointQuery = {},
  ): Promise<EndpointListResponse> {
    const endpoints: EndpointRecord[] = [];
    let cursor: string | null = null;
    let total = 0;
    let indexedTotal = 0;

    do {
      const page: ListEndpointsOutput = await this.bridge.request("list-endpoints", {
        projectRoot,
        ...toRequest(query),
        limit: PAGE_SIZE,
        ...(cursor !== null ? { cursor } : {}),
      });
      for (const summary of page.endpoints) endpoints.push(toRecord(summary));
      total = page.total;
      indexedTotal = page.indexedTotal ?? page.total;
      cursor = page.nextCursor;
    } while (cursor !== null);

    return { endpoints, total, indexedTotal };
  }

  /**
   * The detail of one endpoint: its parameters, its responses and its
   * request schema.
   *
   * The summary carries enough to draw a row; the detail is what the
   * panels need, and it is fetched when the endpoint is selected
   * rather than for every endpoint of the project.
   */
  async detail(
    projectRoot: string,
    method: string,
    uri: string,
  ): Promise<{
    readonly parameters: readonly EndpointParameter[];
    readonly responses: readonly EndpointResponse[];
    readonly requestSchema: unknown;
  }> {
    const endpoint: GetEndpointOutput = await this.bridge.request("get-endpoint", {
      projectRoot,
      method,
      uri,
    });
    let requestSchema: unknown;
    try {
      const schema: GetSchemaOutput = await this.bridge.request("get-schema", {
        projectRoot,
        method,
        uri,
      });
      requestSchema = schema.schema;
    } catch {
      // An endpoint without a request schema is not an error: the
      // scanner did not find one, and the panel says so.
      requestSchema = { kind: "none" };
    }

    const spec = endpoint.endpoint;
    return {
      parameters: (spec.fields ?? []).map((field) => ({
        name: field.fieldName,
        location: field.location === "cookie" ? "header" : field.location,
        required: field.required,
        type: field.type,
      })),
      responses: (spec.responses ?? []).map((response) => ({
        status: String(response.status),
        description: response.reason,
        schema: response.schema,
      })),
      requestSchema,
    };
  }
}

/** The filter, in the shape the API's schema accepts. */
function toRequest(query: EndpointQuery): Record<string, string> {
  const request: Record<string, string> = {};
  if (query.service) request["service"] = query.service;
  if (query.framework) request["framework"] = query.framework;
  if (query.transport) request["transport"] = query.transport;
  if (query.method) request["method"] = query.method;
  if (query.auth) request["auth"] = query.auth;
  if (query.validation) request["validation"] = query.validation;
  if (query.responses) request["responses"] = query.responses;
  if (query.confidence) request["confidence"] = query.confidence;
  if (query.sourceFile) request["sourceFile"] = query.sourceFile;
  if (query.search) request["search"] = query.search;
  return request;
}

/** The summary the backend answers with, as the explorer draws it. */
function toRecord(summary: {
  readonly method: string;
  readonly uri: string;
  readonly name: string;
  readonly serviceId?: string;
  readonly description?: string;
  readonly transport?: string;
  readonly auth?: string;
  readonly validation?: string;
  readonly framework?: string;
  readonly confidence?: string;
  readonly responses?: readonly string[];
  readonly sourceFile?: string;
  readonly line?: number;
}): EndpointRecord {
  const responses = summary.responses ?? [];
  return {
    id: `${summary.method} ${summary.uri}`,
    operationId: summary.name,
    service: summary.serviceId ?? "default",
    framework: summary.framework ?? "unknown",
    transport: summary.transport ?? "http",
    method: summary.method,
    path: summary.uri,
    description: summary.description ?? "",
    auth: summary.auth ?? "none",
    validation: summary.validation ?? "none",
    responseSummary: responses.join(", "),
    responses: [],
    parameters: [],
    requestSchema: undefined,
    ...(summary.sourceFile !== undefined ? { sourceFile: summary.sourceFile } : {}),
    ...(summary.line !== undefined ? { line: summary.line } : {}),
    ...(summary.confidence !== undefined && isConfidence(summary.confidence)
      ? { confidence: summary.confidence }
      : {}),
  };
}

/** Whether the backend said a confidence the app knows how to show. */
function isConfidence(value: string): value is EndpointConfidence {
  return (ENDPOINT_CONFIDENCES as readonly string[]).includes(value);
}
