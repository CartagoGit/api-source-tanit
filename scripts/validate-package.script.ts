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
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { moduleDir } from "../helper/module-path.helper.js";

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "..");
/** Proyecto de ejemplo con el que se comprueba el binario instalado. */
const SAMPLE_PROJECT = join(PACKAGE_ROOT, "examples", "example-express");
const EXPECTED_REQUESTS = 9;

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

  try {
    // 1. Empaquetar tal cual lo haría `npm publish`.
    const pack = await run(
      ["npm", "pack", "--pack-destination", workDir],
      PACKAGE_ROOT,
    );
    const tarballs = pack.ok ? (await readdir(workDir)).filter((f) => f.endsWith(".tgz")) : [];
    const tarball = tarballs[0];
    steps.push({
      name: "npm pack",
      ok: pack.ok && Boolean(tarball),
      detail: tarball ?? pack.output.slice(-300),
    });
    if (!tarball) return report(steps);

    // 2. Instalarlo en un proyecto limpio.
    const consumer = join(workDir, "consumer");
    await Bun.write(join(consumer, "package.json"), '{"name":"consumer","version":"1.0.0"}\n');
    const install = await run(["bun", "add", join(workDir, tarball)], consumer);
    const binPath = join(consumer, "node_modules", ".bin", "postman-from-routes");
    steps.push({
      name: "instalación en proyecto limpio",
      ok: install.ok && existsSync(binPath),
      detail: existsSync(binPath) ? "bin enlazado" : install.output.slice(-300),
    });
    if (!existsSync(binPath)) return report(steps);

    // 3. Ejecutar el binario contra un proyecto real.
    const project = join(consumer, "mi-api");
    await cp(SAMPLE_PROJECT, project, { recursive: true });
    const generate = await run([binPath, "generate", "--project-root", project], consumer);
    steps.push({
      name: "el binario instalado genera",
      ok: generate.ok,
      detail: generate.ok ? "exit 0" : generate.output.slice(-400),
    });

    // 4. Comprobar la colección resultante.
    const buildDir = join(project, "build");
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
    const pkgFolder = existsSync(join(consumer, "node_modules", "export-to-postman"))
      ? join(consumer, "node_modules", "export-to-postman")
      : join(consumer, "node_modules", "@postman-exporter", "cli");
    const installedDocs = join(pkgFolder, "docs");
    steps.push({
      name: "documentación incluida en el paquete",
      ok: existsSync(join(installedDocs, "POSTMAN.md")),
      detail: existsSync(installedDocs) ? (await readdir(installedDocs)).join(", ") : "(sin docs/)",
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

