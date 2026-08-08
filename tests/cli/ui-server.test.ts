/**
 * `expostman ui` levantado de verdad, hablándole por HTTP.
 *
 * `ui-routes.spec.ts` prueba las respuestas con dobles. Esto prueba lo
 * que ningún doble puede: que el puerto abre, que la página se sirve,
 * que un POST sin cuerpo no revienta, y —sobre todo— que **generar
 * escribe en el proyecto que se pide**.
 *
 * Va como subproceso y no en el mismo test: `Bun.serve` solo existe
 * bajo Bun, y vitest corre en workers de Node. Lanzarlo de fuera es
 * además lo que de verdad se quiere probar — el comando entero, no sus
 * piezas.
 *
 * El caso de la generación no es hipotético. Ejercitando la API a mano,
 * la primera versión escribió la colección **dentro de este
 * repositorio** en vez de en el proyecto pedido: `runGenerate` lee sus
 * flags del argv que se le pasa, pero `paths.service` resuelve la raíz
 * leyendo `process.argv` del proceso — que en un servidor de vida larga
 * es el del `expostman ui`. Es la deuda que r00005 viene a cerrar.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";

/** Un puerto poco transitado, y el servidor busca otro si está ocupado. */
const PORT = 4881;
const BASE = `http://127.0.0.1:${PORT}`;

let work = "";
let proyecto = "";
let proceso: ChildProcess | null = null;

/** Espera a que el servidor conteste, sin dormir a ciegas. */
async function esperarAlServidor(intentos = 60): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`La interfaz no respondió en ${BASE} tras ${intentos} intentos`);
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "ui-e2e-"));
  proyecto = join(work, "api");
  await copyExampleClean(exampleDir("express"), proyecto);

  proceso = spawn(
    "bun",
    [join(CLI_COMMANDS_DIR, "ui.script.ts"), "--no-open", "--port", String(PORT)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await esperarAlServidor();
}, 180_000);

afterAll(async () => {
  proceso?.kill("SIGTERM");
  if (work) await rm(work, { recursive: true, force: true });
});

async function post(
  ruta: string,
  cuerpo?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${ruta}`, {
    method: "POST",
    ...(cuerpo === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(cuerpo),
        }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("la página", () => {
  test("se sirve desde memoria, sin leer ficheros del disco", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Export to Postman");
  });

  test("declara idioma, para los lectores de pantalla", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('<html lang="es"');
  });

  test("no carga nada de fuera: la política lo impide", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await (await fetch(`${BASE}/`)).text();
    // Sin CDN ni fuentes remotas: el `.exe` tiene que funcionar sin red.
    expect(html).not.toMatch(/src="https?:/);
  });

  test("lo que no es la página ni la API da 404", async () => {
    expect((await fetch(`${BASE}/otra-cosa`)).status).toBe(404);
  });
});

describe("la API", () => {
  /**
   * La interfaz pide esto nada más cargar, y sin cuerpo. La primera
   * versión lo trataba como «JSON inválido» y la página fallaba en su
   * primera petición.
   */
  test("un POST sin cuerpo es legítimo", async () => {
    const { status, json } = await post("/api/capabilities");
    expect(status).toBe(200);
    expect(json["formats"]).toContain("postman");
    expect(json["frameworks"]).toContain("express");
  });

  test("un cuerpo roto sí es un error, y lo dice", async () => {
    const res = await fetch(`${BASE}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{esto no es json",
    });
    expect(res.status).toBe(400);
  });

  test("inspecciona el proyecto de verdad", async () => {
    const { status, json } = await post("/api/inspect", { projectRoot: proyecto });
    expect(status).toBe(200);
    const summary = json["summary"] as { framework: string; routesInCode: number };
    expect(summary.framework).toBe("express");
    expect(summary.routesInCode).toBeGreaterThan(0);
  });

  test("inspeccionar no escribe nada", async () => {
    await post("/api/inspect", { projectRoot: proyecto });
    await expect(readdir(join(proyecto, "export-to-postman"))).rejects.toThrow();
  });

  test("una carpeta que no existe da 404 con salida", async () => {
    const { status, json } = await post("/api/inspect", { projectRoot: "/no/existe/zzz" });
    expect(status).toBe(404);
    const error = json["error"] as { nextAction: string };
    expect(error.nextAction.length).toBeGreaterThan(0);
  });

  /**
   * EL test. Sin `withScopedPaths`, esto escribía dentro del repo desde
   * el que se lanzó la interfaz.
   */
  test("generar escribe en el proyecto pedido", { timeout: 120_000 }, async () => {
    const { status, json } = await post("/api/generate", { projectRoot: proyecto });
    expect(status).toBe(200);
    const result = json["result"] as { collectionPath: string; requests: number };
    expect(result.collectionPath.startsWith(proyecto)).toBe(true);
    expect(result.requests).toBeGreaterThan(0);

    // Y está de verdad en el disco, donde dice.
    const salida = await readdir(join(proyecto, "export-to-postman"));
    expect(salida.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  test("un formato inventado se rechaza y dice cuáles valen", async () => {
    const { status, json } = await post("/api/generate", {
      projectRoot: proyecto,
      formats: ["inventado"],
    });
    expect(status).toBe(400);
    const error = json["error"] as { nextAction: string };
    expect(error.nextAction).toContain("postman");
  });
});
