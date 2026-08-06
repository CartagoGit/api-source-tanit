/**
 * Primitivas de escaneo de código fuente compartidas por los scanners.
 *
 * Todos los scanners que leen código (Express, Next.js, NestJS…) necesitan
 * las mismas tres operaciones sobre texto plano:
 *
 *   1. Quitar comentarios antes de aplicar regex, para que un endpoint
 *      comentado no aparezca en la colección.
 *   2. Localizar una llamada `foo(` y encontrar su `)` de cierre
 *      respetando anidamiento (`findAllBalanced`, `findNearestBalanced`).
 *   3. Partir el interior de un object literal por comas de primer nivel
 *      sin romper strings ni objetos anidados (`splitTopLevel`).
 *
 * Vivían duplicadas en `express.scanner.ts` y `nextjs.scanner.ts`. La
 * copia de Next.js iteraba con `regex.exec()` sobre una regex **sin flag
 * `g`**, de modo que `lastIndex` nunca avanzaba y el bucle no terminaba
 * nunca. Centralizarlas aquí elimina el bug y la divergencia.
 */

/** Posición de una llamada balanceada: el `(` de apertura y su `)`. */
export interface IBalancedCall {
  /** Índice del `(` que abre la llamada. */
  readonly callStart: number;
  /** Índice del `)` que la cierra. */
  readonly callEnd: number;
}

/**
 * Elimina comentarios de bloque y de línea de un fuente JS/TS.
 *
 * El `//` se descarta solo si no viene precedido de `:`, para no partir
 * las URLs (`https://…`) que aparecen en literales de string.
 */
export function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Encuentra el `)` que cierra el `(` situado en `openIndex`, respetando
 * anidamiento. Devuelve `-1` si el paréntesis nunca se cierra.
 */
export function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Todas las ocurrencias de `pattern` en `text`, cada una con la posición
 * balanceada de su llamada.
 *
 * `pattern` debe describir el prefijo de una llamada (ej. `/z\.object\s*\(/`);
 * el `(` se busca a partir del inicio del match. La regex se re-crea
 * siempre con flag `g`, así que da igual cómo la declare quien llama.
 */
export function findAllBalanced(text: string, pattern: RegExp): IBalancedCall[] {
  const out: IBalancedCall[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Una regex que puede casar vacío colgaría el bucle: forzamos avance.
    if (m[0].length === 0) re.lastIndex++;
    const callStart = text.indexOf("(", m.index);
    if (callStart === -1) continue;
    const callEnd = findClosingParen(text, callStart);
    if (callEnd === -1) continue;
    out.push({ callStart, callEnd });
  }
  return out;
}

/**
 * De todas las llamadas que casan `pattern`, la más cercana (en número de
 * líneas) a `nearLine`. Sirve para asociar un schema al handler que lo
 * usa cuando un mismo archivo declara varios.
 */
export function findNearestBalanced(
  text: string,
  pattern: RegExp,
  nearLine: number,
): IBalancedCall | null {
  let best: IBalancedCall | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const call of findAllBalanced(text, pattern)) {
    const lineOfMatch = countLinesBefore(text, call.callStart);
    const distance = Math.abs(lineOfMatch - nearLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = call;
    }
  }
  return best;
}

/** Índice de línea (0-based) del carácter en `index`. */
export function countLinesBefore(text: string, index: number): number {
  let lines = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") lines++;
  }
  return lines;
}

/**
 * Parte el interior de un object literal por comas de primer nivel.
 *
 * Ignora las comas dentro de strings (`'`, `"`, backtick, con escapes) y
 * dentro de `()`, `{}` o `[]` anidados. La profundidad arranca en 1
 * porque el texto recibido incluye las llaves exteriores del objeto.
 */
export function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let buffer = "";

  for (let i = 0; i < body.length; i++) {
    const c = body[i];

    if (inString) {
      buffer += c;
      if (c === "\\") {
        buffer += body[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      inString = c;
      buffer += c;
      continue;
    }

    if (c === "(" || c === "{" || c === "[") {
      depth++;
      buffer += c;
      continue;
    }

    if (c === ")" || c === "}" || c === "]") {
      depth--;
      buffer += c;
      continue;
    }

    if (c === "," && depth === 1) {
      out.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += c;
  }

  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

/**
 * Quita las llaves exteriores y el espacio sobrante de un item devuelto
 * por `splitTopLevel` (el primero arrastra el `{`, el último el `}`).
 */
export function unwrapObjectLiteralItem(item: string): string {
  return item
    .replace(/^\s*\{\s*/, "")
    .replace(/\s*\}\s*$/, "")
    .trim();
}
