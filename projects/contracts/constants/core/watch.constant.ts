/**
 * Las carpetas que `watch` no mira.
 *
 * Vigilar un árbol entero significa un descriptor por directorio y un
 * evento por cada fichero que toca cualquier proceso. `node_modules` es
 * el caso extremo: un `bun install` a medias dispara miles de eventos y
 * ninguno es un endpoint.
 *
 * Es contrato porque la lista la comparten quien vigila y quien recorre:
 * dos criterios distintos harían que un cambio se detectara y no se
 * escaneara, o al revés.
 */

import { OUTPUT_DIR_NAME } from "./postman.constant.js";

/**
 * Carpetas que nunca aportan rutas y sí mucho ruido.
 *
 * `node_modules` es el caso extremo: un `bun install` a medias dispara
 * miles de eventos y ninguno es un endpoint.
 */
/** Nombres de carpeta que no se vigilan ni se recorren. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  OUTPUT_DIR_NAME,
  "node_modules",
  "vendor",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "coverage",
  "tmp",
]);
