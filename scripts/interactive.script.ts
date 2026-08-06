#!/usr/bin/env bun
/**
 * `postman-from-routes` sin argumentos → asistente interactivo.
 *
 * Para quien no quiere memorizar flags: pregunta la carpeta del
 * proyecto, enseña lo que ha detectado ANTES de escribir nada, y deja
 * elegir dónde va la salida o si se sube directamente a Postman.
 *
 * Se implementa con lecturas de stdin en crudo, sin dependencias, por
 * dos motivos: el binario compilado no puede cargar paquetes en tiempo
 * de ejecución, y una librería de prompts añadiría ~2 MB por unas pocas
 * preguntas.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { generateWithAllFrameworks } from "../frameworks/index.js";
import { withProjectRoot } from "../service/paths.service.js";
import { SUPPORTED_FRAMEWORKS } from "../frameworks/registry.js";
import { OUTPUT_DIR_NAME } from "../contract/postman.constant.js";

/** Lee una línea de stdin mostrando un prompt. */
async function ask(question: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  process.stdout.write(`${question}${suffix}: `);

  for await (const chunk of Bun.stdin.stream()) {
    const answer = new TextDecoder().decode(chunk).trim();
    return answer || fallback;
  }
  return fallback;
}

/** Pregunta sí/no. */
async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = (await ask(`${question} (y/n)`, fallback ? "y" : "n")).toLowerCase();
  return answer.startsWith("y") || answer.startsWith("s");
}

/** Elige entre varias opciones numeradas. */
async function choose(question: string, choices: ReadonlyArray<string>): Promise<number> {
  console.log(`\n${question}`);
  choices.forEach((choice, i) => console.log(`  ${i + 1}) ${choice}`));
  const answer = await ask("Choice", "1");
  const index = Number.parseInt(answer, 10) - 1;
  return Number.isInteger(index) && index >= 0 && index < choices.length ? index : 0;
}

const BANNER = `
┌──────────────────────────────────────────────────────────┐
│  postman-from-routes — Postman collections from your API  │
└──────────────────────────────────────────────────────────┘

Supported frameworks: ${SUPPORTED_FRAMEWORKS.length}
${SUPPORTED_FRAMEWORKS.join(", ")}
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  console.log(BANNER);

  // 1. Proyecto.
  const suggested = process.cwd();
  const answer = await ask("Path to your API project", suggested);
  const projectRoot = isAbsolute(answer) ? answer : resolve(answer);

  if (!existsSync(projectRoot)) {
    console.error(`\n✗ That folder does not exist: ${projectRoot}`);
    return 1;
  }

  // 2. Escaneo, antes de escribir nada.
  console.log(`\n→ Scanning ${projectRoot}…`);
  let result: Awaited<ReturnType<typeof generateWithAllFrameworks>>;
  try {
    result = await generateWithAllFrameworks(projectRoot);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const requests = countRequests(result.collection.item as IItem[]);
  if (!result.match || requests === 0) {
    console.error("\n✗ No endpoints found in that folder.");
    console.error("  Check docs/FRAMEWORKS.md to see what each scanner looks for.");
    return 1;
  }

  console.log(`\n✔ Detected ${result.match.framework} — ${requests} endpoints`);
  if (result.authFlow?.login) {
    console.log("  · Login endpoint found: the token will be stored automatically");
  }
  for (const folder of result.collection.item.slice(0, 8)) {
    const count = folder.item ? countRequests(folder.item as IItem[]) : 1;
    console.log(`  · ${folder.name} (${count})`);
  }

  if (!(await confirm("\nGenerate the collection?"))) {
    console.log("Cancelled.");
    return 0;
  }

  // 3. Destino.
  const target = await choose("Where should it go?", [
    `Write files to ${join(projectRoot, OUTPUT_DIR_NAME)}`,
    "Write files to another folder",
    "Upload straight to Postman (needs an API key)",
  ]);

  if (target === 2) return runPush(projectRoot, argv);

  const outputDir =
    target === 1
      ? resolve(await ask("Output folder", join(projectRoot, OUTPUT_DIR_NAME)))
      : join(projectRoot, OUTPUT_DIR_NAME);

  // 4. Delegar en `generate`, que ya sabe escribir y trazar.
  const { main: generateMain } = await import("./generate.script.js");
  return withProjectRoot(projectRoot, () =>
    generateMain(["--project-root", projectRoot, "--output-dir", outputDir]),
  );
}

async function runPush(projectRoot: string, argv: string[]): Promise<number> {
  const fromEnv = process.env["POSTMAN_API_KEY"];
  if (!fromEnv) {
    console.log("\nCreate an API key at https://postman.co/settings/me/api-keys");
    const key = await ask("Postman API key");
    if (!key) {
      console.error("✗ No API key given.");
      return 1;
    }
    process.env["POSTMAN_API_KEY"] = key;
  }

  const { main: pushMain } = await import("./push.script.js");
  return withProjectRoot(projectRoot, () =>
    pushMain(["--project-root", projectRoot, ...argv]),
  );
}

interface IItem {
  item?: IItem[];
}

function countRequests(items: ReadonlyArray<IItem>): number {
  return items.reduce((total, i) => total + (i.item ? countRequests(i.item) : 1), 0);
}

if (import.meta.main) {
  process.exit(await main());
}
