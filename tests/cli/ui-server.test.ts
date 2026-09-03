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
 * repositorio** en vez de en el proyecto pedido: `runGenerate` leía sus
 * flags del argv que se le pasaba, pero el singleton retirado de
 * `paths.service` (r00010 S2, 2026-09-03) resolvía la raíz leyendo
 * `process.argv` del proceso — que en un servidor de vida larga era el
 * del `expostman ui`. Es la deuda que r00005 vino a cerrar.
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

/** El testigo que sirve la página. Sin él la API no contesta. */
async function testigo(): Promise<string> {
  const html = await (await fetch(`${BASE}/`)).text();
  return /data-token="([^"]+)"/.exec(html)?.[1] ?? "";
}

async function post(
  ruta: string,
  cuerpo?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = await testigo();
  const res = await fetch(`${BASE}${ruta}`, {
    method: "POST",
    headers: { "x-expostman-token": token },
    ...(cuerpo === undefined
      ? {}
      : {
          headers: {
            "content-type": "application/json",
            "x-expostman-token": token,
          },
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
    // Con testigo: sin él saldría un 403 y el 404 quedaría sin probar.
    const res = await fetch(`${BASE}/otra-cosa`, {
      headers: { "x-expostman-token": await testigo() },
    });
    expect(res.status).toBe(404);
  });
});

/**
 * Que **otra web** no pueda usar esta interfaz.
 *
 * Escuchar en `127.0.0.1` no basta, y esa es la trampa: el servidor no
 * es alcanzable desde la red, pero sí desde el navegador de quien lo
 * ejecuta. Cualquier página que esa persona visite mientras la interfaz
 * corre puede hacerle un POST.
 *
 * Se midió antes de arreglarlo: con `content-type: text/plain` —una
 * petición «simple», que el navegador manda **sin preflight**— una web
 * cualquiera conseguía que `/api/generate` escribiera ficheros donde
 * quisiera, vía `outputDir`. No podía leer la respuesta, pero el efecto
 * ya había ocurrido.
 */
describe("la interfaz no se deja conducir desde fuera", () => {
  test("sin testigo no contesta, aunque la petición sea válida", async () => {
    const res = await fetch(`${BASE}/api/capabilities`, { method: "POST" });
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error: { reason: string } };
    expect(j.error.reason).toMatch(/token/i);
  });

  /**
   * EL test. `text/plain` es lo que hace la petición «simple» y por
   * tanto exenta de preflight: es la puerta exacta por la que entraba.
   */
  test("el POST simple con `text/plain` tampoco pasa", async () => {
    // La carpeta va dentro del temporal de este test y no en `/tmp` a
    // secas: una ruta fija hace que el test dependa de lo que dejó la
    // ejecución anterior, y así pasó — al comprobar que el test cazaba
    // el fallo, la ejecución sin guard creó la carpeta y la siguiente
    // pasada falló por eso, no por el bug.
    const noDeberia = join(work, "no-deberia-existir");
    const res = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ projectRoot: proyecto, outputDir: noDeberia }),
    });
    expect(res.status).toBe(403);
    // Y no ha escrito nada.
    await expect(readdir(noDeberia)).rejects.toThrow();
  });

  test("un Origin ajeno se rechaza antes de mirar el cuerpo", async () => {
    const res = await fetch(`${BASE}/api/capabilities`, {
      method: "POST",
      headers: { origin: "https://malicioso.example" },
    });
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error: { reason: string } };
    expect(j.error.reason).toContain("malicioso.example");
  });

  test("la página lleva el testigo dentro, para que solo ella pueda usarlo", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toMatch(/data-token="[0-9a-f-]{36}"/);
  });

  /**
   * El testigo va en el HTML y no en una cookie a propósito: una cookie
   * la manda el navegador **sola** en cualquier petición a este origen,
   * incluidas las que dispare otra web. Eso la haría inútil aquí.
   */
  test("no se apoya en cookies", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("set-cookie")).toBeNull();
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
      headers: {
        "content-type": "application/json",
        "x-expostman-token": await testigo(),
      },
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

  test("los ajustes guardados llegan a la página", async () => {
    const { status, json } = await post("/api/settings");
    expect(status).toBe(200);
    expect(json["ok"]).toBe(true);
    const settings = json["settings"] as Record<string, unknown>;
    expect(settings["version"]).toBe(1);
  });

  test("guardar un ajuste de la página lo persiste de verdad", async () => {
    const guardado = await post("/api/settings/save", { theme: "dark" });
    expect(guardado.status).toBe(200);
    // Releído por una petición nueva: sobrevivió en disco.
    const releido = await post("/api/settings");
    const settings = releido.json["settings"] as Record<string, unknown>;
    expect(settings["theme"]).toBe("dark");
  });

  test("los idiomas llegan con sus traducciones, para el selector", async () => {
    const { status, json } = await post("/api/locales");
    expect(status).toBe(200);
    const locales = json["locales"] as Array<Record<string, unknown>>;
    expect(locales.length).toBeGreaterThanOrEqual(15);
    const es = locales.find((l) => l["code"] === "es");
    expect(es).toBeDefined();
    expect((es!["translations"] as Record<string, string>)["settings.theme"]).toBe("Tema");
  });
});

/**
 * S4 — la tuerca y la pantalla de ajustes, probadas sobre el HTML que
 * el servidor sirve de verdad. El gate de esta slice es e2e: comprobar
 * el string en memoria no vale, porque lo que se distribuye es lo que
 * sale por HTTP.
 */
describe("la pantalla de ajustes (S4)", () => {
  /** El HTML tal y como llega al navegador. */
  async function pagina(): Promise<string> {
    return (await fetch(`${BASE}/`)).text();
  }

  test("la tuerca está en la cabecera, con nombre accesible", async () => {
    const html = await pagina();
    expect(html).toContain('id="ajustes"');
    expect(html).toMatch(/<(button|span|div)[^>]*id="ajustes"[^>]*aria-label="[^"]+"/);
  });

  test("la pantalla de ajustes existe y contiene idioma y tema", async () => {
    const html = await pagina();
    expect(html).toContain('id="vista-ajustes"');
    expect(html).toContain('id="idioma"');
    expect(html).toContain('id="tema"');
  });

  test("el tema elegido viaja en data-tema, no en clases repetidas", async () => {
    const html = await pagina();
    expect(html).toContain(':root[data-tema="dark"]');
    expect(html).toContain(':root[data-tema="light"]');
    // El bloque del sistema cede cuando hay elección manual.
    expect(html).toContain(':root:not([data-tema="light"])');
  });

  test("los textos llevan su clave de traducción en data-i18n", async () => {
    const html = await pagina();
    expect(html).toContain('data-i18n="app.title"');
    expect(html).toContain('data-i18n="settings.language"');
    expect(html).toContain('data-i18n="settings.theme"');
    expect(html).toContain('data-i18n="theme.system"');
  });

  test("no hay botón de guardar: el guardado es automático", async () => {
    const html = await pagina();
    // La sección de ajustes llama a /api/settings/save desde el script,
    // pero ninguna parte declara un botón que diga guardar.
    expect(html).not.toMatch(/id="guardar"/i);
    expect(html).toContain("/api/settings/save");
  });

  test("la pantalla de ajustes no reemplaza el formulario: conserva el estado", async () => {
    const html = await pagina();
    // Las dos vistas conviven (una oculta); nada se destruye al cambiar.
    expect(html).toContain('id="vista-principal"');
    expect(html).toContain('id="vista-ajustes"');
  });
});

/**
 * S5 — formato, framework forzado y aviso de destino, probados sobre el
 * HTML que el servidor sirve: la interfaz debe **ofrecer** lo que el
 * CLI ya sabía hacer, no solo aceptarlo si llega escrito a mano.
 */
describe("formato, framework y destino (S5)", () => {
  test("la página pinta el selector de framework vacío, con la opción auto", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('id="framework"');
    expect(html).toContain('data-i18n="framework.auto"');
    // La lista la rellena /api/capabilities: el HTML no la lleva a mano.
    expect(html).not.toMatch(/<option value="express"/);
  });

  test("la página reserva sitio para la nota de los formatos no reimportables", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('id="nota-bruno"');
  });

  test("capabilities de verdad marca bruno como no importable", async () => {
    const { status, json } = await post("/api/capabilities");
    expect(status).toBe(200);
    const importables = json["postmanImportable"] as string[];
    expect(importables).not.toContain("bruno");
  });

  test("generar con framework inventado, sobre el proceso real, da 400", async () => {
    const { status, json } = await post("/api/generate", {
      projectRoot: proyecto,
      framework: "inventado",
    });
    expect(status).toBe(400);
    const error = json["error"] as { nextAction: string };
    expect(error.nextAction).toContain("express");
  });
});
