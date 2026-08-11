/**
 * El ensayo: qué pasaría si se generara, sin generar.
 *
 * La única forma de saber qué iba a salir era generarlo, y eso escribe
 * en la carpeta de alguien. Con un proyecto que no es el que creías —o
 * una carpeta de salida equivocada— eso significa dejar ficheros donde
 * no van y tener que borrarlos a mano.
 *
 * ## Lo que de verdad asusta es sobrescribir
 *
 * «Se van a crear seis ficheros» tranquiliza. «Se van a sobrescribir
 * dos» es la información por la que existe esto: la primera vez todo es
 * nuevo, y a partir de la segunda lo interesante es qué se pierde.
 *
 * ## Por qué el ensayo llama al pipeline de verdad
 *
 * Porque predecir los nombres a mano sería una segunda implementación de
 * `outputBasename`, y se desincronizaría — el ensayo diría una cosa y
 * `generate` escribiría otra, que es exactamente el fallo que un ensayo
 * viene a evitar. El pipeline **construye en memoria**; escribir es cosa
 * del script. Así que se le pregunta a él y no se escribe nada.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  IDryRunInput,
  IDryRunPlan,
  IPlannedFile,
} from "../../contracts/interfaces/cli/dry-run.interface.js";
import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_FORMATS,
} from "../../contracts/constants/core/export-formats.constant.js";
import { OUTPUT_DIR_NAME } from "../../contracts/constants/core/postman.constant.js";

/** La extensión con la que sale cada formato. */
const EXTENSIONES: Readonly<Record<string, string>> = {
  postman: ".postman_collection.json",
  openapi: ".openapi.yaml",
  insomnia: ".insomnia.json",
  bruno: ".bruno",
  har: ".har",
  curl: ".curl.sh",
};

/** Cómo se llama el fichero de un entorno. */
function nombreDeEntorno(base: string, entorno: string): string {
  const slug = entorno
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base}.${slug}.postman_environment.json`;
}

/**
 * Qué ficheros se crearían, cuáles se sobrescribirían, y qué hay dentro.
 *
 * No toca el disco salvo para **preguntar si un fichero ya está**, que
 * es justamente lo que hay que saber.
 */
export function planDryRun(input: IDryRunInput): IDryRunPlan {
  const salida = input.outputDir ?? join(input.projectRoot, OUTPUT_DIR_NAME);
  const base = input.result.config.name;

  const pedidos =
    input.formats && input.formats.length > 0
      ? [...input.formats]
      : [DEFAULT_EXPORT_FORMAT];

  const desconocidos = pedidos.filter(
    (f) => !(EXPORT_FORMATS as ReadonlyArray<string>).includes(f),
  );

  const files: IPlannedFile[] = [];

  for (const formato of pedidos) {
    const extension = EXTENSIONES[formato];
    if (extension === undefined) continue;
    const ruta = join(salida, `${base}${extension}`);
    files.push({
      path: ruta,
      kind: formato === DEFAULT_EXPORT_FORMAT ? "collection" : "export",
      format: formato,
      overwrites: existsSync(ruta),
    });
  }

  // Los entornos solo salen con Postman: son suyos, no de OpenAPI ni de
  // un script de cURL.
  if (pedidos.includes(DEFAULT_EXPORT_FORMAT)) {
    for (const entorno of input.result.config.environments ?? []) {
      const ruta = join(salida, nombreDeEntorno(base, entorno.name));
      files.push({
        path: ruta,
        kind: "environment",
        format: DEFAULT_EXPORT_FORMAT,
        overwrites: existsSync(ruta),
      });
    }
  }

  return {
    ok: desconocidos.length === 0,
    outputDir: salida,
    projectName: base,
    framework: input.result.match?.framework ?? null,
    requests: input.result.specs.length,
    files,
    // Se cuenta aquí y no en la interfaz: es **el** dato del ensayo, y
    // dejar que cada consumidor lo derive es cómo dos pantallas acaban
    // diciendo cifras distintas de lo mismo.
    overwrites: files.filter((f) => f.overwrites).length,
    warnings: [...input.result.warnings],
    ...(desconocidos.length > 0
      ? {
          reason:
            `Unknown formats: ${desconocidos.join(", ")}. ` +
            `Valid ones are: ${EXPORT_FORMATS.join(", ")}.`,
        }
      : {}),
  };
}
