/**
 * Registro de secciones del repo — la única fuente de verdad.
 *
 * Una "sección" es una zona del proyecto con su propio código, sus
 * propios tests, su propio tsconfig y sus propios lints. Se declara
 * **una vez** aquí y la consumen cuatro sitios:
 *
 *   - `vitest.config.ts`      → un `project` de vitest por sección.
 *   - `scripts/gates/typecheck.script.ts` → un `tsc -p` por sección.
 *   - `scripts/gates/changed.script.ts`   → qué secciones toca un diff.
 *   - `scripts/gates/lint-sections.script.ts` → que nadie cruce límites.
 *
 * El motivo de que sea un único fichero es que las cuatro cosas se
 * desincronizan solas si cada una lleva su propia lista: se añade un
 * scanner, se olvida el tsconfig, y el gate deja de mirar esa carpeta
 * sin que nadie se entere (que es exactamente lo que llevaba pasando
 * con `plugins/`).
 *
 * Orden de la lista = orden de ejecución en los gates: lo más barato y
 * lo más nuclear primero, para fallar pronto.
 */

/** Una zona del repo con gates propios. */
export interface ISection {
  /** Identificador corto. Es el nombre del `project` de vitest. */
  readonly name: string;
  /** Qué contiene, en una línea. Sale en el `--help` de los gates. */
  readonly description: string;
  /**
   * Prefijos de ruta que pertenecen a la sección. Se comparan contra
   * rutas relativas a la raíz del repo, con `/` como separador.
   */
  readonly paths: readonly string[];
  /** Globs de sus tests, relativos a la raíz. */
  readonly tests: readonly string[];
  /** Su tsconfig, relativo a la raíz. */
  readonly tsconfig: string;
  /**
   * Secciones que se tipan con su propio script en vez de con un
   * `tsc -p` desde la raíz.
   *
   * El plugin es un paquete aparte: usa `@types/node` y `@types/bun`
   * mientras el CLI usa declaraciones ambient escritas a mano, y tiene
   * DOS proyectos (el que se publica y el de sus tests). Lanzarlo desde
   * la raíz mezcla los dos mundos y salen errores fantasma.
   */
  readonly ownTypecheck?: { readonly cwd: string; readonly script: string };
  /**
   * Secciones de las que puede depender. `core` no puede importar de
   * `frameworks` — esa es la regla que mantiene el núcleo agnóstico.
   */
  readonly dependsOn: readonly string[];
}

export const SECTIONS: readonly ISection[] = [
  {
    name: "core",
    description: "Núcleo agnóstico: vale igual para cualquier API",
    paths: ["contracts/", "helpers/", "services/"],
    tests: ["tests/core/**/*.{spec,test}.ts"],
    tsconfig: "tsconfig.core.json",
    dependsOn: [],
  },
  {
    name: "frameworks",
    description: "Lo concreto de cada framework: los 12 scanners y sus parsers",
    paths: ["frameworks/"],
    tests: ["tests/frameworks/**/*.{spec,test}.ts"],
    tsconfig: "tsconfig.frameworks.json",
    dependsOn: ["core"],
  },
  {
    name: "cli",
    description: "Comandos, asistente interactivo y binario compilado",
    paths: ["scripts/"],
    tests: ["tests/cli/**/*.{spec,test}.ts"],
    tsconfig: "tsconfig.cli.json",
    dependsOn: ["core", "frameworks"],
  },
  {
    name: "e2e",
    description: "Pipeline completo por framework, de fuente a colección",
    paths: ["tests/e2e/", "tests/fixtures/", "examples/"],
    tests: ["tests/e2e/**/*.{spec,test}.ts"],
    tsconfig: "tsconfig.cli.json",
    dependsOn: ["core", "frameworks", "cli"],
  },
  {
    name: "plugin",
    description: "Plugin de mcp-vertex — proyecto independiente, gates propios",
    paths: ["plugins/"],
    tests: ["plugins/*/tests/**/*.{spec,test}.ts"],
    tsconfig: "plugins/postman-exporter/tsconfig.json",
    ownTypecheck: { cwd: "plugins/postman-exporter", script: "typecheck" },
    // El plugin necesita el catálogo de frameworks (lo expone en su
    // tool `test` y en `summary`), así que la dependencia es real y se
    // declara. Declararla no es relajar la regla: la regla es que
    // `core` no dependa de `frameworks`, y eso sigue en pie.
    dependsOn: ["core", "frameworks", "cli"],
  },
] as const;

/** Ficheros que no pertenecen a ninguna sección pero afectan a todas. */
export const GLOBAL_PATHS: readonly string[] = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
  "tsconfig.base.json",
  "vitest.config.ts",
  "scripts/gates/",
];

/** Busca una sección por nombre. */
export function sectionByName(name: string): ISection | undefined {
  return SECTIONS.find((section) => section.name === name);
}

/**
 * Devuelve las secciones que toca una lista de ficheros cambiados.
 *
 * Si el cambio pisa algo global (el `package.json`, el tsconfig raíz,
 * la propia maquinaria de gates) devuelve **todas**: no hay forma
 * barata de saber qué se rompe, así que se corre entero.
 *
 * El matcheo es por prefijo y **el más largo gana**, para que
 * `services/scanners/gin.scanner.ts` caiga en `frameworks` y no en
 * `core` (que declara el `services/` a secas).
 */
export function sectionsForFiles(files: readonly string[]): ISection[] {
  const normalized = files.map((file) => file.replaceAll("\\", "/"));

  if (normalized.some((file) => GLOBAL_PATHS.some((glob) => file.startsWith(glob)))) {
    return [...SECTIONS];
  }

  const hit = new Set<string>();
  for (const file of normalized) {
    const match = bestSectionFor(file);
    if (match) hit.add(match.name);
  }
  return SECTIONS.filter((section) => hit.has(section.name));
}

/** La sección cuyo prefijo declarado es el más específico para `file`. */
export function bestSectionFor(file: string): ISection | undefined {
  let best: ISection | undefined;
  let bestLength = -1;

  for (const section of SECTIONS) {
    for (const prefix of section.paths) {
      if (file.startsWith(prefix) && prefix.length > bestLength) {
        best = section;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/**
 * Expande una lista de secciones con aquellas que dependen de ellas.
 *
 * Tocar `core` obliga a correr `frameworks`, `cli` y `e2e`: son sus
 * consumidores y una firma cambiada los rompe. Al revés no: tocar un
 * scanner no puede romper el núcleo.
 */
export function withDependents(sections: readonly ISection[]): ISection[] {
  const selected = new Set(sections.map((section) => section.name));
  let grew = true;

  while (grew) {
    grew = false;
    for (const section of SECTIONS) {
      if (selected.has(section.name)) continue;
      if (section.dependsOn.some((dependency) => selected.has(dependency))) {
        selected.add(section.name);
        grew = true;
      }
    }
  }
  return SECTIONS.filter((section) => selected.has(section.name));
}
