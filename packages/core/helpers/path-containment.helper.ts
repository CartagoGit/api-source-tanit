/**
 * ¿Esta ruta se sale de donde debería escribir?
 *
 * `--output-dir` y `POSTMAN_OUTPUT_DIR` se aceptaban tal cual, sin
 * comprobar nada. En un CLI que ejecuta una persona sobre su propia
 * máquina eso es razonable: si alguien escribe `--output-dir /tmp/x`, es
 * porque quiere escribir ahí.
 *
 * Pero el plugin MCP **spawnea este mismo CLI** con argumentos que vienen
 * de un agente, y ahí quien elige la ruta ya no es necesariamente la
 * persona. Una ruta con `../` escribe fuera del proyecto.
 *
 * Dos detalles que hacen que esto funcione de verdad:
 *
 *   1. **Se resuelven los enlaces simbólicos antes de comparar.** Sin
 *      eso, un enlace dentro de la raíz apuntando fuera pasa la
 *      comprobación y escribe donde le da la gana.
 *   2. **Se compara por segmentos, no por prefijo de cadena.**
 *      `/a/raiz-mala` empieza por `/a/raiz` y no está dentro de ella.
 *      Es el fallo clásico de esta comprobación.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ContainmentResult } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * El ancestro existente más cercano.
 *
 * Hace falta porque la ruta de salida **normalmente no existe todavía**
 * —se va a crear— y `realpath` sobre algo que no existe falla. Se sube
 * hasta encontrar algo real, se resuelven ahí los enlaces, y se vuelve a
 * bajar. Así un enlace en mitad del camino tampoco se escapa.
 */
async function realpathOfNearestExisting(target: string): Promise<string> {
  let current = resolve(target);
  const pending: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return pending.length > 0 ? resolve(real, ...pending.reverse()) : real;
    } catch {
      const parent = resolve(current, "..");
      // Se llegó a la raíz del sistema sin encontrar nada existente.
      if (parent === current) return resolve(target);
      pending.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * ¿`target` está dentro de `root`?
 *
 * La propia raíz cuenta como dentro. Devuelve la ruta ya resuelta para
 * que quien llame use esa y no la original: comprobar una y escribir en
 * otra es como se saltan estas comprobaciones.
 */
export async function ensureInside(
  root: string,
  target: string,
): Promise<ContainmentResult> {
  return ensureInsideAny([root], target);
}

/**
 * ¿`target` está dentro de **alguna** de las raíces?
 *
 * Varias, y no una, porque una sola no describe el uso legítimo. Un
 * agente puede pedir "genera para el proyecto X y deja la salida en mi
 * carpeta de trabajo", y esas son dos ubicaciones distintas y las dos
 * razonables. Con una sola raíz eso se rechazaba, y un guardián que
 * bloquea el uso normal se acaba quitando.
 *
 * Lo que sí queda fuera es el resto del disco: la salida va con el
 * proyecto, dentro del workspace, o en un temporal — no al `$HOME` de
 * nadie porque un `../` se coló en un argumento.
 */
export async function ensureInsideAny(
  roots: ReadonlyArray<string>,
  target: string,
): Promise<ContainmentResult> {
  const primera = roots[0] ?? ".";
  const realTarget = await realpathOfNearestExisting(
    isAbsolute(target) ? target : resolve(primera, target),
  );

  const reales: string[] = [];
  for (const root of roots) {
    const realRoot = await realpathOfNearestExisting(root);
    reales.push(realRoot);
    const rel = relative(realRoot, realTarget);
    // Vacío = es la propia raíz. Con `..` al principio, o absoluto, se sale.
    const dentro =
      rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
    if (dentro) return { ok: true, resolved: realTarget };
  }

  return {
    ok: false,
    resolved: realTarget,
    reason: `'${realTarget}' queda fuera de ${reales.map((r) => `'${r}'`).join(", ")}`,
  };
}
