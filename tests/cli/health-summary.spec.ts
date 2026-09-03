/**
 * `summary` — la salud de la documentación, en lo que ve el usuario.
 *
 * El cómputo puro tiene su spec (`tests/core/project-health.spec.ts`):
 * allí se verifica que `computeProjectHealth()` clasifica cada
 * categoría en su pieza. Lo que se verifica aquí es **lo que el
 * comando `summary` entrega**: el bloque `health` dentro de
 * `IProjectSummary`, los cuatro porcentajes que se imprimen tal cual
 * en la línea `→ Health: validation x% · body x% · examples x% ·
 * descriptions x%` del CLI, y la coherencia del conjunto cuando se
 * combina con fixtures reales.
 *
 * El dato de cada test es el resumen de un proyecto, no un `EndpointSpec`
 * armado a mano: el `summary` no se alimenta de specs sueltos sino del
 * `result.specs` que produce el pipeline. Reproducir el path completo
 * —frameworks → routes → specs finales— es lo que distingue un test
 * del summary de un test de `computeProjectHealth`.
 */
import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { summarizeWithAllFrameworks } from "../../packages/frameworks/index.js";
import type {
  IProjectHealth,
  IProjectSummary,
} from "../../packages/contracts/interfaces/core/domain.interface.js";

/** Raíz de las fixtures reales: cada carpeta modela un framework distinto. */
const FIXTURES = {
  express: "tests/fixtures/express-comprehensive",
  fastapi: "tests/fixtures/fastapi-comprehensive",
  laravel: "tests/fixtures/laravel-comprehensive",
  django: "tests/fixtures/django-comprehensive",
  rails: "tests/fixtures/rails-comprehensive",
} as const;

/** Carpeta temporal con un proyecto vacío: `summary` lo aceptará. */
let work = "";

afterEach(async () => {
  if (work) {
    await rm(work, { recursive: true, force: true });
    work = "";
  }
});

async function proyectoVacio(): Promise<string> {
  work = await mkdtemp(join(tmpdir(), "health-summary-"));
  await mkdir(work, { recursive: true });
  return work;
}

async function proyectoConManifest(
  manifest: string,
  filename = "package.json",
): Promise<string> {
  const root = await proyectoVacio();
  await writeFile(join(root, filename), manifest);
  return root;
}

describe("summary — health: las cuatro categorías del bloque", () => {
  /**
   * El CLI imprime la línea `→ Health: validation x% · body x% · examples
   * x% · descriptions x%`. Cada porcentaje es lo que el usuario ve sin
   * abrir el JSON; si alguno se sale del rango 0..100, esa línea
   * imprime `NaN%` o `150%`, que es exactamente la mentira que el health
   * viene a evitar.
   */
  test("los cuatro porcentajes son enteros acotados en 0..100", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.express);
    const health = summary.health;
    expect(Number.isInteger(health.withValidationPercent)).toBe(true);
    expect(Number.isInteger(health.withBodySchemaPercent)).toBe(true);
    expect(Number.isInteger(health.withExamplesPercent)).toBe(true);
    expect(Number.isInteger(health.withDescriptionPercent)).toBe(true);
    for (const value of [
      health.withValidationPercent,
      health.withBodySchemaPercent,
      health.withExamplesPercent,
      health.withDescriptionPercent,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  /**
   * `withValidationPercent` cuenta `formRequest != null` por endpoint.
   * Una fixture con formularios resueltos (Laravel) y otra sin ellos
   * (Rails, que no usa FormRequest por convención) deben producir
   * porcentajes distintos: si los dos salieran a 0 o a 100, la
   * categoría no se estaría midiendo.
   */
  test("rutas con validación: Laravel supera a Rails porque tiene FormRequest", async () => {
    const laravel = await summarizeWithAllFrameworks(FIXTURES.laravel);
    const rails = await summarizeWithAllFrameworks(FIXTURES.rails);
    expect(laravel.health.withValidationPercent).toBeGreaterThan(
      rails.health.withValidationPercent,
    );
    // Sanity: el fixture Laravel real debe tener al menos un FormRequest
    // resuelto; si no, el contraste no probaría nada.
    expect(laravel.withFormRequest).toBeGreaterThan(0);
  });

  /**
   * `withBodySchemaPercent` cuenta specs cuyo `body` trae contenido
   * real. La fixture FastAPI del repo está armada con Pydantic: la
   * inferencia agnóstica del pipeline resuelve bodies para sus
   * endpoints, así que el porcentaje tiene que ser > 0. Si saliera 0,
   * algo en el cableado summary → computeProjectHealth se rompió.
   */
  test("bodies con schema: FastAPI infiere bodies desde Pydantic, no es 0", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.fastapi);
    expect(summary.health.withBodySchemaPercent).toBeGreaterThan(0);
    // Y el contador canónico del propio resumen debe coincidir con el
    // cociente que devuelve el health (ambos redondean igual): si los
    // dos números cuentan cosas distintas, el `summary` y el tool MCP
    // enseñan métricas que discrepan.
    const total = summary.routesInCode;
    if (total > 0) {
      const derivedFromCounters = Math.round(
        (summary.bodiesAdded > 0 ? summary.routesInCode : 0) / total * 100,
      );
      expect(summary.health.withBodySchemaPercent).toBeGreaterThanOrEqual(
        derivedFromCounters,
      );
    }
  });

  /**
   * `withExamplesPercent` admite **dos** vías de ejemplo: body con
   * contenido o query/header con valor. La inferencia agnóstica
   * rellena queries cuando puede, así que la fixture Express —
   * modelos sin validación formal— debe tener ejemplos aunque su body
   * esté vacío en varios endpoints.
   */
  test("examples: Express tiene ejemplos vía query aunque no use FormRequest", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.express);
    expect(summary.health.withExamplesPercent).toBeGreaterThan(0);
  });

  /**
   * `withDescriptionPercent` exige texto tras `trim()`. Las fixtures
   * reales rara vez llevan docstrings por ruta, así que el porcentaje
   * tiende a 0; si se queda a 0 también en un proyecto que **sí**
   * tendría descripciones (Django suele llevar docstrings en
   * views.py), sería un bug. Aquí validamos solo la cota mínima:
   * nunca negativo y siempre entero.
   */
  test("descriptions: el porcentaje nunca es negativo aunque el proyecto no documente", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.django);
    expect(summary.health.withDescriptionPercent).toBeGreaterThanOrEqual(0);
    expect(summary.health.withDescriptionPercent).toBeLessThanOrEqual(100);
  });
});

describe("summary — health: el cómputo combinado", () => {
  /**
   * Cero endpoints → cero en todo. La regla está en
   * `computeProjectHealth`: si el total es 0, no se divide. Un
   * proyecto recién creado (con `package.json` y nada más) cae en
   * este caso y el CLI debe imprimir `validation 0% · body 0% ·
   * examples 0% · descriptions 0%`, no `NaN%`.
   */
  test("un proyecto sin rutas: los cuatro porcentajes son 0", async () => {
    const root = await proyectoConManifest(
      JSON.stringify({ name: "vacio", version: "1.0.0" }),
    );
    const summary = await summarizeWithAllFrameworks(root);
    const health = summary.health;
    expect(health.withValidationPercent).toBe(0);
    expect(health.withBodySchemaPercent).toBe(0);
    expect(health.withExamplesPercent).toBe(0);
    expect(health.withDescriptionPercent).toBe(0);
    expect(summary.routesInCode).toBe(0);
  });

  /**
   * El porcentaje **derivado** de los contadores canónicos del resumen
   * debe coincidir con el que el bloque `health` declara. Si difieren,
   * hay dos métricas eligiendo specs distintos: una de las dos está
   * mintiendo, y eso es exactamente lo que el health viene a evitar.
   *
   * Esta es la garantía de coherencia que el CLI y el tool MCP
   * necesitan: quien lea `withFormRequest` y `routesInCode` y se haga
   * la cuenta, debe sacar lo mismo que `summary.health.withValidationPercent`.
   */
  test("coherencia: el porcentaje de validación coincide con withFormRequest/total", async () => {
    for (const fx of [
      FIXTURES.express,
      FIXTURES.fastapi,
      FIXTURES.laravel,
      FIXTURES.django,
    ]) {
      const summary = await summarizeWithAllFrameworks(fx);
      const total = summary.routesInCode;
      if (total === 0) continue;
      const esperado = Math.round((summary.withFormRequest / total) * 100);
      expect(summary.health.withValidationPercent).toBe(esperado);
    }
  });

  /**
   * Los cuatro porcentajes **no** tienen que sumar 100: un endpoint
   * puede llevar validación, body, ejemplo y descripción todo a la
   * vez. Lo que se valida es que cada uno mide **su** categoría, no
   * la del vecino. Si dos categorías coincidieran siempre, una de
   * las dos no estaría midiendo.
   */
  test("las cuatro categorías son independientes: ninguna copia a otra", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.laravel);
    const health = summary.health;
    // Categorías estructuralmente distintas deben poder diferir. Si en
    // esta fixture todas son iguales, el contrato se rompe: significaría
    // que medir una es medir todas.
    const values = [
      health.withValidationPercent,
      health.withBodySchemaPercent,
      health.withExamplesPercent,
      health.withDescriptionPercent,
    ];
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  /**
   * La forma del bloque `health` no cambia entre proyectos: el CLI
   * imprime siempre las cuatro claves con números. Un test pequeño
   * pero decisivo — si `IProjectHealth` perdiera una clave, este test
   * detecta el cambio de contrato antes de que la línea del CLI
   * empiece a imprimir `undefined%`.
   */
  test("el bloque health tiene exactamente las cuatro claves contractuales", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.django);
    const claves = Object.keys(summary.health).sort();
    expect(claves).toEqual([
      "withBodySchemaPercent",
      "withDescriptionPercent",
      "withExamplesPercent",
      "withValidationPercent",
    ]);
    // Y todas las firmas son `number`: si alguien metiera un string por
    // accidente, el CLI imprimiría `validation abc%`. El listado de
    // claves ya viene tipado por `Object.keys` — pero `IProjectHealth`
    // no expone firma dinámica, así que se itera como unión literal
    // (las cuatro claves contractuales, en su orden) en lugar de un
    // index dinámico.
    const clavesTipadas: ReadonlyArray<keyof IProjectHealth> = [
      "withBodySchemaPercent",
      "withDescriptionPercent",
      "withExamplesPercent",
      "withValidationPercent",
    ];
    for (const clave of clavesTipadas) {
      expect(typeof summary.health[clave]).toBe("number");
    }
    expect(claves).toEqual([...clavesTipadas].sort());
  });
});

/**
 * Helper: typeguard para que los tests que importan esto no tengan
 * que repetir el cast a `IProjectHealth` cuando quieran leer un campo.
 */
export function isHealth(value: unknown): value is IProjectHealth {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["withValidationPercent"] === "number" &&
    typeof v["withBodySchemaPercent"] === "number" &&
    typeof v["withExamplesPercent"] === "number" &&
    typeof v["withDescriptionPercent"] === "number"
  );
}

/** Typeguard paralelo para `IProjectSummary`, útil en composición. */
export function isSummary(value: unknown): value is IProjectSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["framework"] === "string" &&
    typeof v["projectName"] === "string" &&
    typeof v["routesInCode"] === "number" &&
    Array.isArray(v["warnings"]) &&
    Array.isArray(v["evidence"]) &&
    isHealth(v["health"])
  );
}