/**
 * Client for the public Postman API.
 *
 * It can upload the collection directly to the user's workspace instead
 * of generating a file that must be imported manually. It is the closest
 * thing to an "auto-import" that can be done: the desktop application does
 * not expose any documented local API, but `api.getpostman.com` does, and
 * that is the official route.
 *
 * Because `info._postman_id` is deterministic per project (p00014), a
 * second `push` **updates** the existing collection instead of creating
 * another one.
 *
 * The API key is passed via `--api-key` or `POSTMAN_API_KEY`, and is never
 * written to disk or printed.
 *
 * @see https://learning.postman.com/docs/developer/postman-api/intro-api/
 */
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type { IPostmanApiOptions, IPostmanEnvironmentPayload, IPushResult } from "../../contracts/interfaces/core/domain.interface.js";

const API_BASE = "https://api.getpostman.com";

/** An API error with the detail returned by Postman. */
export class PostmanApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "PostmanApiError";
  }
}

/**
 * Uploads the collection: updates it if one with the same `_postman_id`
 * already exists; otherwise, creates it.
 */
export async function pushCollection(
  collection: PostmanCollection,
  options: IPostmanApiOptions,
): Promise<IPushResult> {
  const existing = await findCollectionByPostmanId(
    collection.info._postman_id ?? "",
    options,
  );

  if (existing) {
    await request(`/collections/${existing.uid}`, {
      method: "PUT",
      body: { collection },
      options,
    });
    return { action: "updated", uid: existing.uid, name: collection.info.name };
  }

  const created = await request<{ collection?: { uid?: string } }>("/collections", {
    method: "POST",
    body: { collection },
    query: options.workspaceId ? { workspace: options.workspaceId } : undefined,
    options,
  });

  return {
    action: "created",
    uid: created.collection?.uid ?? "",
    name: collection.info.name,
  };
}

/** Uploads an environment, with the same create-or-update semantics. */
export async function pushEnvironment(
  environment: IPostmanEnvironmentPayload,
  options: IPostmanApiOptions,
): Promise<IPushResult> {
  const existing = await findEnvironmentByName(environment.name, options);

  if (existing) {
    await request(`/environments/${existing.uid}`, {
      method: "PUT",
      body: { environment },
      options,
    });
    return { action: "updated", uid: existing.uid, name: environment.name };
  }

  const created = await request<{ environment?: { uid?: string } }>("/environments", {
    method: "POST",
    body: { environment },
    query: options.workspaceId ? { workspace: options.workspaceId } : undefined,
    options,
  });

  return {
    action: "created",
    uid: created.environment?.uid ?? "",
    name: environment.name,
  };
}

/** Verifies that the API key is valid. Returns the associated user. */
export async function verifyApiKey(
  options: IPostmanApiOptions,
): Promise<{ id: number; username: string }> {
  const me = await request<{ user?: { id?: number; username?: string } }>("/me", {
    method: "GET",
    options,
  });
  return {
    id: me.user?.id ?? 0,
    username: me.user?.username ?? "(unknown)",
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface IRemoteItem {
  readonly uid: string;
  readonly id: string;
  readonly name: string;
}

/**
 * Finds a remote collection by its `_postman_id`.
 *
 * Postman retains the original `id` of the imported collection, so
 * comparing against it is what makes a repeated `push` update instead
 * of duplicating it.
 */
async function findCollectionByPostmanId(
  postmanId: string,
  options: IPostmanApiOptions,
): Promise<IRemoteItem | null> {
  if (!postmanId) return null;
  const list = await request<{ collections?: IRemoteItem[] }>("/collections", {
    method: "GET",
    options,
  });
  return list.collections?.find((c) => c.id === postmanId) ?? null;
}

async function findEnvironmentByName(
  name: string,
  options: IPostmanApiOptions,
): Promise<IRemoteItem | null> {
  const list = await request<{ environments?: IRemoteItem[] }>("/environments", {
    method: "GET",
    options,
  });
  return list.environments?.find((e) => e.name === name) ?? null;
}

interface IRequestOptions {
  readonly method: "GET" | "POST" | "PUT";
  readonly body?: unknown;
  readonly query?: Record<string, string> | undefined;
  readonly options: IPostmanApiOptions;
}

async function request<T = unknown>(path: string, config: IRequestOptions): Promise<T> {
  const doFetch = config.options.fetchImpl ?? fetch;
  const query = config.query
    ? `?${Object.entries(config.query)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&")}`
    : "";

  // The type is derived from `doFetch` instead of naming the global
  // `FetchResponse`. That global is declared by `runtime.d.ts`, the hand-written
  // replacement for `@types/node` used by this repo; the plugin compiles with
  // real types and does not have it, so naming it broke its typecheck as soon
  // as the plugin imported this module.
  let response: Awaited<ReturnType<typeof doFetch>>;
  try {
    response = await doFetch(`${API_BASE}${path}${query}`, {
      method: config.method,
      headers: {
        "X-Api-Key": config.options.apiKey,
        "Content-Type": "application/json",
      },
      ...(config.body ? { body: JSON.stringify(config.body) } : {}),
    });
  } catch (err) {
    throw new PostmanApiError(
      "Could not reach api.getpostman.com. Check your network connection.",
      0,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new PostmanApiError(explainStatus(response.status), response.status, detail.slice(0, 400));
  }

  return (await response.json()) as T;
}

/** Translates the HTTP status code into something actionable. */
function explainStatus(status: number): string {
  if (status === 401) return "Invalid Postman API key (401).";
  if (status === 403) return "The API key does not have access to that workspace (403).";
  if (status === 404) return "Not found (404). Check the workspace id.";
  if (status === 429) return "Postman API rate limit reached (429). Try again in a minute.";
  return `The Postman API returned ${status}.`;
}
