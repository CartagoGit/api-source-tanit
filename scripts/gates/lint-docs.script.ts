#!/usr/bin/env bun
/**
 * `bun run lint:docs` — que la documentación no mienta.
 *
 * Comprueba cuatro cosas sobre lo que aparece en los `.md`:
 *
 *   1. Todo `bun run <script>` cita un script que existe en el
 *      `package.json`.
 *   2. Toda ruta de fichero que se menciona existe en el repo.
 *   3. Todo `expostman <comando>` es un comando que el CLI conoce.
 *   4. Todo enlace relativo apunta a algo que existe.
 *   5. Los números que la prosa afirma coinciden con la realidad.
 *
 * Existe porque la documentación se queda vieja en silencio y de la peor
 * manera: quien la sigue es alguien que acaba de llegar, y lo primero
 * que hace es un comando que no funciona. Ya pasó — al reorganizar en
 * `projects/`, `docs/INSTALL.md` seguía diciendo
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

/** Carpetas de documentación que se revisan. */
const DOC_ROOTS = ["docs", "examples", "."] as const;
/**
 * Las propuestas quedan fuera enteras.
 *
 * Una propuesta describe lo que **todavía no existe**: `p00040` pide un
 * `bun run docs:build` y `p00035` un `expostman ui`, y que no estén en
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
    entries = (await readdir(dir, { withFileTypes: true })) as never;
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
    const entries = (await readdir(join(REPO_ROOT, "examples"), {
      withFileTypes: true,
    })) as unknown as Array<{ name: string; isDirectory(): boolean }>;
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
      const { SUPPORTED_FRAMEWORKS } = await import("../../projects/frameworks/index.js");
      return SUPPORTED_FRAMEWORKS.length;
    },
  },
  {
    re: /\b(\d+)\s+frameworks?\s+(?:soportados?|autom|detect)/gi,
    what: "frameworks soportados",
    count: async () => {
      const { SUPPORTED_FRAMEWORKS } = await import("../../projects/frameworks/index.js");
      return SUPPORTED_FRAMEWORKS.length;
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
      const claimed = Number(match[1]);
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

/**
 * Comprueba que un enlace relativo apunta a algo que existe.
 *
 * Los externos (`http`, `mailto`) no se tocan: comprobarlos exigiría
 * red, y un gate que depende de la red falla los días que no toca.
 *
 * Esto también se quedaba viejo en silencio: `docs/FRAMEWORKS.md`
 * enlazaba `services/scanner-registry.ts` mucho después de que el
 * registro pasara a `projects/frameworks/framework.registry.ts`, y era
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

  for (const match of snippet.matchAll(/\bexpostman ([a-z][\w-]*)/g)) {
    const command = match[1]!;
    if (!known.commands.has(command)) {
      problems.push({
        ...where,
        detail: `\`expostman ${command}\` no es un comando del CLI`,
      });
    }
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
    join(REPO_ROOT, "projects", "cli", "cli.script.ts"),
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
    const lines = (await readFile(file, "utf8")).split("\n");
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
