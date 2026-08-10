/**
 * De dónde sale la raíz del proyecto, una sola vez.
 *
 * Cada comando la resolvía a su manera, y las tres formas discrepaban:
 *
 * | Comando | Cómo |
 * |---|---|
 * | `summary` | flag → `POSTMAN_PROJECT_ROOT` → `process.cwd()` |
 * | `scan` | flag → `POSTMAN_PROJECT_ROOT` → `projectRoot()` del singleton |
 * | `push` | `projectRoot()` del singleton, sin mirar el flag |
 *
 * Tres respuestas a la misma pregunta, y la de `push` ni siquiera leía
 * `--project-root`: pasárselo no hacía nada.
 *
 * Además, ninguna decía **de dónde** había salido la raíz, y eso importa
 * porque el último recurso es el directorio actual. Se midió con
 * `watch`: lanzado desde `/tmp`, recorrió el árbol, encontró un proyecto
 * suelto entre los temporales y generó su colección sin decir una
 * palabra. Desde `$HOME` recorrería la casa.
 *
 * Este helper responde las dos cosas: cuál es la raíz y **por qué es
 * esa**. Lo segundo es lo que permite avisar cuando se ha adivinado.
 */
import { resolve } from "node:path";

import { readFlag } from "./argv.helper.js";
import type {
  IResolveRootOptions,
  IResolvedRoot,
} from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * La raíz del proyecto: `--project-root`, luego `POSTMAN_PROJECT_ROOT`,
 * y como último recurso el directorio actual.
 *
 * El orden es el que ya tenían dos de los tres comandos, así que no
 * cambia el comportamiento de nadie — solo lo hace igual en todos y
 * añade de dónde vino.
 */
export function resolveRoot(options: IResolveRootOptions = {}): IResolvedRoot {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;

  const fromFlag = readFlag(argv, "--project-root");
  if (fromFlag !== undefined) {
    return { root: resolve(fromFlag), origin: "flag", explicit: true };
  }

  const fromEnv = env["POSTMAN_PROJECT_ROOT"];
  if (fromEnv !== undefined && fromEnv !== "") {
    return { root: resolve(fromEnv), origin: "env", explicit: true };
  }

  return { root: resolve(options.cwd ?? process.cwd()), origin: "cwd", explicit: false };
}

/**
 * El aviso de que la raíz se ha adivinado, o cadena vacía.
 *
 * Se devuelve en vez de imprimirse para que quien llama decida dónde va
 * —`console.log`, un informe JSON, la interfaz gráfica— y para que se
 * pueda probar sin capturar la salida.
 */
export function guessedRootNotice(resolved: IResolvedRoot): string {
  if (resolved.explicit) return "";
  return (
    `→ Sin --project-root: se usa el directorio actual (${resolved.root}).\n` +
    "  · Si no es tu proyecto, pásalo con `--project-root <ruta>`."
  );
}
