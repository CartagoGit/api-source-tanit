#!/usr/bin/env bun
/**
 * Gate de empaquetado: ¿el paquete funciona **instalado**?
 *
 * `bun run validate` prueba el código del repo. Esto prueba lo que
 * recibe un usuario: empaqueta con `npm pack`, lo instala en un proyecto
 * limpio y ejecuta el binario contra una API de ejemplo.
 *
 * Sin esto es fácil publicar un paquete roto de formas que el repo no
 * ve: un fichero que falta en `files`, un `bin` mal apuntado, un import
 * relativo que se sale del tarball.
 *
 * Uso:
 *   bun run validate:package
 */
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, } from "node:path";
import { tmpdir } from "node:os";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant.js";
import { PACKAGE_JSON, REPO_ROOT, exampleDir } from "../helpers/root.helper.js";

/** Proyecto de ejemplo con el que se comprueba el binario instalado. */
const EXPECTED_REQUESTS = 9;

/**
 * Prefijo dentro del tarball que, **si aparece**, indica que el plugin
 * MCP se está filtrando al producto público. El `file:` del
 * `@delendai/core` no resuelve fuera del worktree del desarrollador y
 * el plugin depende de ese path: distribuirlo empaquetado rompe la
 * instalación del usuario sin que nada falle aquí.
 *
 * El prefijo NO incluye `packages/` desde x00041: el plugin vive en
 * `integrations/delendai/` y `files` en el `package.json` raíz NO
 * lista `integrations/`, así que dentro del tarball la ruta
 * prohibida sería `package/integrations/delendai/`. Se mantiene la
 * búsqueda de la ruta antigua también (`package/packages/plugins/`)
 * porque el tarball de una versión vieja aún podía llevarla: si
 * aparece cualquiera de las dos, es fuga.
 *
 * Slice S0 de la propuesta `a00012`. Actualizado por x00041/x00049.
 */
const MCP_PLUGIN_TARBALL_PATH = "package/integrations/delendai/";
const MCP_PLUGIN_TARBALL_PATH_LEGACY = "package/packages/plugins/";

interface IStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function run(
  command: string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { ok: (await proc.exited) === 0, output: stdout + stderr };
}

async function main(): Promise<number> {
  const steps: IStep[] = [];
  const workDir = await mkdtemp(join(tmpdir(), "postman-package-"));

    // La integración con Delendai (`integrations/delendai/`)
  // NO participa en este gate: es una pieza interna del repo
  // (`"private": true`), se carga directo desde su TS y no viaja en el
  // tarball. Empaquetarlo aquí era herencia de cuando se pensó como
  // paquete publicable — ya no lo es.

  try {
    // 1. Empaquetar tal cual lo haría `npm publish`.
    const pack = await run(
      ["npm", "pack", "--pack-destination", workDir],
      REPO_ROOT,
    );
    const tarballs = pack.ok ? (await readdir(workDir)).filter((f) => f.endsWith(".tgz")) : [];
    const tarball = tarballs[0];
    steps.push({
      name: "npm pack",
      ok: pack.ok && Boolean(tarball),
      detail: tarball ?? pack.output.slice(-300),
    });
    if (!tarball) return report(steps);

    // 1.b Aserción de DoD de packaging (slice S0 de `a00012`,
    // actualizado por x00041/x00049): la integración con Delendai
    // (`integrations/delendai/`) NO viaja en el tarball público
    // porque `files` del `package.json` raíz no la lista. Confiar en
    // `"private": true` no basta: hay que leer el tarball real y
    // confirmar que ni la ruta nueva ni la antigua aparecen. Si
    // aparece cualquiera, fallamos con un mensaje explícito.
    const listing = await run(["tar", "-tzf", join(workDir, tarball)], workDir);
    const leaked = listing.ok
      ? listing.output
          .split("\n")
          .filter(
            (line) =>
              line.startsWith(MCP_PLUGIN_TARBALL_PATH) ||
              line.startsWith(MCP_PLUGIN_TARBALL_PATH_LEGACY),
          )
      : [];
    steps.push({
      name: "el plugin MCP no debe entrar en el tarball público",
      ok: listing.ok && leaked.length === 0,
      detail:
        leaked.length === 0
          ? `${MCP_PLUGIN_TARBALL_PATH} ausente`
          : leaked.length === 1
            ? `${MCP_PLUGIN_TARBALL_PATH} aparece en el tarball`
            : `${leaked.length} entradas con prefijo ${MCP_PLUGIN_TARBALL_PATH}`,
    });
    if (leaked.length > 0) return report(steps);

    // 2. Instalarlo en un proyecto limpio.
    const consumer = join(workDir, "consumer");
    await Bun.write(join(consumer, "package.json"), '{"name":"consumer","version":"1.0.0"}\n');
    const install = await run(["bun", "add", join(workDir, tarball)], consumer);
    // El nombre del bin se lee del propio package.json: tenerlo a fuego
    // aquí hizo que este gate empezara a fallar en cuanto el proyecto se
    // renombró, y el mensaje no decía por qué.
    const binName = Object.keys(
      (JSON.parse(await Bun.file(PACKAGE_JSON).text()) as {
        bin?: Record<string, string>;
      }).bin ?? {},
    )[0];
    if (!binName) {
      steps.push({ name: "package.json declara un bin", ok: false, detail: "no hay `bin`" });
      return report(steps);
    }
    const binPath = join(consumer, "node_modules", ".bin", binName);
    steps.push({
      name: "instalación en proyecto limpio",
      ok: install.ok && existsSync(binPath),
      detail: existsSync(binPath) ? "bin enlazado" : install.output.slice(-300),
    });
    if (!existsSync(binPath)) return report(steps);

    // 3. Ejecutar el binario contra un proyecto real.
    const project = join(consumer, "mi-api");
    await cp(exampleDir("express"), project, { recursive: true });
    const generate = await run([binPath, "generate", "--project-root", project], consumer);
    steps.push({
      name: "el binario instalado genera",
      ok: generate.ok,
      detail: generate.ok ? "exit 0" : generate.output.slice(-400),
    });

    // 4. Comprobar la colección resultante.
    const buildDir = join(project, OUTPUT_DIR_NAME);
    const files = existsSync(buildDir) ? await readdir(buildDir) : [];
    const collectionFile = files.find((f) => f.endsWith(".postman_collection.json"));
    if (!collectionFile) {
      steps.push({
        name: "colección escrita",
        ok: false,
        detail: `no hay .postman_collection.json en ${buildDir}`,
      });
      return report(steps);
    }

    const collection = JSON.parse(await readFile(join(buildDir, collectionFile), "utf8")) as {
      info?: { schema?: string; _postman_id?: string };
      item?: unknown[];
    };
    const requests = countRequests((collection.item ?? []) as IItem[]);

    steps.push({
      name: "colección Postman v2.1.0",
      ok: Boolean(collection.info?.schema?.includes("2.1.0")),
      detail: collection.info?.schema ?? "(sin schema)",
    });
    steps.push({
      name: `${EXPECTED_REQUESTS} requests`,
      ok: requests === EXPECTED_REQUESTS,
      detail: `${requests} encontrados`,
    });
    steps.push({
      name: "_postman_id presente",
      ok: Boolean(collection.info?._postman_id),
      detail: collection.info?._postman_id ?? "(ausente)",
    });
    steps.push({
      name: "environments generados",
      ok: files.some((f) => f.endsWith(".postman_environment.json")),
      detail: `${files.filter((f) => f.endsWith(".postman_environment.json")).length} ficheros`,
    });

    // 5. Verificar que el tarball trae la documentación.
    //
    // El nombre del paquete se lee del `package.json` raíz. Antes se
    // hardcodeaba `export-to-postman` y `@export-to-postman/cli` (los
    // nombres anteriores al rebranding a `api-source-tanit`): el gate
    // empezaba a fallar siempre que se renombraba el proyecto y el
    // mensaje decía `(sin docs/)` aunque el tarball fuese correcto.
    // Auditoría 2026-09-06, sección 2.
    const pkgName = (JSON.parse(await Bun.file(PACKAGE_JSON).text()) as {
      name?: string;
    }).name;
    if (!pkgName) {
      steps.push({
        name: "documentación incluida en el paquete",
        ok: false,
        detail: "package.json sin `name`",
      });
      return report(steps);
    }
    // `pkgName` puede ser scoped (`@scope/name`) o plano (`name`).
    // `node_modules` lo aplana a `@scope/name` tal cual.
    const pkgFolder = join(consumer, "node_modules", pkgName);
    const installedDocs = join(pkgFolder, "docs");
    // Inspección directa del tarball, además de la carpeta instalada:
    // es lo que de verdad se publica, y la estructura que Bun deja en
    // `node_modules` no es garantía (puede traer symlinks, `.bin`,
    // carpetas generadas). Si el listado del tarball incluye
    // `package/docs/POSTMAN.md`, el gate lo confirma sin depender de
    // cómo se materializó la instalación.
    const docsInTarball = listing.ok
      ? listing.output
          .split("\n")
          .some((line) => line === "package/docs/POSTMAN.md")
      : false;
    steps.push({
      name: "documentación incluida en el paquete",
      ok: existsSync(join(installedDocs, "POSTMAN.md")) || docsInTarball,
      detail: existsSync(installedDocs)
        ? `${(await readdir(installedDocs)).join(", ")}${docsInTarball ? " (también en el tarball)" : ""}`
        : docsInTarball
          ? "en el tarball pero no en node_modules"
          : "(sin docs/)",
    });

    return report(steps);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

interface IItem {
  item?: IItem[];
}

function countRequests(items: ReadonlyArray<IItem>): number {
  return items.reduce((total, i) => total + (i.item ? countRequests(i.item) : 1), 0);
}

function report(steps: ReadonlyArray<IStep>): number {
  for (const step of steps) {
    console.log(`${step.ok ? "ok   " : "FAIL "} ${step.name.padEnd(38)} ${step.detail}`);
  }
  const failed = steps.filter((s) => !s.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} paso(s) fallidos: el paquete NO está listo para publicar.`);
    return 1;
  }
  console.log("\nEl paquete instalado funciona de punta a punta.");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

