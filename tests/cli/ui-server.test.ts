/**
 * `expostman ui` actually started, talking to it via HTTP.
 *
 * `ui-routes.spec.ts` tests the responses with doubles. This tests
 * what no double can: that the port opens, that the page is served,
 * that a POST without body does not blow up, and —above all— that
 * **generating writes to the requested project**.
 *
 * It runs as a subprocess and not in the same test: `Bun.serve` only
 * exists under Bun, and vitest runs in Node workers. Launching it
 * from the outside is also what we really want to test — the whole
 * command, not its pieces.
 *
 * The generation case is not hypothetical. Exercising the API by
 * hand, the first version wrote the collection **inside this
 * repository** instead of in the requested project: `runGenerate`
 * read its flags from the argv passed to it, but the retired
 * singleton in `paths.service` (r00010 S2, 2026-09-03) resolved
 * the root by reading `process.argv` of the process — which in a
 * long-lived server was the one from `expostman ui`. It is the debt
 * r00005 came to close.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";

/** A lightly used port, and the server looks for another if busy. */
const PORT = 4881;
const BASE = `http://127.0.0.1:${PORT}`;

let work = "";
let proyecto = "";
let proceso: ChildProcess | null = null;

/** Waits for the server to answer, without sleeping blindly. */
async function esperarAlServidor(intentos = 60): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => { setTimeout(() => r(undefined), 250); });
  }
  throw new Error(`The interface did not respond at ${BASE} after ${intentos} attempts`);
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

/** The token the page serves. Without it the API does not answer. */
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
    headers: { "x-tanit-token": token },
    ...(cuerpo === undefined
      ? {}
      : {
          headers: {
            "content-type": "application/json",
            "x-tanit-token": token,
          },
          body: JSON.stringify(cuerpo),
        }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("the page", () => {
  test("is served from memory, without reading files from disk", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    // The product title (b00001 S5: Tanit rebrand). The test must
    // not depend on the language of the `<h1>` (it goes with
    // data-i18n), so it looks at `<title>`, which is unique on the
    // page.
    expect(html).toContain("<title>Tanit</title>");
  });

  test("declares language, for screen readers", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('<html lang="es"');
  });

  test("loads nothing from outside: the policy forbids it", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await (await fetch(`${BASE}/`)).text();
    // No CDN or remote fonts: the `.exe` has to work without network.
    expect(html).not.toMatch(/src="https?:/);
  });

  test("what is neither the page nor the API returns 404", async () => {
    // With token: without it a 403 would come out and the 404 would
    // remain untested.
    const res = await fetch(`${BASE}/otra-cosa`, {
      headers: { "x-tanit-token": await testigo() },
    });
    expect(res.status).toBe(404);
  });
});

/**
 * That **another web** cannot drive this interface.
 *
 * Listening on `127.0.0.1` is not enough, and that is the trap: the
 * server is not reachable from the network, but it is from the
 * browser of whoever runs it. Any page that person visits while the
 * interface is running can POST to it.
 *
 * It was measured before the fix: with `content-type: text/plain` —
 * a "simple" request, which the browser sends **without preflight**
 * — any web could get `/api/generate` to write files wherever it
 * wanted, via `outputDir`. It could not read the response, but the
 * effect had already happened.
 */
describe("the interface cannot be driven from outside", () => {
  test("without a token it does not answer, even if the request is valid", async () => {
    const res = await fetch(`${BASE}/api/capabilities`, { method: "POST" });
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error: { reason: string } };
    expect(j.error.reason).toMatch(/token/i);
  });

  /**
   * THE test. `text/plain` is what makes the request "simple" and
   * therefore exempt from preflight: it is the exact door through
   * which the attack entered.
   */
  test("the simple POST with `text/plain` does not pass either", async () => {
    // The folder goes inside this test's temp and not in `/tmp`
    // bare: a fixed path makes the test depend on what the previous
    // run left, and that is exactly what happened — when checking
    // that the test caught the bug, the unguarded run created the
    // folder and the next pass failed for that, not for the bug.
    const noDeberia = join(work, "no-deberia-existir");
    const res = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ projectRoot: proyecto, outputDir: noDeberia }),
    });
    expect(res.status).toBe(403);
    // And it has not written anything.
    await expect(readdir(noDeberia)).rejects.toThrow();
  });

  test("a foreign Origin is rejected before looking at the body", async () => {
    const res = await fetch(`${BASE}/api/capabilities`, {
      method: "POST",
      headers: { origin: "https://malicioso.example" },
    });
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error: { reason: string } };
    expect(j.error.reason).toContain("malicioso.example");
  });

  test("the page carries the token inside, so only it can use it", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toMatch(/data-token="[0-9a-f-]{36}"/);
  });

  /**
   * The token goes in the HTML and not in a cookie on purpose: a
   * cookie is sent by the browser **by itself** on any request to
   * this origin, including those triggered by another web. That
   * would make it useless here.
   */
  test("does not rely on cookies", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("the API", () => {
  /**
   * The interface asks for this as soon as it loads, and without
   * body. The first version treated it as "invalid JSON" and the
   * page failed on its first request.
   */
  test("a POST without body is legitimate", async () => {
    const { status, json } = await post("/api/capabilities");
    expect(status).toBe(200);
    expect(json["formats"]).toContain("postman");
    expect(json["frameworks"]).toContain("express");
  });

  test("a broken body is an error, and it says so", async () => {
    const res = await fetch(`${BASE}/api/inspect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tanit-token": await testigo(),
      },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
  });

  test("inspects the real project", async () => {
    const { status, json } = await post("/api/inspect", { projectRoot: proyecto });
    expect(status).toBe(200);
    const summary = json["summary"] as { framework: string; routesInCode: number };
    expect(summary.framework).toBe("express");
    expect(summary.routesInCode).toBeGreaterThan(0);
  });

  test("inspecting does not write anything", async () => {
    await post("/api/inspect", { projectRoot: proyecto });
    await expect(readdir(join(proyecto, OUTPUT_DIR_NAME))).rejects.toThrow();
  });

  test("a folder that does not exist returns 404 with output", async () => {
    const { status, json } = await post("/api/inspect", { projectRoot: "/no/existe/zzz" });
    expect(status).toBe(404);
    const error = json["error"] as { nextAction: string };
    expect(error.nextAction.length).toBeGreaterThan(0);
  });

  /**
   * THE test. Without `withScopedPaths`, this wrote inside the repo
   * from which the interface was launched.
   */
  test("generate writes to the requested project", { timeout: 120_000 }, async () => {
    const { status, json } = await post("/api/generate", { projectRoot: proyecto });
    expect(status).toBe(200);
    const result = json["result"] as { collectionPath: string; requests: number };
    expect(result.collectionPath.startsWith(proyecto)).toBe(true);
    expect(result.requests).toBeGreaterThan(0);

    // And it is really on disk, where it says.
    const salida = await readdir(join(proyecto, OUTPUT_DIR_NAME));
    expect(salida.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  test("a made-up format is rejected and says which ones are valid", async () => {
    const { status, json } = await post("/api/generate", {
      projectRoot: proyecto,
      formats: ["inventado"],
    });
    expect(status).toBe(400);
    const error = json["error"] as { nextAction: string };
    expect(error.nextAction).toContain("postman");
  });

  test("saved settings reach the page", async () => {
    const { status, json } = await post("/api/settings");
    expect(status).toBe(200);
    expect(json["ok"]).toBe(true);
    const settings = json["settings"] as Record<string, unknown>;
    expect(settings["version"]).toBe(1);
  });

  test("saving a setting from the page actually persists it", async () => {
    const guardado = await post("/api/settings/save", { theme: "dark" });
    expect(guardado.status).toBe(200);
    // Re-read by a new request: it survived on disk.
    const releido = await post("/api/settings");
    const settings = releido.json["settings"] as Record<string, unknown>;
    expect(settings["theme"]).toBe("dark");
  });

  test("languages arrive with their translations, for the selector", async () => {
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
 * S4 — the gear and the settings screen, tested against the HTML that
 * the server actually serves. The gate for this slice is e2e:
 * checking the string in memory is not enough, because what is
 * distributed is what comes out over HTTP.
 */
describe("the settings screen (S4)", () => {
  /** The HTML as it reaches the browser. */
  async function pagina(): Promise<string> {
    return (await fetch(`${BASE}/`)).text();
  }

  test("the gear is in the header, with an accessible name", async () => {
    const html = await pagina();
    expect(html).toContain('id="ajustes"');
    expect(html).toMatch(/<(button|span|div)[^>]*id="ajustes"[^>]*aria-label="[^"]+"/);
  });

  test("the settings screen exists and contains language and theme", async () => {
    const html = await pagina();
    expect(html).toContain('id="vista-ajustes"');
    expect(html).toContain('id="idioma"');
    expect(html).toContain('id="tema"');
  });

  test("the chosen theme travels in data-tema, not in repeated classes", async () => {
    const html = await pagina();
    expect(html).toContain(':root[data-tema="dark"]');
    expect(html).toContain(':root[data-tema="light"]');
    // The system block yields when there is a manual choice.
    expect(html).toContain(':root:not([data-tema="light"])');
  });

  test("the texts carry their translation key in data-i18n", async () => {
    const html = await pagina();
    expect(html).toContain('data-i18n="app.title"');
    expect(html).toContain('data-i18n="settings.language"');
    expect(html).toContain('data-i18n="settings.theme"');
    expect(html).toContain('data-i18n="theme.system"');
  });

  test("there is no save button: saving is automatic", async () => {
    const html = await pagina();
    // The settings section calls /api/settings/save from the script,
    // but no part declares a save button.
    expect(html).not.toMatch(/id="guardar"/i);
    expect(html).toContain("/api/settings/save");
  });

  test("the settings screen does not replace the form: state is preserved", async () => {
    const html = await pagina();
    // Both views coexist (one hidden); nothing is destroyed when switching.
    expect(html).toContain('id="vista-principal"');
    expect(html).toContain('id="vista-ajustes"');
  });
});

/**
 * S5 — format, forced framework and destination notice, tested against
 * the HTML that the server serves: the interface must **offer** what
 * the CLI already knew how to do, not just accept it if it arrives
 * written by hand.
 */
describe("format, framework and destination (S5)", () => {
  test("the page paints the framework selector empty, with the auto option", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('id="framework"');
    expect(html).toContain('data-i18n="framework.auto"');
    // The list is filled by /api/capabilities: the HTML does not
    // carry it by hand.
    expect(html).not.toMatch(/<option value="express"/);
  });

  test("the page reserves space for the note about non-reimportable formats", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('id="nota-bruno"');
  });

  test("real capabilities mark bruno as not importable", async () => {
    const { status, json } = await post("/api/capabilities");
    expect(status).toBe(200);
    const importables = json["postmanImportable"] as string[];
    expect(importables).not.toContain("bruno");
  });

  test("generate with a made-up framework, on the real process, returns 400", async () => {
    const { status, json } = await post("/api/generate", {
      projectRoot: proyecto,
      framework: "inventado",
    });
    expect(status).toBe(400);
    const error = json["error"] as { nextAction: string };
    expect(error.nextAction).toContain("express");
  });
});
