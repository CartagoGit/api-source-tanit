#!/usr/bin/env bun
/**
 * `expostman watch` — regenera la colección al guardar.
 *
 * Genera una vez y se queda mirando. Cada vez que algo cambia bajo la
 * raíz del proyecto, vuelve a generar y dice qué ha cambiado respecto de
 * la vez anterior.
 *
 * La carpeta de salida se ignora **siempre** — está dentro de lo que se
 * vigila, así que sin eso la primera escritura dispararía la siguiente y
 * no pararía nunca. Vive en `watcher.service.ts`, con sus tests.
 *
 * Uso:
 *   expostman watch --project-root ./mi-api
 *   expostman watch --project-root ./mi-api --once   # una pasada y sale
 *   expostman watch --format postman,openapi         # regenera los dos
 */
import { dirname, join, relative } from "node:path";
import { mkdir } from "node:fs/promises";

import {
  DEFAULT_FORMAT,
  exportTo,
  parseFormats,
} from "../../core/exporters/export-registry.service.js";

import { generateWithAllFrameworks } from "../../frameworks/index.js";
import { outputCollectionPath, outputDir, projectRoot, projectRootWasExplicit } from "../../core/discovery/paths.service.js";
import { countItems } from "../../core/helpers/postman.helper.js";
import { watchProject } from "../../core/domain/watcher.service.js";
import {
  writeFileAtomic,
  writeJsonAtomic,
} from "../../core/helpers/atomic-write.helper.js";

/** `18:05:42`, que es lo que hace legible una traza que va creciendo. */
function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** `+2` / `-1` / cadena vacía si no cambió. */
function delta(current: number, previous: number | null): string {
  if (previous === null || current === previous) return "";
  const diff = current - previous;
  return ` (${diff > 0 ? "+" : ""}${diff})`;
}

interface IRunResult {
  readonly requests: number;
  readonly folders: number;
  /** Ficheros escritos en formatos distintos de Postman. */
  readonly extra: number;
  readonly ms: number;
  readonly framework: string;
}

/**
 * Una generación completa: escanear, construir y escribir.
 *
 * Escribe **todos** los formatos pedidos, no solo Postman. Regenerar la
 * colección y dejar el `.openapi.yaml` de hace media hora al lado es
 * peor que no regenerar nada: los dos ficheros dicen cosas distintas del
 * mismo proyecto y no hay forma de saber cuál está al día.
 */
async function regenerate(
  root: string,
  forceFramework: string | null,
  formats: ReadonlyArray<string>,
): Promise<IRunResult> {
  const started = Date.now();
  const result = await generateWithAllFrameworks(root, {
    ...(forceFramework ? { forceFramework } : {}),
  });
  const path = await outputCollectionPath(result.config.name);
  await writeJsonAtomic(path, result.collection);

  let extra = 0;
  const others = formats.filter((f) => f !== DEFAULT_FORMAT);
  if (others.length > 0) {
    const dir = outputDir();
    const artifacts = exportTo(others, {
      specs: result.specs,
      config: result.config,
      auth: {
        type: result.authScheme.type,
        keyName: result.authScheme.keyName,
        keyIn: result.authScheme.keyIn,
      },
    });
    for (const artifact of artifacts) {
      const target = join(dir, artifact.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFileAtomic(target, artifact.content);
    }
    extra = artifacts.length;
  }

  const { requests, folders } = countItems(result.collection);
  return {
    requests,
    folders,
    extra,
    ms: Date.now() - started,
    framework: result.match?.framework ?? "unknown",
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const root = projectRoot();
  if (!root) {
    console.error("No se pudo determinar la raíz del proyecto.");
    console.error("Pasa `--project-root <ruta>` o define POSTMAN_PROJECT_ROOT.");
    return 1;
  }
  // `watch` se queda mirando un árbol entero, así que importa más que en
  // ningún otro comando saber **cuál**. Sin `--project-root` cae al
  // directorio actual, y lanzarlo desde el sitio equivocado recorría lo
  // que hubiera debajo sin decir una palabra.
  if (!projectRootWasExplicit()) {
    console.log(`→ Sin --project-root: se vigila el directorio actual (${root}).`);
  }

  const frameworkIdx = argv.indexOf("--framework");
  const forceFramework = frameworkIdx !== -1 ? (argv[frameworkIdx + 1] ?? null) : null;
  const debounceIdx = argv.indexOf("--debounce");
  const debounceMs =
    debounceIdx !== -1 ? Number(argv[debounceIdx + 1] ?? "") : undefined;
  if (debounceMs !== undefined && (!Number.isFinite(debounceMs) || debounceMs < 0)) {
    console.error("`--debounce` espera milisegundos, un número positivo.");
    return 1;
  }

  // `--format` vale aquí igual que en `generate`: se valida antes de la
  // primera pasada, no en el primer cambio de fichero.
  const formatIdx = argv.indexOf("--format");
  const parsedFormats = parseFormats(formatIdx !== -1 ? (argv[formatIdx + 1] ?? null) : null);
  if (!parsedFormats.ok) {
    console.error(
      `✗ Formato desconocido: ${parsedFormats.invalid.join(", ")}\n` +
        `  Válidos: ${parsedFormats.valid.join(", ")}`,
    );
    return 1;
  }
  const formats = parsedFormats.formats;

  // Una primera pasada antes de vigilar: si el proyecto no genera, más
  // vale enterarse ahora que quedarse esperando cambios en algo roto.
  let previous: IRunResult;
  try {
    previous = await regenerate(root, forceFramework, formats);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(
    `[${stamp()}] ✔ ${previous.requests} requests en ${previous.folders} carpetas ` +
      `· ${previous.framework}` +
      (previous.extra > 0 ? ` · +${previous.extra} en otros formatos` : "") +
      ` · ${previous.ms} ms`,
  );

  // `--once` genera y sale. Es lo que hace falta en un pipeline: la
  // comprobación de que la colección sigue saliendo, sin un proceso que
  // no termina nunca.
  if (argv.includes("--once")) return 0;

  console.log(`[${stamp()}] → vigilando ${root} (Ctrl+C para salir)`);

  let last = previous;
  const handle = watchProject({
    root,
    ...(debounceMs !== undefined ? { debounceMs } : {}),
    onChange: async (changed) => {
      const first = changed[0] ?? "?";
      const more = changed.length > 1 ? ` y ${changed.length - 1} más` : "";
      console.log(`[${stamp()}] · cambió ${relative(root, first) || first}${more}`);
      try {
        const now = await regenerate(root, forceFramework, formats);
        console.log(
          `[${stamp()}] ✔ ${now.requests}${delta(now.requests, last.requests)} requests ` +
            `en ${now.folders} carpetas` +
            (now.extra > 0 ? ` · +${now.extra} en otros formatos` : "") +
            ` · ${now.ms} ms`,
        );
        last = now;
      } catch (error) {
        // Un fallo no puede tumbar el watcher: lo normal mientras se
        // edita es que el fichero esté a medias un instante.
        console.error(`[${stamp()}] ✗ ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  // Ctrl+C cierra el watcher antes de salir. Sin esto queda el handle
  // abierto y el proceso no termina.
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      handle.close();
      console.log(`\n[${stamp()}] → watch detenido`);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
