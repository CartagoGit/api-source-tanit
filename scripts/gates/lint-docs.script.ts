#!/usr/bin/env bun
/**
 * `bun run lint:docs` — que la documentación no mienta.
 *
 * Comprueba cuatro cosas sobre lo que aparece en los `.md`:
 *
 *   1. Todo `bun run <script>` cita un script que existe en el
 *      `package.json`.
 *   2. Toda ruta de fichero que se menciona existe en el repo.
 *   3. Todo `apisrc <comando>` es un comando que el CLI conoce.
 *   4. Todo enlace relativo apunta a algo que existe.
 *   5. Los números que la prosa afirma coinciden con la realidad.
 *   6. Cada framework del registro tiene su sección en `FRAMEWORKS.md`.
 *   7. Cada comando del CLI se menciona en la documentación de usuario.
 *
 * Existe porque la documentación se queda vieja en silencio y de la peor
 * manera: quien la sigue es alguien que acaba de llegar, y lo primero
 * que hace es un comando que no funciona. Ya pasó — al reorganizar en
 * `packages/`, `docs/INSTALL.md` seguía diciendo
 * `bun run scripts/generate.script.ts`, que llevaba tres commits sin
 * existir.
 *
 * Se miran los bloques cercados **y el código en línea**. Al principio
 * solo los bloques, y por ahí se coló `examples/README.md` diciendo
 * durante varios commits que los números de su tabla se medían con
 * `bun run scripts/generate.script.ts` — un comando muerto, en la línea
 * que explica de dónde salen los datos. Un comando entre acentos graves
 * es una instrucción para quien lee, esté dentro de un bloque o no.
 *
 * Uso:
 *   bun run lint:docs
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { PACKAGE_JSON, REPO_ROOT } from "../helpers/root.helper.js";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant.js";

/** Carpetas de documentación que se revisan. */
const DOC_ROOTS = ["docs", "examples", "."] as const;
/**
 * Las propuestas quedan fuera enteras.
 *
 * Una propuesta describe lo que **todavía no existe**: `p00040` pide un
 * `bun run docs:build` y `p00035` un `apisrc ui`, y que no estén en
 * el `package.json` es precisamente su motivo de ser. Exigirles que
 * citen solo cosas existentes obligaría a llenarlas de exenciones y
 * convertiría el lint en ruido. Las cerradas, además, describen el
 * pasado.
 */
const SKIP = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "proposals",
  "retired",
  "legacy",
];

interface IProblem {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

async function collectMarkdown(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Números que la documentación afirma y que se pueden contar.
 *
 * "los 11 proyectos de `examples/`" era cierto cuando se escribió y
 * llevaba diez ejemplos sin serlo. Un número en prosa no lo comprueba
 * nadie: envejece igual que una ruta, pero encima parece inofensivo.
 *
 * Solo se vigilan los que se pueden contar sin ambigüedad. Un "cientos
 * de tests" no entra aquí, y no debería.
 */
interface ICountedClaim {
  /** Captura el número en el grupo 1. */
  readonly re: RegExp;
  /** Cómo se cuenta de verdad. */
  count(): Promise<number>;
  /** Qué se está contando, para el mensaje. */
  readonly what: string;
}

/**
 * Cuenta los proyectos de ejemplo **que el gate valida**.
 *
 * `example-app` no entra: no es un proyecto de API, es el ejemplo de
 * configuración manual. `validate.script.ts` lo excluye igual, y las dos
 * cuentas tienen que dar lo mismo o el lint acusaría a una frase que es
 * correcta.
 */
async function countExampleProjects(): Promise<number> {
  try {
    const entries = await readdir(join(REPO_ROOT, "examples"), {
      withFileTypes: true,
    });
    return entries.filter(
      (e) => e.isDirectory() && e.name.startsWith("example-") && e.name !== "example-app",
    ).length;
  } catch {
    return -1;
  }
}

const COUNTED_CLAIMS: ReadonlyArray<ICountedClaim> = [
  {
    re: /\b(?:los|las)\s+(\d+)\s+proyectos?\s+de\s+`?examples\/`?/gi,
    what: "proyectos en examples/",
    count: countExampleProjects,
  },
  {
    re: /\b(?:los|las)\s+(\d+)\s+scanners?\b/gi,
    what: "scanners registrados",
    count: async () => {
      return FRAMEWORK_IDS.length;
    },
  },
  {
    // Dos formas de afirmarlo: "N frameworks soportados" y el
    // "Funciona con **N**" de la portada, que es el que se coló.
    re: /\b(?:(\d+)\s+frameworks?\s+(?:soportados?|autom|detect)|[Ff]unciona con \*\*(\d+)\*\*)/g,
    what: "frameworks soportados",
    count: async () => {
      return FRAMEWORK_IDS.length;
    },
  },
];

/**
 * Ficheros que hablan del **pasado** y no se comparan con el presente.
 *
 * El CHANGELOG se genera de los mensajes de commit: "12 scanners" era
 * cierto el día que se escribió, y sigue siéndolo como afirmación
 * histórica. Corregirlo sería falsear el registro.
 */
const HISTORICAL = new Set(["CHANGELOG.md"]);

async function checkCounts(
  line: string,
  where: { readonly file: string; readonly line: number },
  problems: IProblem[],
): Promise<void> {
  if (HISTORICAL.has(where.file)) return;
  for (const claim of COUNTED_CLAIMS) {
    const own = new RegExp(claim.re.source, claim.re.flags);
    let match: RegExpExecArray | null;
    while ((match = own.exec(line)) !== null) {
      // Cualquiera de los grupos: cada forma de afirmarlo usa el suyo.
      const claimed = Number(match.slice(1).find((g) => g !== undefined));
      const real = await claim.count();
      if (real < 0 || claimed === real) continue;
      problems.push({
        ...where,
        detail: `dice ${claimed} ${claim.what}, y hay ${real}`,
      });
    }
  }
}

/** Código en línea: `` `así` ``. Un span no cruza líneas. */
const INLINE_CODE = /`([^`\n]+)`/g;

/** Enlaces markdown a rutas del repo: `[texto](../ruta/al/fichero.ts)`. */
const RELATIVE_LINK = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g;

/** Enlaces a una sección del mismo fichero: `[texto](#seccion)`. */
const ANCHOR_LINK = /\[[^\]]*\]\(#([^)\s]+)\)/g;

/**
 * El ancla que GitHub genera para un título.
 *
 * Minúsculas, los espacios a guiones, y fuera todo lo que no sea letra,
 * número o guion. `## Rust (Actix-web / Rocket)` acaba en
 * `rust-actix-web--rocket` — con el guion doble donde estaba la barra,
 * que es el detalle que nadie acierta a la primera.
 */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-");
}

/**
 * El documento sin lo que hay dentro de los bloques cercados, pero con
 * los mismos números de línea.
 *
 * Un documento que **enseña** markdown contiene enlaces que no son
 * enlaces suyos: son el ejemplo. Sin esto, la auditoría de 2026-08-08
 * —que cita `[OpenAPI](#openapi--swagger)` dentro de un bloque para
 * explicar por qué esa ancla sí es correcta— hacía fallar al gate
 * diciendo que el ancla no existía en la auditoría. Y tenía razón: no
 * existe, porque no es un enlace de ese fichero.
 *
 * Un gate que acusa en falso es peor que no tenerlo, porque el
 * siguiente que lo vea fallar sin motivo lo desactiva.
 *
 * Se sustituyen las líneas por vacías en vez de borrarlas para que el
 * número de línea que se reporta siga siendo el del fichero.
 */
function blankFencedCode(source: string): string {
  let inFence = false;
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

/**
 * Los enlaces a secciones del propio documento.
 *
 * Un ancla rota no rompe nada: lleva al principio de la página y parece
 * que el enlace "no ha ido". Es de los fallos más difíciles de ver
 * leyendo, y la tabla de `FRAMEWORKS.md` es toda enlaces así.
 */
function checkAnchors(
  source: string,
  where: { readonly file: string },
  problems: IProblem[],
): void {
  const headings = new Set(
    [...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => anchorOf(m[1] ?? "")),
  );
  const lines = blankFencedCode(source).split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const match of (lines[i] ?? "").matchAll(ANCHOR_LINK)) {
      const anchor = (match[1] ?? "").toLowerCase();
      if (headings.has(anchor)) continue;
      problems.push({
        file: where.file,
        line: i + 1,
        detail: `ancla rota: #${anchor} no es ninguna sección de este fichero`,
      });
    }
  }
}

/**
 * Comprueba que un enlace relativo apunta a algo que existe.
 *
 * Los externos (`http`, `mailto`) no se tocan: comprobarlos exigiría
 * red, y un gate que depende de la red falla los días que no toca.
 *
 * Esto también se quedaba viejo en silencio: `docs/FRAMEWORKS.md`
 * enlazaba `services/scanner-registry.ts` mucho después de que el
 * registro pasara a `packages/frameworks/framework.registry.ts`, y era
 * justo el enlace que le decías a alguien que quiere añadir un scanner.
 */
async function checkLinks(
  line: string,
  file: string,
  where: { readonly file: string; readonly line: number },
  problems: IProblem[],
): Promise<void> {
  for (const match of line.matchAll(RELATIVE_LINK)) {
    const target = match[1]!;
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    // Absoluta desde la raíz del repo, o relativa al fichero que enlaza.
    const resolved = target.startsWith("/")
      ? join(REPO_ROOT, target.slice(1))
      : join(dirname(file), target);
    if (!(await exists(resolved))) {
      problems.push({ ...where, detail: `enlace roto: ${target}` });
    }
  }
}

/**
 * Comprueba un fragmento de código, venga de un bloque o de un span.
 *
 * Es el mismo par de reglas en los dos sitios: separarlo evita que
 * cubrir uno y olvidar el otro vuelva a pasar.
 */
async function checkSnippet(
  snippet: string,
  where: { readonly file: string; readonly line: number },
  known: { readonly scripts: ReadonlySet<string>; readonly commands: ReadonlySet<string> },
  problems: IProblem[],
): Promise<void> {
  for (const match of snippet.matchAll(/\bbun run ([\w:./-]+)/g)) {
    const script = match[1]!;
    // `bun run --cwd <dir> …`: lo que sigue es una bandera de bun, no
    // el nombre de un script.
    if (script.startsWith("-")) continue;
    // `bun run <fichero.ts>` es válido: se comprueba como ruta.
    if (script.endsWith(".ts")) {
      if (!(await exists(join(REPO_ROOT, script)))) {
        problems.push({ ...where, detail: `no existe: ${script}` });
      }
    } else if (!known.scripts.has(script)) {
      problems.push({
        ...where,
        detail: `\`bun run ${script}\` no está en package.json`,
      });
    }
  }

  for (const match of snippet.matchAll(/\bapisrc ([a-z][\w-]*)/g)) {
    const command = match[1]!;
    if (!known.commands.has(command)) {
      problems.push({
        ...where,
        detail: `\`apisrc ${command}\` no es un comando del CLI`,
      });
    }
  }
}

/**
 * Las filas de tabla que documentan un comando: `| \`check\` | … |`.
 *
 * Se mira aparte de `apisrc <cmd>` porque una tabla no repite el
 * nombre del binario en cada fila, y ese hueco dejó pasar una entrada
 * muerta: `enrich` siguió documentado en `docs/INSTALL.md` después de
 * retirarse del CLI. Documentar un comando que no existe manda a
 * alguien a escribir algo que va a fallar.
 */
function checkCommandTableRows(
  source: string,
  commands: ReadonlySet<string>,
  where: { readonly file: string },
  problems: IProblem[],
): void {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\|\s*`([a-z][\w-]*)`\s*\|/.exec(lines[i] ?? "");
    if (!m) continue;
    const command = m[1] ?? "";
    // Solo cuenta como fila de comando si la tabla habla de comandos:
    // hay tablas de flags, de formatos y de frameworks con la misma
    // forma, y acusarlas a todas seria un gate que nadie puede pasar.
    const contexto = lines.slice(Math.max(0, i - 12), i).join("\n");
    if (!/[Cc]omando/.test(contexto)) continue;
    if (!commands.has(command)) {
      problems.push({
        file: where.file,
        line: i + 1,
        detail: `\`${command}\` se documenta como comando y el CLI no lo conoce`,
      });
    }
  }
}

/**
 * Que ningún framework del registro se quede sin documentar.
 *
 * `docs/FRAMEWORKS.md` no es documentación de cortesía: es a donde el
 * propio CLI manda a la gente cuando no encuentra endpoints —"Mira
 * docs/FRAMEWORKS.md para ver qué busca cada scanner"—. Un framework
 * soportado pero ausente de ahí manda a leer una página que no habla de
 * su caso, que es peor que no mandar a ninguna.
 *
 * Pasó con siete a la vez: hono, rust, rails, phoenix, ktor, graphql y
 * trpc. Cada uno se añadió con su fixture, su ejemplo y sus tests, y a
 * ninguno se le escribió la sección — porque nada la pedía.
 */
async function checkFrameworkSections(problems: IProblem[]): Promise<void> {
  const path = join(REPO_ROOT, "docs", "FRAMEWORKS.md");
  let doc: string;
  try {
    doc = await readFile(path, "utf8");
  } catch {
    problems.push({ file: "docs/FRAMEWORKS.md", line: 0, detail: "no existe" });
    return;
  }
  // Se busca por el enlace al ejemplo o al fixture, que es lo que hace
  // una sección de verdad: una mención suelta del nombre en otra sección
  // no cuenta como documentarlo.
  for (const framework of FRAMEWORK_IDS) {
    // `openapi` es el único cuyo ejemplo no sigue el patrón del nombre:
    // se llama `example-openapi-headers` porque lo que ejercita son las
    // cabeceras del spec.
    const documented =
      doc.includes(`examples/example-${framework}/`) ||
      doc.includes(`examples/example-${framework}-`) ||
      doc.includes(`tests/fixtures/${framework}-comprehensive/`);
    if (documented) continue;
    problems.push({
      file: "docs/FRAMEWORKS.md",
      line: 0,
      detail:
        `\`${framework}\` está en el registro y no tiene sección. ` +
        "El CLI manda a este fichero cuando no encuentra endpoints.",
    });
  }
}

/**
 * Que ningún comando del CLI se quede sin documentar.
 *
 * `push` y `watch` estuvieron en el dispatcher sin aparecer en **ningún**
 * fichero de `docs/` ni en el README. `push` sube la colección
 * directamente a Postman —de lo más útil que hace la herramienta— y no
 * había forma de enterarse salvo leyendo `--help` entero.
 *
 * Un comando que solo existe en el código es un comando que nadie usa.
 */
async function checkCommandsDocumented(
  commands: ReadonlySet<string>,
  problems: IProblem[],
): Promise<void> {
  // Solo la documentación de usuario: `docs/` y el README. Las notas
  // para agentes de `.github/` no cuentan — no las lee quien instala
  // la herramienta.
  const sources = ["README.md", "docs/INSTALL.md", "docs/FRAMEWORKS.md", "docs/POSTMAN.md"];
  const texts: string[] = [];
  for (const rel of sources) {
    try {
      texts.push(await readFile(join(REPO_ROOT, rel), "utf8"));
    } catch {
      // Un fichero que no existe ya lo dice otra comprobación.
    }
  }
  const all = texts.join("\n");
  for (const command of commands) {
    if (all.includes(`apisrc ${command}`)) continue;
    problems.push({
      file: "docs/INSTALL.md",
      line: 0,
      detail:
        `\`apisrc ${command}\` existe en el CLI y no se menciona en la ` +
        "documentación de usuario. Un comando que solo está en el código no lo usa nadie.",
    });
  }
}

async function main(): Promise<number> {
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));

  // Los comandos del CLI salen de su propio dispatcher, no de una lista
  // a mano: una lista paralela se queda vieja igual que la doc.
  const cliSource = await readFile(
    join(REPO_ROOT, "packages", "cli", "cli.script.ts"),
    "utf8",
  );
  const commands = new Set(
    [...cliSource.matchAll(/^\s{2}(\w[\w-]*):\s*\{/gm)].map((match) => match[1]!),
  );

  const files = new Set<string>();
  for (const root of DOC_ROOTS) {
    for (const file of await collectMarkdown(join(REPO_ROOT, root))) files.add(file);
  }

  const problems: IProblem[] = [];

  for (const file of [...files].sort()) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    const source = await readFile(file, "utf8");
    checkAnchors(source, { file: rel }, problems);
    checkCommandTableRows(source, commands, { file: rel }, problems);
    const lines = source.split("\n");
    let inFence = false;
    // Los docs enseñan a veces comandos de OTROS proyectos (el
    // `package.json` de quien usa la herramienta, por ejemplo). Un
    // comentario `lint:docs ignore` justo antes exime al bloque
    // siguiente, y obliga a decir por qué.
    let ignoreNextFence = false;
    let ignoringFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.includes("lint:docs ignore")) {
        ignoreNextFence = true;
        continue;
      }
      if (line.trimStart().startsWith("```")) {
        if (!inFence) {
          ignoringFence = ignoreNextFence;
          ignoreNextFence = false;
        }
        inFence = !inFence;
        continue;
      }
      if (ignoringFence) continue;

      const where = { file: rel, line: i + 1 };
      if (inFence) {
        await checkSnippet(line, where, { scripts, commands }, problems);
        continue;
      }
      // Fuera de un bloque solo cuenta lo que va entre acentos graves.
      // La prosa habla de comandos en pasado o en condicional, y no es
      // una instrucción que nadie vaya a copiar.
      for (const span of line.matchAll(INLINE_CODE)) {
        await checkSnippet(span[1]!, where, { scripts, commands }, problems);
      }
      await checkLinks(line, file, where, problems);
      await checkCounts(line, where, problems);
    }
  }

  await checkFrameworkSections(problems);
  await checkCommandsDocumented(commands, problems);

  if (problems.length > 0) {
    console.error(`lint:docs — ${problems.length} referencia(s) rota(s):\n`);
    for (const problem of problems) {
      console.error(`  ✗ ${problem.file}:${problem.line} — ${problem.detail}`);
    }
    return 1;
  }

  console.log(
    `lint:docs — ${files.size} ficheros, ${scripts.size} scripts y ` +
      `${commands.size} comandos citados existen`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
