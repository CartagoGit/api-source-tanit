/**
 * Raíz efectiva de escaneo de un scanner — a00012 S1.b.
 *
 * Antes de este helper, cada scanner decidía por su cuenta dónde leer
 * sus fuentes. Tres de ellos (`fastify.scanner.ts`, `fiber.scanner.ts`,
 * `rust.scanner.ts`) pasaban `match.projectRoot` directamente al
 * `collectFiles(...)`, ignorando `match.frameworkSearchRoot`: en un
 * monorepo el scanner caminaba el árbol del workspace entero en vez
 * del subdirectorio del framework, y se devolvían rutas vacías o
 * contaminadas con las de otros paquetes.
 *
 * Hono, NestJS y Next.js ya resolvían esto inline con un
 * `honoEffectiveSearchRoot` / `nestjsEffectiveSearchRoot` /
 * `effectiveSearchRoot` propio. Este helper los **centraliza** y
 * añade la verificación de contención que les faltaba: un
 * `frameworkSearchRoot` con `..` no debe poder escapar de
 * `projectRoot`, ni siquiera cuando lo escribe un manifest del
 * proyecto host.
 *
 * ## Contrato
 *
 * - `effectiveScanRoot(match)` y `safeScanRoot(match)` son alias de
 *   la misma función. La segunda expone el nombre para callers que
 *   quieren dejar explícito que el helper puede lanzar si el
 *   `frameworkSearchRoot` apunta fuera de `projectRoot`; ambas
 *   comparten implementación porque la seguridad de contención no es
 *   opcional.
 *
 * - Si `match.frameworkSearchRoot` es `undefined`, `null` o la
 *   cadena vacía, se devuelve `match.projectRoot` **sin modificar**
 *   (no se llama a `path.resolve`, no se hace ninguna operación).
 *   Los proyectos planos que no rellenan `frameworkSearchRoot`
 *   tienen el mismo comportamiento que antes.
 *
 * - En otro caso, se une `projectRoot` con `frameworkSearchRoot`
 *   mediante `path.resolve`, y se verifica que el resultado sigue
 *   dentro de `projectRoot`. La verificación compara por segmento:
 *   `.startsWith(root + sep) || === root`, que es la forma correcta
 *   (un prefijo de cadena dejaría pasar `/tmp/raiz-mala` cuando la
 *   raíz es `/tmp/raiz`).
 *
 * - Si la verificación falla, **lanza** un `Error` con el framework,
 *   el `projectRoot` y el `frameworkSearchRoot` que la han
 *   provocado. No silencia. No devuelve la raíz sin más. Un scanner
 *   que ignora la verificación de contención es el mismo bug que
 *   estamos cerrando, sólo que más callado.
 *
 * ## Por qué es puro
 *
 * El helper no lee `process.cwd()`, no toca el sistema de archivos y
 * no tiene estado. Es una función determinista sobre sus argumentos,
 * igual que `effectiveSearchRoot` en `nextjs.scanner.ts`. Eso permite
 * que el contrato se pruebe sin fixtures en
 * `tests/frameworks/scan-root-contract.spec.ts` y que el lint
 * universal de `no process.cwd / process.env` no le diga nada.
 */
import { resolve, sep } from "node:path";

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * La raíz donde un scanner debe mirar sus fuentes.
 *
 * - Sin `frameworkSearchRoot` → `match.projectRoot` (compatibilidad
 *   con proyectos planos y con los tests que no rellenan el campo).
 * - Con `frameworkSearchRoot` → `path.resolve(projectRoot,
 *   frameworkSearchRoot)`, siempre que el resultado siga dentro de
 *   `projectRoot`.
 *
 * Lanza un `Error` claro si `frameworkSearchRoot` apunta fuera de
 * `projectRoot` (típicamente porque contiene `..` o es absoluto).
 */
export function effectiveScanRoot(match: IProjectMatch): string {
  return resolveScanRoot(match);
}

/**
 * Alias de `effectiveScanRoot` con un nombre que enfatiza que el
 * helper **puede lanzar** cuando la ruta de búsqueda escapa de la
 * raíz del proyecto. Útil cuando el llamante quiere dejar explícito
 * que está haciendo una verificación de contención (por ejemplo, en
 * pipelines de varios pasos donde conviene que el `try`/`catch`
 * quede claro).
 *
 * El comportamiento es idéntico al de `effectiveScanRoot`: misma
 * resolución, misma guarda, mismo error. Sólo cambia el nombre para
 * que el código que la usa pueda expresar su intención.
 */
export function safeScanRoot(match: IProjectMatch): string {
  return resolveScanRoot(match);
}

/**
 * Implementación única de las dos exportaciones públicas. No se
 * exporta a propósito: añadir una tercera función de idéntico
 * comportamiento diluiría el contrato. Si algún futuro caller
 * necesita otra variante, que se abra sobre esta misma lógica.
 */
function resolveScanRoot(match: IProjectMatch): string {
  const root = match.projectRoot;
  const requested = match.frameworkSearchRoot;
  if (requested === undefined || requested === null || requested === "") {
    return root;
  }
  const resolved = resolve(root, requested);
  const inside = resolved === root || resolved.startsWith(root + sep);
  if (!inside) {
    throw new Error(
      `frameworkSearchRoot inválido para framework "${match.framework}": ` +
        `"${requested}" resuelto a "${resolved}" queda fuera de ` +
        `projectRoot "${root}"`,
    );
  }
  return resolved;
}
