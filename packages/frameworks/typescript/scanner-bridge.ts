/**
 * `scanner-bridge` — adapta el LanguageIR (S2+S3+S4) al shape
 * `TSMethodCall` que los 6 scanners TS-flavored consumen.
 *
 * (a00016 S5) Los scanners Express, NestJS, Fastify, Hono, Next.js
 * y tRPC leían `ast.methodCalls` del frontend TS (a00010 S7). Ese
 * shape es un subconjunto del nuevo LanguageIR: cubre sólo
 * `Identifier.method` y deja fuera `this.router.get`,
 * `server["get"]`, `app[M]`, etc.
 *
 * Este módulo es el **adapter** que traduce `IRouteCallExpression[]`
 * (multi-estilo) a `TSMethodCall[]` (legacy single-estilo), de modo
 * que la lógica de extracción de rutas dentro de cada scanner
 * (`for (const call of ast.methodCalls) { ... }`) sigue funcionando
 * sin reescribirse. La diferencia es que el scanner ahora ve
 * llamadas que antes eran invisibles.
 *
 * Por qué NO se reescriben los scanners para consumir
 * `IRouteCallExpression` directamente:
 *   - 6 scanners × 200–700 líneas cada uno = ~3000 líneas de código
 *     que tocar. Bridge es ~150 líneas.
 *   - El shape `TSMethodCall` ya tiene `args: TSLiteral[]`,
 *     `line`/`column` y `bodyRange`. Lo único que cambia con el
 *     LanguageIR es `callee` (multi-segmento vs simple "app.get")
 *     y la presencia de `resolvedMethod` (S4) — que el bridge
 *     aplana antes de entregar.
 *
 * Lo que el módulo SÍ hace:
 *   - Construye el `callee` canónico `"receiver.method"`.
 *   - Si `resolvedMethod` está presente (S4), lo usa como `method`.
 *   - Convierte el offset en bytes a `(line, column)` 1-based.
 *
 * Lo que el módulo NO hace:
 *   - No reemplaza al frontend TS: el frontend sigue produciendo
 *     `TSFile` con `imports`, `assignments`, `classes`, `decorators`
 *     para los scanners que los necesitan (NestJS, Next.js, tRPC).
 *     Sólo la parte `methodCalls` se redirige al LanguageIR.
 *   - No resuelve tipos ni scopes — S2/S3/S4 ya hicieron su trabajo.
 */

import type { TSMethodCall } from "../../contracts/interfaces/core/language/typescript-frontend.interface.js";
import type { TSLiteral } from "../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import type { IRouteCallExpression } from "../../contracts/interfaces/core/language-ir.interface.js";

/**
 * Convierte un offset en bytes (0-based) sobre `source` a
 * `(line, column)` 1-based (line) / 0-based (column) — el mismo
 * shape que `TSMethodCall.line` / `column`.
 *
 * Si el offset cae fuera del rango, devuelve `{ line: 1, column: 0 }`
 * (la posición por defecto del frontend TS).
 */
function offsetToPosition(source: string, offset: number): { line: number; column: number } {
  if (offset < 0 || offset > source.length) return { line: 1, column: 0 };
  let line = 1;
  let column = 0;
  for (let i = 0; i < offset; i++) {
    const ch = source.charCodeAt(i);
    if (ch === 10) {
      // `\n` (LF).
      line += 1;
      column = 0;
      continue;
    }
    if (ch === 13) {
      // `\r` o `\r\n` — count `\r` como salto, pero si viene
      // seguido de `\n` no sumamos otra línea.
      line += 1;
      column = 0;
      if (i + 1 < offset && source.charCodeAt(i + 1) === 10) i += 1;
      continue;
    }
    column += 1;
  }
  return { line, column };
}

/**
 * Resuelve el `callee` canónico `"receiver.method"` para una
 * `IRouteCallExpression`.
 *
 * Tres casos:
 *   - `method` no vacío → `${prefix}.${method}` (con el prefix que
 *     ya viene en `callee` cuando no es computed, o reconstruido).
 *   - `method` vacío + `resolvedMethod` (S4) → `prefix[resolvedMethod]`
 *     (forma del callee textual con corchetes).
 *   - `method` vacío sin resolver → devuelve el `callee` tal cual
 *     (el scanner lo descarta).
 */
function resolveCanonicalCallee(expr: IRouteCallExpression): string {
  // Si `method` está relleno, ya tenemos la forma canónica en
  // `callee` (S2 la emite como `"receiver.method"`). Lo devolvemos
  // sin tocarlo.
  if (expr.method) {
    return expr.callee;
  }
  // `resolvedMethod` (S4) puede salvar un callee que parecía
  // unresoluble. Emitimos `"receiver[method]"` para mantener la
  // pista textual de que era computed.
  if (expr.resolvedMethod) {
    // `callee` ya tiene la forma `"app[M]"` (S2). Reemplazamos el
    // identifier entre corchetes por el valor resuelto.
    return expr.callee.replace(/\[[^\]]+\]$/, `["${expr.resolvedMethod}"]`);
  }
  // Sin resolver: devolvemos el callee original. El scanner lo
  // descarta porque `split(".")` da una pieza sin método.
  return expr.callee;
}

/**
 * Convierte `IRouteCallExpression[]` al shape `TSMethodCall[]` que
 * los scanners TS-flavored consumen.
 *
 * El orden de salida es el mismo que el de entrada (top-down por
 * archivo), preservado por S2. Los scanners que ordenan por línea
 * pueden usar la `line` resultante directamente.
 */
export function toTSMethodCalls(
  calls: ReadonlyArray<IRouteCallExpression>,
  source: string,
): TSMethodCall[] {
  const out: TSMethodCall[] = [];
  for (const expr of calls) {
    const callee = resolveCanonicalCallee(expr);
    // Si no hay método (ni `method` ni `resolvedMethod`) y el
    // `callee` no contiene un punto, el scanner no puede hacer nada
    // con esto. Lo descartamos silenciosamente.
    if (!callee.includes(".") && !callee.includes("[")) continue;
    const { line, column } = offsetToPosition(source, expr.range.start);
    const args: TSLiteral[] = expr.args.map((arg) => ({
      kind: arg.kind,
      ...(arg.value !== undefined ? { value: arg.value } : {}),
      ...(arg.identifierName !== undefined ? { identifierName: arg.identifierName } : {}),
      ...(arg.objectShape !== undefined ? { objectShape: arg.objectShape } : {}),
      ...(arg.arrayItems !== undefined ? { arrayItems: arg.arrayItems } : {}),
      ...(arg.bodyRange !== undefined ? { bodyRange: arg.bodyRange } : {}),
    }));
    out.push({
      callee,
      args,
      line,
      column,
    });
  }
  return out;
}
