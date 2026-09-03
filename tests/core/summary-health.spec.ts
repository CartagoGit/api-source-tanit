/**
 * `summarizeProject` — el health en la salida del `summary`.
 *
 * El cómputo puro tiene su propio spec (`project-health.spec.ts`); aquí
 * lo que se fija es el cableado: que el resumen que consumen el CLI y
 * el tool MCP lleva el bloque `health`, y que es **coherente con los
 * contadores que el mismo resumen ya declara** — un health que
 * contradiga a `withFormRequest` sería dos métricas eligiendo specs
 * distintos.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { summarizeProject } from "../../packages/core/discovery/summary.service";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";

/**
 * Un proyecto Express mínimo, en disco: una ruta con `express-validator`
 * no hay; el health de este fixture sale sin validación resuelta y con
 * bodies inferidos, que es exactamente el caso "sin reglas" que hay
 * que distinguir del "con reglas".
 */
async function proyectoExpressMini(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "health-summary-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      { name: "health-mini", version: "1.0.0", dependencies: { express: "4" } },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, "src", "app.js"),
    [
      "const express = require('express');",
      "const app = express();",
      "app.use(express.json());",
      "app.post('/users', (req, res) => res.json(req.body));",
      "app.get('/users', (req, res) => res.json([]));",
      "app.listen(3000);",
    ].join("\n"),
  );
  return root;
}

describe("summarizeProject — health", () => {
  test("el resumen lleva el bloque health con porcentajes 0..100", async () => {
    const root = await proyectoExpressMini();
    try {
      const summary = await summarizeProject(root, defaultOrchestrator());
      const health = summary.health;
      expect(health).toBeDefined();
      for (const value of [
        health.withValidationPercent,
        health.withBodySchemaPercent,
        health.withExamplesPercent,
        health.withDescriptionPercent,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("el health es coherente con los contadores del propio resumen", async () => {
    const root = await proyectoExpressMini();
    try {
      const summary = await summarizeProject(root, defaultOrchestrator());
      const total = summary.routesInCode;
      if (total === 0) return; // Sin rutas no hay nada que contrastar.
      const health = summary.health;
      // El % de validación derivado de los contadores canónicos debe
      // coincidir con el que el health declara (ambos redondean igual).
      expect(health.withValidationPercent).toBe(
        Math.round((summary.withFormRequest / total) * 100),
      );
      // Y el total del pipeline manda: el body computado no puede
      // superar lo que `routesInCode` dice que existe.
      expect(health.withBodySchemaPercent).toBeLessThanOrEqual(100);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
