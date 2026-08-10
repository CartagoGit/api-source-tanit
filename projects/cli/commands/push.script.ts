#!/usr/bin/env bun
/**
 * `export-to-postman push` — sube la colección directamente a Postman.
 *
 * Evita el paso manual de Import: genera y publica en el workspace del
 * usuario mediante la API pública de Postman. Como el `_postman_id` es
 * determinista por proyecto, ejecutarlo dos veces **actualiza** la
 * colección en lugar de duplicarla.
 *
 * La API key se saca de `--api-key` o de `POSTMAN_API_KEY`, y nunca se
 * imprime ni se escribe en disco.
 */
import { resolveRoot } from "../../core/helpers/resolve-root.helper.js";
import { generateWithAllFrameworks } from "../../frameworks/index.js";
import { buildEnvironments, defaultEnvironments } from "../../core/domain/environment-builder.service.js";
import { PostmanApiError, pushCollection, pushEnvironment, verifyApiKey } from "../../core/domain/postman-api.service.js";
import { readFlag } from "../../core/helpers/argv.helper.js";
import type {
  IPushFailure,
  IPushOutcome,
  IPushedArtifact,
} from "../../contracts/interfaces/cli/push-outcome.interface.js";

/** Lo que se devuelve cuando no se ha llegado a subir nada. */
function sinSubir(code: number, error: IPushFailure | null): IPushOutcome {
  return {
    code,
    user: null,
    framework: null,
    requests: 0,
    collection: null,
    environments: [],
    error,
  };
}

/**
 * Sube la colección y devuelve **lo que ha pasado**, imprimiéndolo por
 * el camino.
 *
 * `main` es la envoltura que solo devuelve el código de salida, igual
 * que en `generate`, `check` y `list`. Se separa porque el tool del
 * plugin necesita los datos: parsear estas líneas con expresiones
 * regulares se rompe a la primera traducción — ya pasó, y el tool
 * `generate` devolvía `ok: true` con `collectionPath: "<no detectado>"`.
 */
export async function runPush(
  argv: string[] = process.argv.slice(2),
): Promise<IPushOutcome> {
  const apiKey = readFlag(argv, "--api-key") ?? process.env["POSTMAN_API_KEY"] ?? "";
  if (!apiKey) {
    console.error("Missing Postman API key.\n");
    console.error("  export-to-postman push --api-key <key>");
    console.error("  POSTMAN_API_KEY=<key> export-to-postman push\n");
    console.error("Create one at https://postman.co/settings/me/api-keys");
    return sinSubir(1, {
      reason: "No Postman API key was given.",
      nextAction:
        "Pass `--api-key <key>` or set POSTMAN_API_KEY. Create one at " +
        "https://postman.co/settings/me/api-keys",
    });
  }

  const workspaceId = readFlag(argv, "--workspace") ?? undefined;
  const withEnvironments = !argv.includes("--no-environments");
  const options = { apiKey, workspaceId };

  // `push` **no leía `--project-root`**: usaba solo el singleton, así
  // que pasarle el flag no hacía nada. Ahora resuelve como los demás.
  const { root } = resolveRoot({ argv });
  if (!root) {
    console.error("Could not determine the project root.");
    console.error("Pass `--project-root <path>` or set POSTMAN_PROJECT_ROOT.");
    return sinSubir(1, {
      reason: "Could not determine the project root.",
      nextAction: "Pass `--project-root <path>` or set POSTMAN_PROJECT_ROOT.",
    });
  }

  let usuario: string;
  try {
    const user = await verifyApiKey(options);
    usuario = user.username;
    console.log(`→ Signed in to Postman as ${usuario}`);
  } catch (err) {
    return sinSubir(reportApiError(err), falloDeApi(err));
  }

  console.log("→ Scanning the project…");
  const basename = readFlag(argv, "--basename");
  // `--framework <id>` se salta la detección, igual que en `generate`.
  // Sin esto, quien necesita forzarlo podía generar los ficheros pero no
  // subirlos: el mismo proyecto funcionaba con un comando y no con el
  // otro, sin ninguna razón que se pudiera explicar.
  const forceFramework = readFlag(argv, "--framework");
  const result = await generateWithAllFrameworks(root, {
    ...(basename ? { collectionName: basename } : {}),
    ...(forceFramework ? { forceFramework } : {}),
  });

  const requestCount = countRequests(result.collection.item as IItem[]);
  if (requestCount === 0) {
    console.error("No endpoints were found, nothing to push.");
    console.error("Run `export-to-postman generate --inspect` to see what was detected.");
    return {
      ...sinSubir(1, {
        reason: "No endpoints were found, there is nothing to push.",
        nextAction:
          "Run `scan` on the same project to see what discovery finds, " +
          "or force the framework with `--framework <id>`.",
      }),
      user: usuario,
      framework: result.match?.framework ?? null,
    };
  }
  console.log(
    `  · ${result.match?.framework ?? "unknown"} · ${requestCount} requests`,
  );

  const subidos: IPushedArtifact[] = [];
  let coleccionSubida: IPushedArtifact | null = null;
  try {
    const pushed = await pushCollection(result.collection, options);
    coleccionSubida = { action: pushed.action, uid: pushed.uid, name: pushed.name };
    console.log(
      `✔ Collection ${pushed.action}: "${pushed.name}"` +
        (pushed.uid ? ` (${pushed.uid})` : ""),
    );

    if (withEnvironments) {
      const environments = buildEnvironments(
        [...result.specs],
        result.config.variables,
        [...(result.config.environments ?? defaultEnvironments(result.config.baseUrl))],
        result.collection.info._postman_id ?? "",
      );
      for (const environment of environments) {
        const pushedEnv = await pushEnvironment(environment, options);
        subidos.push({
          action: pushedEnv.action,
          uid: pushedEnv.uid,
          name: pushedEnv.name,
        });
        console.log(`  · Environment ${pushedEnv.action}: "${pushedEnv.name}"`);
      }
    }
  } catch (err) {
    return {
      ...sinSubir(reportApiError(err), falloDeApi(err)),
      user: usuario,
      framework: result.match?.framework ?? null,
      requests: requestCount,
      collection: coleccionSubida,
      environments: subidos,
    };
  }

  console.log("\nOpen Postman — the collection is already there.");
  return {
    code: 0,
    user: usuario,
    framework: result.match?.framework ?? null,
    requests: requestCount,
    collection: coleccionSubida,
    environments: subidos,
    error: null,
  };
}

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runPush(argv)).code;
}

interface IItem {
  item?: IItem[];
}

function countRequests(items: ReadonlyArray<IItem>): number {
  return items.reduce((total, i) => total + (i.item ? countRequests(i.item) : 1), 0);
}

/**
 * Traduce un fallo de la API a algo que se puede devolver a un agente.
 *
 * **Aquí es donde se decide qué NO sale.** `PostmanApiError.detail` es
 * el cuerpo que devuelve Postman, y eso es texto de un tercero: puede
 * traer la petición que lo causó, y con ella la cabecera `X-Api-Key`.
 * `push` es el único comando que maneja un secreto y el que un agente
 * va a invocar por su cuenta, así que lo que devuelva acaba en un
 * historial de conversación o en un log del host.
 *
 * Por eso el `detail` **no viaja**: se queda en la traza que ve la
 * persona, y al agente le va un motivo redactado con su salida. Un
 * secreto que se filtra por un mensaje de error no se puede retirar.
 */
function falloDeApi(err: unknown): IPushFailure {
  if (err instanceof PostmanApiError) {
    return {
      reason: err.message,
      nextAction:
        "Check that the key is still valid and has access to the workspace. " +
        "The full detail goes to the CLI trace; it is not returned here " +
        "because it can include the request, and with it the key." +
        "",
    };
  }
  return {
    reason: err instanceof Error ? err.message : String(err),
    nextAction: "Retry; if it persists, run `push` by hand to see the trace.",
  };
}

function reportApiError(err: unknown): number {
  if (err instanceof PostmanApiError) {
    console.error(`✗ ${err.message}`);
    if (err.detail) console.error(`  ${err.detail}`);
    return 1;
  }
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
