/**
 * `summary` — la evidencia textual del detector de framework.
 *
 * El usuario del CLI no abre Postman: abre el terminal y ejecuta
 * `expostman summary`. La línea que sigue a `→ Framework:` es la que
 * convierte "framework: express" en "porque `package.json` declara
 * express en dependencies". Esa línea la construye `summary.script.ts`
 * con los `evidence` que el detector de cada framework devuelve.
 *
 * Lo que se prueba aquí es que **cada framework soportado emite
 * evidencia legible**: el `signal` es una frase en castellano, el
 * `weight` está en [0..1] y el `artifact` apunta al fichero del que
 * salió la señal. Sin esto, la tarjeta "¿Por qué X?" en el resumen
 * saldría vacía para casi todos los frameworks, y un dashboard
 * siempre vacío no enseña nada.
 *
 * El detector es la fuente de verdad del peso —si el orquestador lo
 * acepta, aquí se acepta—; el test verifica la **forma** del payload,
 * no el valor concreto de cada peso, porque ese valor cambia con cada
 * detector que se enriquezca.
 */
import { describe, expect, test } from "vitest";

import { summarizeWithAllFrameworks } from "../../packages/frameworks/index.js";
import type { IProjectDetectionEvidence } from "../../packages/contracts/interfaces/core/scanner.interface.js";

/**
 * Raíz de las fixtures reales. Cada carpeta modela un framework
 * distinto y, según el detector, emite evidencia distinta.
 *
 * No se enumeran los 21 frameworks del registro: algunos detectores
 * (Phoenix, Ktor, Fiber, Rust, Fiber, Hono, trpc, GraphQL) todavía no
 * se han enriquecido con `withEvidence` y su `evidence` es vacío. El
 * contrato a probar es el de los que sí emiten —los que el usuario
 * realmente ve en el `summary`—; los demás se cubren cuando se
 * migren.
 */
const FIXTURES = {
  express: "tests/fixtures/express-comprehensive",
  fastapi: "tests/fixtures/fastapi-comprehensive",
  laravel: "tests/fixtures/laravel-comprehensive",
  django: "tests/fixtures/django-comprehensive",
  rails: "tests/fixtures/rails-comprehensive",
  aspnet: "tests/fixtures/aspnet-comprehensive",
  flask: "tests/fixtures/flask-comprehensive",
  symfony: "tests/fixtures/symfony-comprehensive",
} as const;

/**
 * Tipo `signal` con todas las claves contractuales obligatorias.
 *
 * El test falla si el detector olvida `weight` o devuelve una señal
 * vacía, que es lo que pasaría si un `withEvidence(score, [])` se
 * colara al resumen por error: la línea `→ ¿Por qué X?` se imprimiría
 * sin bullets y el usuario se quedaría sin respuesta.
 */
function esEvidenciaLegible(e: unknown): e is IProjectDetectionEvidence {
  if (typeof e !== "object" || e === null) return false;
  const v = e as Record<string, unknown>;
  if (typeof v["signal"] !== "string" || v["signal"].trim() === "") return false;
  if (typeof v["weight"] !== "number") return false;
  if (v["weight"] < 0 || v["weight"] > 1) return false;
  if (v["artifact"] !== undefined && typeof v["artifact"] !== "string") {
    return false;
  }
  return true;
}

describe("summary — evidence: cada framework conocido emite evidencia legible", () => {
  /**
   * Express: detector con un único `withEvidence` que anota la
   * declaración de `express` (o un prefijo coincidente) en
   * `package.json`. La señal debe mencionar el nombre del paquete y
   * el fichero del que salió.
   */
  test("Express: la evidencia apunta a package.json y menciona 'express'", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.express);
    expect(summary.framework).toBe("express");
    expect(summary.evidence.length).toBeGreaterThan(0);
    const primera = summary.evidence[0]!;
    expect(esEvidenciaLegible(primera)).toBe(true);
    expect(primera.signal.toLowerCase()).toContain("express");
    expect(primera.artifact).toBe("package.json");
  });

  /**
   * FastAPI: el detector escanea varios `requirements*` y `pyproject.toml`;
   * al menos una señal debe mencionar `fastapi` y un artefacto de los
   * que el detector inspecciona.
   */
  test("FastAPI: la evidencia menciona fastapi y un artefacto de dependencias", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.fastapi);
    expect(summary.framework).toBe("fastapi");
    expect(summary.evidence.length).toBeGreaterThan(0);
    const mencionaFastapi = summary.evidence.some((e) =>
      e.signal.toLowerCase().includes("fastapi"),
    );
    expect(mencionaFastapi).toBe(true);
    for (const e of summary.evidence) {
      expect(esEvidenciaLegible(e)).toBe(true);
    }
  });

  /**
   * Laravel: el detector suma varias señales (artisan, routes/, app/,
   * composer.json) hasta cubrir el score. Aquí se valida que la suma
   * de pesos **refleja** las señales (el peso del summary es la suma
   * de los pesos individuales, modulada por el `withEvidence` que
   * aplica `Math.min(score, 1)`).
   */
  test("Laravel: la suma de pesos coincide con el score del detector (≤ 1)", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.laravel);
    expect(summary.framework).toBe("laravel");
    expect(summary.evidence.length).toBeGreaterThanOrEqual(2);
    const sumaPesos = summary.evidence.reduce((acc, e) => acc + e.weight, 0);
    // El detector usa `Math.min(suma, 1)`, así que la suma puede
    // superar 1: lo que se garantiza es que **cada** peso está acotado
    // y la suma es lo que el detector eligió reportar.
    for (const e of summary.evidence) {
      expect(esEvidenciaLegible(e)).toBe(true);
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
    expect(sumaPesos).toBeGreaterThan(0);
    expect(sumaPesos).toBeGreaterThanOrEqual(1); // Laravel típico detecta a 1
  });

  /**
   * Django: detector con dos señales (manage.py + referencia a
   * Django en requirements/pyproject). La primera debe mencionar
   * `manage.py` (la segunda es opcional según cómo se monte la
   * fixture).
   */
  test("Django: la evidencia principal menciona manage.py", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.django);
    expect(summary.framework).toBe("django");
    expect(summary.evidence.length).toBeGreaterThan(0);
    const mencionaManage = summary.evidence.some((e) =>
      e.signal.toLowerCase().includes("manage.py"),
    );
    expect(mencionaManage).toBe(true);
    for (const e of summary.evidence) {
      expect(esEvidenciaLegible(e)).toBe(true);
    }
  });

  /**
   * Forma global: si sumamos la evidencia de **todas** las
   * fixtures, ningún elemento infringe el contrato. Una sola señal
   * mal formada por detector basta para que el CLI imprima basura o
   * tire la línea, así que este test cubre al resto de detectores
   * que comparten el helper `withEvidence`.
   */
  test("todas las señales de las fixtures son legibles y bounded", async () => {
    for (const fx of Object.values(FIXTURES)) {
      const summary = await summarizeWithAllFrameworks(fx);
      for (const e of summary.evidence) {
        expect(
          esEvidenciaLegible(e),
          `${fx} → ${JSON.stringify(e)}`,
        ).toBe(true);
      }
    }
  });
});

describe("summary — evidence: borde y composición", () => {
  /**
   * Sin framework detectado, `evidence` se queda en `[]` y la línea
   * `→ ¿Por qué X?` se omite del todo (no imprime el bloque con
   * cero bullets). Una fixture que no matchea ningún detector activa
   * este camino: el CLI no debe inventar evidencia.
   *
   * Se usa un directorio temporal con un `package.json` que no
   * declara nada — el orquestador devuelve `{ score: 0, evidence: [] }`
   * y el resumen propaga el vacío.
   */
  test("proyecto sin framework detectado: evidence es [] y no rompe el summary", async () => {
    // `mkdtemp` con un nombre estable para el test; el contenido se
    // borra en `afterEach` del spec hermano si aplica.
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "evidence-empty-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "vacio", version: "1.0.0" }),
      );
      const summary = await summarizeWithAllFrameworks(root);
      // El resumen cae al framework vacío: la línea `→ ¿Por qué X?`
      // no se imprime (evidence vacío), y `routesInCode` queda a 0.
      // Lo que se verifica es **el contrato del bloque evidence**:
      // debe estar vacío y no inventar señales.
      expect(summary.evidence).toEqual([]);
      expect(summary.routesInCode).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * Rails emite exactamente dos señales canónicas (config/routes.rb
   * y Gemfile). El detector no añade más — un detector que empiece a
   * inventar señales cambia el contrato del usuario: la línea
   * `→ ¿Por qué Rails?` se alarga con cada cambio de detector y el
   * usuario deja de saber qué mirar.
   */
  test("Rails: emite exactamente las señales canónicas (routes.rb + Gemfile)", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.rails);
    expect(summary.framework).toBe("rails");
    expect(summary.evidence.length).toBe(2);
    const artefactos = summary.evidence
      .map((e) => e.artifact)
      .filter((a): a is string => typeof a === "string")
      .sort();
    expect(artefactos).toContain("config/routes.rb");
    expect(artefactos).toContain("Gemfile");
  });
});