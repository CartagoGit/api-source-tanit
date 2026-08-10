/**
 * Cliente de la API pública de Postman.
 *
 * Permite subir la colección directamente al workspace del usuario en
 * lugar de generar un fichero que hay que importar a mano. Es lo más
 * cerca de un "auto-import" que se puede hacer: la aplicación de
 * escritorio no expone ninguna API local documentada, pero
 * `api.getpostman.com` sí lo está y es la vía oficial.
 *
 * Como `info._postman_id` es determinista por proyecto (p00014), un
 * segundo `push` **actualiza** la colección que ya existe en vez de
 * crear otra.
 *
 * La API key se pasa por `--api-key` o `POSTMAN_API_KEY`, y nunca se
 * escribe en disco ni se imprime.
 *
 * @see https://learning.postman.com/docs/developer/postman-api/intro-api/
 */
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type { IPostmanApiOptions, IPostmanEnvironmentPayload, IPushResult } from "../../contracts/interfaces/core/domain.interface.js";

const API_BASE = "https://api.getpostman.com";

/** Un error de la API con el detalle que devolvió Postman. */
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
 * Sube la colección: la actualiza si ya existe una con el mismo
 * `_postman_id`, y si no la crea.
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

/** Sube un environment, con la misma semántica de crear-o-actualizar. */
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

/** Comprueba que la API key es válida. Devuelve el usuario asociado. */
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
// Internos
// ---------------------------------------------------------------------------

interface IRemoteItem {
  readonly uid: string;
  readonly id: string;
  readonly name: string;
}

/**
 * Busca una colección remota por su `_postman_id`.
 *
 * Postman conserva el `id` original de la colección importada, así que
 * comparar por ahí es lo que hace que un `push` repetido actualice en
 * lugar de duplicar.
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

  let response: FetchResponse;
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

/** Traduce el código HTTP a algo accionable. */
function explainStatus(status: number): string {
  if (status === 401) return "Invalid Postman API key (401).";
  if (status === 403) return "The API key does not have access to that workspace (403).";
  if (status === 404) return "Not found (404). Check the workspace id.";
  if (status === 429) return "Postman API rate limit reached (429). Try again in a minute.";
  return `The Postman API returned ${status}.`;
}
