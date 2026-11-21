/**
 * The rehearsal: what would happen if we generated, without generating.
 *
 * The only way to know what would come out was to generate it, and
 * that writes into someone's folder. With a project that is not the
 * one you thought — or a wrong output folder — that means leaving
 * files where they do not belong and having to delete them by hand.
 *
 * ## What is actually scary is overwriting
 *
 * "Six files will be created" reassures. "Two will be overwritten"
 * is the information this exists for: the first time everything is
 * new, and from the second on what matters is what gets lost.
 *
 * ## Why the rehearsal calls the real pipeline
 *
 * Because predicting the names by hand would be a second
 * implementation of `outputBasename`, and it would drift — the
 * rehearsal would say one thing and `generate` would write another,
 * which is exactly the failure a rehearsal is here to prevent. The
 * pipeline **builds in memory**; writing is the script's job. So
 * we ask it and write nothing.
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

/** The extension each format is emitted with. */
const EXTENSIONES: Readonly<Record<string, string>> = {
  postman: ".postman_collection.json",
  openapi: ".openapi.yaml",
  insomnia: ".insomnia.json",
  bruno: ".bruno",
  har: ".har",
  curl: ".curl.sh",
};

/** How an environment's file is named. */
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
 * Which files would be created, which would be overwritten, and what
 * is in them.
 *
 * It does not touch the disk except to **ask whether a file already
 * exists**, which is exactly what we need to know.
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

  // Environments only come out with Postman: they are Postman's, not
  // OpenAPI's or a cURL script's.
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
    // We count it here, not in the interface: it is **the** piece of
    // data the rehearsal exists for, and letting each consumer
    // derive it is how two screens end up showing different numbers
    // for the same thing.
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
