/**
 * Raíz efectiva del proyecto — a00014 S1.
 *
 * El helper centraliza lo que Express, Hono, NestJS y Next.js ya hacían
 * inline con `expressSearchRoot` / `honoEffectiveSearchRoot` /
 * `nestjsEffectiveSearchRoot` / `nextjsEffectiveSearchRoot`: resolver
 * la raíz donde un scanner debe mirar sus fuentes a partir de
 * `match.frameworkSearchRoot`, y devolver `match.projectRoot` cuando
 * ese campo está ausente.
 *
 * La diferencia con los inline es que **ningún scanner puede ignorar
 * `frameworkSearchRoot` por accidente**: en un monorepo el scanner
 * caminaba el árbol del workspace entero en lugar del subdirectorio
 * del framework, y se devolvían rutas vacías o contaminadas con las
 * de otros paquetes. Con este helper, los 21 scanners consumen la
 * misma primitiva, y el gate `lint:effective-project-root` rechaza
 * cualquier scanner que siga leyendo `match.projectRoot` directamente.
 *
 * ## Contrato
 *
 * - `effectiveProjectRoot(match)` y `effectiveSearchRoot(match)`
 *   son alias de la misma función. La segunda expone el nombre para
 *   callers que ya estaban usando `effectiveSearchRoot` en su scanner
 *   (Hono, NestJS, Next.js); comparten implementación porque la
 *   semántica es una sola.
 *
 * - Si `match.frameworkSearchRoot` es `undefined`, `null` o la cadena
 *   vacía, se devuelve `match.projectRoot` **sin modificar**. Los
 *   proyectos planos que no rellenan `frameworkSearchRoot` tienen el
 *   mismo comportamiento que antes.
 *
 * - Si `frameworkSearchRoot` es absoluto (empieza por `/` en POSIX o
 *   por la letra de unidad en Windows), se devuelve **verbatim** —
 *   sin unirlo a `projectRoot`. Un manifest puede declarar
 *   legítimamente que el framework vive fuera de la raíz del
 *   proyecto (un spec OpenAPI compartido, por ejemplo) y eso es
 *   decisión del host, no del helper.
 *
 * - En otro caso (relativo), se une `projectRoot` con
 *   `frameworkSearchRoot` mediante `path.resolve`, y se verifica que
 *   el resultado sigue dentro de `projectRoot` — un
 *   `frameworkSearchRoot` con `..` no debe poder escapar de
 *   `projectRoot`, ni siquiera cuando lo escribe un manifest del
 *   proyecto host. La verificación compara por segmento
 *   (`.startsWith(root + sep) || === root`), que es la forma correcta:
 *   un prefijo de cadena dejaría pasar `/tmp/raiz-mala` cuando la
 *   raíz es `/tmp/raiz`.
 *
 * - Si la verificación falla, **lanza** un `Error` con el framework,
 *   el `projectRoot` y el `frameworkSearchRoot` que la han
 *   provocado. No silencia. No devuelve la raíz sin más. Un scanner
 *   que ignora la verificación de contención es el mismo bug que
 *   estamos cerrando, sólo que más callado.
 *
 * - `rawProjectRoot(match)` devuelve `match.projectRoot` **tal cual**.
 *   Existe porque hay sitios donde el scanner necesita la raíz del
 *   usuario — el `projectRoot:` que devuelve al construir un
 *   `IProjectMatch`, o el `join` con un `route.sourceFile` ya
 *   relativo a `projectRoot` — y la gate quiere que esos sitios
 *   pasen por aquí en vez de leer `match.projectRoot` directamente.
 *
 * ## Por qué es puro
 *
 * El helper no lee `process.cwd()`, no toca el sistema de archivos y
 * no tiene estado. Es una función determinista sobre sus argumentos.
 * Eso permite que el contrato se pruebe sin fixtures en
 * `tests/core/effective-project-root.helper.spec.ts` y que el lint
 * universal de `no process.cwd / process.env` no le diga nada.
 *
 * @see ./scan-root.helper.ts para `effectiveScanRoot`, que es el
 *   espejo de este helper orientado al caso "raíz del filesystem que
 *   se va a leer" en lugar de "raíz que el scanner reporta".
 * @see ../../../scripts/gates/lint-effective-project-root.script.ts
 *   para el gate que rechaza scanners incompatibles.
 */
import { isAbsolute, resolve, sep } from "node:path";

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * La raíz efectiva del proyecto, honrando `frameworkSearchRoot`.
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
export function effectiveProjectRoot(match: IProjectMatch): string {
  return resolveProjectRoot(match);
}

/**
 * Alias de `effectiveProjectRoot` con el nombre que ya usaban Hono,
 * NestJS y Next.js en sus helpers inline. Si un scanner está
 * migrando del helper local al central, puede seguir llamando a su
 * función favorita sin un cambio extra.
 *
 * El comportamiento es idéntico al de `effectiveProjectRoot`: misma
 * resolución, misma guarda, mismo error. Sólo cambia el nombre para
 * no romper call sites existentes.
 */
export function effectiveSearchRoot(match: IProjectMatch): string {
  return resolveProjectRoot(match);
}

/**
 * La raíz real del proyecto, sin tocar.
 *
 * Devuelve `match.projectRoot` tal cual. Existe para que un scanner
 * que necesita la raíz del usuario — el `projectRoot:` del
 * `IProjectMatch` que devuelve al orquestador, o un `join` con un
 * `route.sourceFile` ya relativo a `projectRoot` — pase por un
 * helper en vez de leer `match.projectRoot` directamente. Así el
 * gate `lint:effective-project-root` puede controlar todas las
 * referencias a `match.projectRoot` en una sola lista blanca.
 */
export function rawProjectRoot(match: IProjectMatch): string {
  return match.projectRoot;
}

/**
 * Implementación única de las dos exportaciones con guarda. No se
 * exporta a propósito: añadir una tercera función de idéntico
 * comportamiento diluiría el contrato. Si algún futuro caller
 * necesita otra variante, que se abra sobre esta misma lógica.
 */
function resolveProjectRoot(match: IProjectMatch): string {
  const root = match.projectRoot;
  const requested = match.frameworkSearchRoot;
  if (requested === undefined || requested === null || requested === "") {
    return root;
  }
  // Absoluto: verbatim — un framework que vive fuera del projectRoot
  // (típicamente un manifest que apunta a un spec global) es decisión
  // del host, no del helper. La gate y el contrato siguen dejando
  // eso en manos del orquestador.
  if (isAbsolute(requested)) {
    return requested;
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
