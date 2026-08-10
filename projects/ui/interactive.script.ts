#!/usr/bin/env bun
/**
 * `export-to-postman` sin argumentos → asistente interactivo.
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
import { withProjectRoot, withScopedPaths } from "../core/discovery/paths.service.js";
import { SUPPORTED_FRAMEWORKS } from "../frameworks/framework.registry.js";
import { OUTPUT_DIR_NAME } from "../contracts/constants/core/postman.constant.js";
import {
  DEFAULT_FORMAT,
  describeFormats,
} from "../core/exporters/export-registry.service.js";
import { defaultPainter, type IPainter } from "./ansi.helper.js";
import { renderTable } from "./table.helper.js";
import { renderDashboard, type IQualityMetrics } from "./dashboard.helper.js";
import type { EndpointSpec } from "../contracts/interfaces/core/postman.interface.js";

/**
 * Lector de líneas de stdin.
 *
 * Un chunk **no es una línea**. Escribiendo a mano coinciden —cada Enter
 * manda lo suyo— pero por una tubería llegan todas juntas en el primer
 * chunk. Esto hacía que `printf "ruta\nn\n" | expostman -i` metiera las
 * dos respuestas en la primera pregunta: la ruta salía como
 * `ruta\nn` y el asistente decía que la carpeta no existe.
 *
 * O sea que el asistente no se podía scriptear **ni probar**, que es lo
 * que impedía que tuviera tests.
 *
 * Se lee el stream una sola vez y se reparte en líneas, guardando lo que
 * sobra para la siguiente pregunta.
 */
function createLineReader(): () => Promise<string | null> {
  const decoder = new TextDecoder();
  let pending: string[] = [];
  let rest = "";
  let iterator: AsyncIterator<Uint8Array> | null = null;
  let done = false;

  return async function nextLine(): Promise<string | null> {
    if (pending.length > 0) return pending.shift() ?? null;
    if (done) return null;

    iterator ??= (Bun.stdin.stream() as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    for (;;) {
      const chunk = await iterator.next();
      if (chunk.done) {
        done = true;
        // Lo último puede no llevar salto de línea final.
        const last = rest;
        rest = "";
        return last.length > 0 ? last : null;
      }
      rest += decoder.decode(chunk.value, { stream: true });
      const parts = rest.split(/\r?\n/);
      // El último trozo puede estar a medias: se guarda para el próximo.
      rest = parts.pop() ?? "";
      if (parts.length > 0) {
        pending = parts;
        return pending.shift() ?? null;
      }
    }
  };
}

const nextLine = createLineReader();

/** Lee una línea de stdin mostrando un prompt. */
async function ask(question: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  process.stdout.write(`${question}${suffix}: `);
  const line = await nextLine();
  // `null` es fin de entrada: no hay nadie al otro lado, así que se toma
  // el valor por defecto en vez de quedarse esperando.
  return (line ?? "").trim() || fallback;
}

/** Pregunta sí/no. */
async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = (await ask(`${question} (y/n)`, fallback ? "y" : "n")).toLowerCase();
  return answer.startsWith("y") || answer.startsWith("s");
}

/**
 * Elige entre varias opciones numeradas.
 *
 * Una respuesta que no es un número de la lista se vuelve a pedir. Antes
 * caía a la primera opción en silencio, y con tres destinos era casi
 * inocuo; con los ${SUPPORTED_FRAMEWORKS.length} frameworks de la lista
 * de abajo significaría escanear el proyecto como Laravel porque alguien
 * escribió "fastify" en vez de su número.
 *
 * Los reintentos están acotados: si no hay nadie al otro lado del stdin
 * (una tubería que se cerró), `ask` devuelve el valor por defecto y el
 * bucle no puede quedarse dando vueltas.
 */
async function choose(question: string, choices: ReadonlyArray<string>): Promise<number> {
  console.log(`\n${question}`);
  for (const [index, choice] of choices.entries()) {
    console.log(`  ${index + 1}) ${choice}`);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = await ask("Choice", "1");
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) return index;
    console.log(`  ✗ Type a number between 1 and ${choices.length}.`);
  }
  return 0;
}

const BANNER = `
┌──────────────────────────────────────────────────────────┐
│  export-to-postman — Postman collections from your API  │
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

  let requests = countRequests(result.collection.item as IItem[]);
  // Framework elegido a mano. Viaja hasta `generate`/`push`: si el
  // asistente enseña 9 endpoints tras forzar el framework y luego
  // delegase sin decirlo, escribiría una colección vacía.
  let forcedFramework: string | null = null;

  // 2b. Nada reconocido no es el final del camino.
  //
  // La autodetección va por manifiestos, y hay proyectos donde NO PUEDE
  // acertar: un monorepo cuyo `package.json` está en la raíz y la API en
  // `services/api/`, una dependencia con alias, un manifiesto que se
  // genera en el build. Quien está delante sabe de qué es su API, así
  // que se le pregunta en vez de mandarle a leer la documentación.
  if (!result.match || requests === 0) {
    console.log("\n· Nothing recognised this project automatically.");
    console.log("  That happens when the manifest lives elsewhere (monorepo),");
    console.log("  the dependency is aliased, or it is generated at build time.");

    const choice = await choose("Which framework is it?", [
      ...SUPPORTED_FRAMEWORKS,
      "None of these — give up",
    ]);
    const picked = SUPPORTED_FRAMEWORKS[choice];
    if (!picked) {
      console.error("\n✗ No endpoints found in that folder.");
      console.error("  Check docs/FRAMEWORKS.md to see what each scanner looks for.");
      return 1;
    }

    console.log(`\n→ Scanning again as ${picked}…`);
    try {
      result = await generateWithAllFrameworks(projectRoot, { forceFramework: picked });
    } catch (err) {
      console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    requests = countRequests(result.collection.item as IItem[]);

    // Forzar el framework no inventa rutas. Si tampoco encuentra nada,
    // lo honesto es decirlo — y decir qué buscaba, que es lo que
    // permite entender por qué no lo ha visto.
    if (requests === 0) {
      console.error(`\n✗ Still no endpoints scanning as ${picked}.`);
      console.error(`  See docs/FRAMEWORKS.md for what the ${picked} scanner looks for.`);
      console.error("  If the API lives in a subfolder, point this at that subfolder.");
      return 1;
    }
    forcedFramework = picked;
  }

  const painter = defaultPainter();
  console.log(
    `\n${painter.paint("✔", "green")} ${
      forcedFramework ? `Scanned as ${forcedFramework}` : `Detected ${result.match?.framework}`
    } — ${requests} endpoints`,
  );

  // 3. Lo que se ha encontrado, antes de escribir nada.
  //
  // Una lista de nombres de carpeta no deja decidir: lo que hace falta
  // saber es qué endpoints hay y **cuáles llevan reglas leídas del
  // código** frente a cuáles se han inferido, porque esos son los que
  // habrá que mirar a mano.
  printRoutePreview(painter, result.specs);
  console.log(renderDashboard(painter, metricsOf(result, requests)).join("\n"));

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

  // El framework forzado se pasa a los dos caminos: es parte de cómo se
  // ha llegado hasta aquí, no una preferencia del asistente.
  const forcedArgs = forcedFramework ? ["--framework", forcedFramework] : [];

  // 3b. Formatos. Se pregunta solo cuando se van a escribir ficheros:
  // `push` sube a Postman y no tiene sentido ofrecerle un `.bru`.
  const formatArgs: string[] = [];
  if (target !== 2) {
    const formats = describeFormats();
    const choice = await choose("Which formats?", [
      "Just Postman",
      "Postman + OpenAPI",
      "All of them",
      ...formats.filter((f) => f.format !== DEFAULT_FORMAT).map((f) => `Postman + ${f.summary}`),
    ]);
    const selected =
      choice === 0
        ? [DEFAULT_FORMAT]
        : choice === 1
          ? [DEFAULT_FORMAT, "openapi"]
          : choice === 2
            ? formats.map((f) => f.format)
            : [DEFAULT_FORMAT, formats.filter((f) => f.format !== DEFAULT_FORMAT)[choice - 3]?.format ?? DEFAULT_FORMAT];
    if (selected.length > 1) formatArgs.push("--format", [...new Set(selected)].join(","));
  }

  if (target === 2) return runPush(projectRoot, [...argv, ...forcedArgs]);

  const outputDir =
    target === 1
      ? resolve(await ask("Output folder", join(projectRoot, OUTPUT_DIR_NAME)))
      : join(projectRoot, OUTPUT_DIR_NAME);

  // 4. Delegar en `generate`, que ya sabe escribir y trazar.
  //
  // El scope no es decorativo: `outputDir()` lee `process.argv`, y el
  // argv de este proceso es el del asistente, no el array que se le pasa
  // a `generateMain`. Sin fijarlo aquí, la carpeta que acaba de elegir
  // quien está delante se ignora en silencio.
  const { main: generateMain } = await import("../cli/commands/generate.script.js");
  return withScopedPaths({ projectRoot, outputDir }, () =>
    generateMain([
      "--project-root",
      projectRoot,
      "--output-dir",
      outputDir,
      ...forcedArgs,
      ...formatArgs,
    ]),
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

  const { main: pushMain } = await import("../cli/commands/push.script.js");
  return withProjectRoot(projectRoot, () =>
    pushMain(["--project-root", projectRoot, ...argv]),
  );
}

interface IItem {
  item?: IItem[];
}

/** Los verbos que pueden llevar cuerpo. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** Color del método, para que la tabla se lea de un vistazo. */
function methodColor(method: string): Parameters<IPainter["paint"]>[1] {
  if (method === "GET") return "green";
  if (method === "POST") return "yellow";
  if (method === "DELETE") return "red";
  return "cyan";
}

/**
 * La tabla de endpoints descubiertos.
 *
 * La columna que de verdad importa es `Reglas`: dice si los campos salen
 * del código o de una heurística, y es lo único que no se puede deducir
 * mirando la colección después.
 */
function printRoutePreview(painter: IPainter, specs: ReadonlyArray<EndpointSpec>): void {
  const rows = specs.map((spec) => {
    const fields = spec.fields ?? [];
    const rules =
      fields.length > 0
        ? painter.paint(`${fields.length} campos`, "green")
        : painter.paint("inferido", "yellow");
    return [
      painter.paint(spec.method, methodColor(spec.method)),
      spec.uri,
      spec.folder ?? "",
      rules,
    ];
  });

  console.log("");
  for (const line of renderTable(
    [
      { header: "Método", min: 6 },
      { header: "URI", min: 12 },
      { header: "Carpeta", min: 6 },
      { header: "Reglas", min: 8 },
    ],
    rows,
  )) {
    console.log(`  ${line}`);
  }
}

/** Traduce el resultado del pipeline a lo que enseña el dashboard. */
function metricsOf(
  result: Awaited<ReturnType<typeof generateWithAllFrameworks>>,
  requests: number,
): IQualityMetrics {
  const writes = result.specs.filter((s) => WRITE_METHODS.has(s.method));
  return {
    framework: result.match?.framework ?? "desconocido",
    requests,
    folders: result.collection.item.length,
    withRules: result.specs.filter((s) => (s.fields?.length ?? 0) > 0).length,
    writeEndpoints: writes.length,
    withBody: writes.filter((s) => s.body !== undefined).length,
    auth: { type: result.authScheme.type, evidence: result.authScheme.evidence },
    warnings: result.warnings,
  };
}

function countRequests(items: ReadonlyArray<IItem>): number {
  return items.reduce((total, i) => total + (i.item ? countRequests(i.item) : 1), 0);
}

if (import.meta.main) {
  process.exit(await main());
}
