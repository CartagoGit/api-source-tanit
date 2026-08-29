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
import type { IBalancedCall } from "../../contracts/interfaces/core/helpers.interface.js";

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
  // El **inicio** de la llamada se busca sobre la máscara: así una
  // escrita dentro de un texto —`'usa app.get("/x")'`— no cuenta como
  // una llamada. Los índices valen sobre el original porque la máscara
  // conserva la longitud, y el contenido se sigue leyendo de `text`,
  // donde los argumentos son los de verdad.
  //
  // Afectaba a Hono, Fastify y a los parsers de zod y Joi: cualquier
  // ejemplo en un comentario de cadena o en un texto de ayuda producía
  // un endpoint que no existe en ninguna parte.
  const masked = maskStringLiterals(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    // Una regex que puede casar vacío colgaría el bucle: forzamos avance.
    if (m[0].length === 0) re.lastIndex++;
    const callStart = masked.indexOf("(", m.index);
    if (callStart === -1) continue;
    // El paréntesis de cierre se busca en el ORIGINAL: un `)` dentro de
    // una cadena no cierra nada, y en la máscara ese carácter ya no
    // está.
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
  // La profundidad a la que una coma separa dos items del MISMO nivel.
  //
  // Depende de si quien llama incluye las llaves exteriores o no. Antes
  // estaba fijada a 1, o sea que solo funcionaba pasándolas — y sin
  // decirlo en ningún sitio. Pasar el cuerpo desnudo devolvía **un solo
  // item** con todo dentro, en silencio: el scanner de Hono se pasó así
  // un rato, extrayendo un campo de cuatro.
  const trimmed = body.trim();
  const wrapped =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  const separatorDepth = wrapped ? 1 : 0;

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

    if (c === "," && depth === separatorDepth) {
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

/**
 * Sustituye el **contenido** de las cadenas por espacios, conservando
 * las comillas y la longitud total.
 *
 * Sirve para responder a una pregunta que los scanners hacen todo el
 * rato sin saberlo: *¿esta llamada está de verdad en el código, o está
 * dentro de una cadena?* Un fichero con
 *
 *     const ayuda = 'usa router.get("/x") para registrar';
 *
 * producía un endpoint `GET /x` que no existe. El texto de una cadena no
 * es código, pero para un regex se lee igual.
 *
 * La longitud se conserva a propósito: así los desplazamientos de la
 * máscara valen sobre el fuente original, y se puede buscar en la
 * máscara y leer en el original. Sin eso habría que mantener un mapa de
 * posiciones, que es la clase de cosa que se desincroniza.
 *
 * Cubre comillas simples, dobles y plantillas. Dentro de una plantilla,
 * lo que va en `${…}` **sí** es código y se conserva: es donde viven las
 * interpolaciones que otros lints tienen que ver.
 */
export function maskStringLiterals(src: string): string {
  const out = src.split("");
  let i = 0;

  while (i < src.length) {
    const char = src[i];
    if (char !== '"' && char !== "'" && char !== "`") {
      i++;
      continue;
    }
    const quote = char;
    let j = i + 1;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === "\\") {
        // Un escape se lleva por delante el siguiente carácter, sea cual
        // sea: sin esto, un `"\\""` cierra donde no debe.
        out[j] = " ";
        if (j + 1 < src.length) out[j + 1] = " ";
        j += 2;
        continue;
      }
      // `${` dentro de una plantilla abre código de verdad.
      if (quote === "`" && c === "$" && src[j + 1] === "{") {
        depth++;
        j += 2;
        continue;
      }
      if (depth > 0) {
        if (c === "}") depth--;
        j++;
        continue;
      }
      if (c === quote) break;
      // Un salto de línea cierra una cadena de comillas simples o
      // dobles: si sigue abierta es que no era una cadena, y enmascarar
      // hasta el final del fichero se cargaría el resto del código.
      if (c === "\n" && quote !== "`") break;
      out[j] = " ";
      j++;
    }
    i = j + 1;
  }
  return out.join("");
}

/**
 * Las apariciones de `pattern` que están **fuera** de cualquier cadena.
 *
 * El truco tiene dos mitades y las dos hacen falta:
 *
 *   1. Se **busca** sobre la máscara, donde el contenido de las cadenas
 *      son espacios. Así una llamada escrita dentro de un texto —
 *      `'usa router.get("/x")'`— no aparece.
 *   2. Se **lee** del fuente original, en la misma posición. La máscara
 *      conserva la longitud justo para esto: el path de una ruta de
 *      verdad ES una cadena, así que en la máscara viene en blanco y
 *      leerlo de ahí daría rutas vacías.
 *
 * Saltarse la segunda mitad es fácil y el fallo es silencioso: los
 * grupos capturados salen llenos de espacios y las rutas se descartan
 * una a una sin que nada avise.
 */
export function findOutsideStrings(
  src: string,
  pattern: RegExp,
): Array<{ index: number; match: RegExpExecArray }> {
  const clean = stripJsComments(src);
  const masked = maskStringLiterals(clean);
  // Copias propias: mover el `lastIndex` del regex que nos pasan
  // rompería el bucle de quien llama (ver `lint:regex-state`).
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const finder = new RegExp(pattern.source, flags);
  // `y` (sticky) ancla la lectura exactamente donde la máscara encontró
  // la llamada, sin volver a buscar.
  const reader = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}y`);

  const out: Array<{ index: number; match: RegExpExecArray }> = [];
  let m: RegExpExecArray | null;
  while ((m = finder.exec(masked)) !== null) {
    if (m[0].length === 0) {
      finder.lastIndex++;
      continue;
    }
    reader.lastIndex = m.index;
    const real = reader.exec(clean);
    if (real) out.push({ index: m.index, match: real });
  }
  return out;
}
