#!/usr/bin/env bun
/**
 * `bun run docs:frameworks` — la tabla de cifras de `FRAMEWORKS.md`.
 *
 * Esa tabla dice, por framework, cuántas rutas saca de su fixture y
 * cuántas llevan reglas leídas del código. Es de lo más útil que hay en
 * la documentación —deja comparar la cobertura de un vistazo— y era el
 * sitio más fácil del repo para mentir sin enterarse: números escritos a
 * mano, medidos una vez, que nadie vuelve a comprobar.
 *
 * Al generarla salió que ASP.NET decía 13 con validación y son 7, y que
 * NestJS decía 7 y son 10 (subieron al arreglar el parser de DTOs).
 * Ninguna de las dos era mentira cuando se escribió.
 *
 * Se ejecutan los scanners de verdad contra sus fixtures, así que esto
 * tarda unos segundos. Va con `--check` para el gate.
 *
 * Uso:
 *   bun run docs:frameworks           # reescribe la tabla
 *   bun run docs:frameworks --check   # falla si está desactualizada
 */
import { readFile, writeFile } from "node:fs/promises";

import { comprehensiveFixtureDir, fromRoot } from "../helpers/root.helper.js";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant.js";

const DOC = fromRoot("docs", "FRAMEWORKS.md");

/**
 * Marcadores de la región generada.
 *
 * Van como comentarios de markdown para que no se vean al leer el
 * documento, y delimitan **solo** la tabla: el texto de alrededor se
 * escribe a mano y no se toca.
 */
const START = "<!-- generado:tabla-frameworks -->";
const END = "<!-- /generado:tabla-frameworks -->";

/** Ancla de la sección de cada framework, tal como la genera markdown. */
const ANCHORS: Readonly<Record<string, string>> = {
  openapi: "openapi--swagger",
  express: "express--koa--hapi",
  django: "django--drf",
  nextjs: "nextjs",
  springboot: "spring-boot",
  aspnet: "aspnet-core",
  rust: "rust-actix-web--rocket",
};

/** Nombre legible de cada framework. */
const TITLES: Readonly<Record<string, string>> = {
  openapi: "OpenAPI",
  fastapi: "FastAPI",
  django: "Django",
  nextjs: "Next.js",
  nestjs: "NestJS",
  springboot: "Spring Boot",
  aspnet: "ASP.NET Core",
  graphql: "GraphQL",
  trpc: "tRPC",
};

function title(framework: string): string {
  return TITLES[framework] ?? framework.charAt(0).toUpperCase() + framework.slice(1);
}

interface IRow {
  readonly framework: string;
  readonly routes: number;
  readonly withRules: number;
}

async function measure(): Promise<IRow[]> {
  const { generateWithAllFrameworks } = await import(
    "../../packages/frameworks/index.js"
  );
  const rows: IRow[] = [];
  for (const framework of FRAMEWORK_IDS) {
    // Se fuerza el framework: el fixture de uno puede casar con el
    // detector de otro, y entonces la fila mediría al vecino.
    const result = await generateWithAllFrameworks(comprehensiveFixtureDir(framework), {
      forceFramework: framework,
    });
    rows.push({
      framework,
      routes: result.metrics.specs,
      withRules: result.metrics.withValidation,
    });
  }
  // De más a menos rutas: es el orden en que se lee "cuánto cubre cada
  // uno", que es para lo que sirve la tabla.
  return rows.sort((a, b) => b.routes - a.routes || a.framework.localeCompare(b.framework));
}

function render(rows: ReadonlyArray<IRow>): string {
  const lines = [
    START,
    "",
    "| Framework | Rutas del fixture | Con validación |",
    "|---|---:|---:|",
    ...rows.map((r) => {
      const anchor = ANCHORS[r.framework] ?? r.framework;
      return `| [${title(r.framework)}](#${anchor}) | ${r.routes} | ${r.withRules} |`;
    }),
    "",
    `_Generado por \`bun run docs:frameworks\` ejecutando cada scanner contra_`,
    `_su fixture. ${rows.length} frameworks._`,
    "",
    END,
  ];
  return lines.join("\n");
}

async function main(): Promise<number> {
  const doc = await readFile(DOC, "utf8");
  const table = render(await measure());

  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1) {
    console.error(
      `docs:frameworks — faltan los marcadores en docs/FRAMEWORKS.md.\n` +
        `  Añade una línea con ${START} y otra con ${END} donde deba ir la tabla.`,
    );
    return 1;
  }
  const updated = doc.slice(0, start) + table + doc.slice(end + END.length);

  if (process.argv.includes("--check")) {
    if (updated.trim() !== doc.trim()) {
      console.error(
        "lint:frameworks-table — la tabla de docs/FRAMEWORKS.md no coincide con\n" +
          "  lo que sacan los scanners. Ejecuta `bun run docs:frameworks`.",
      );
      return 1;
    }
    console.log("lint:frameworks-table — la tabla coincide con lo que miden los scanners");
    return 0;
  }

  await writeFile(DOC, updated, "utf8");
  console.log("docs:frameworks — tabla actualizada en docs/FRAMEWORKS.md");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
