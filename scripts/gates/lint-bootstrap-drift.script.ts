#!/usr/bin/env bun
/**
 * `bun run lint:bootstrap-drift` — que el contrato hable del código real.
 *
 * `AGENT-BOOTSTRAP.md` **es** el contrato de trabajo de este repo:
 * `CLAUDE.md`, `AGENTS.md` y `.github/copilot-instructions.md` apuntan
 * ahí y a ningún otro sitio. Y describía una arquitectura que se había
 * sustituido tres reorganizaciones antes:
 *
 *   - §3.8 documentaba un `IRouterAdapter` y un
 *     `router-dispatcher.service.ts` que no existían en el repositorio.
 *   - §3.1 declaraba un nombre de tool que ningún tool registraba, con
 *     una constante que no importaba nadie.
 *   - Cuatro de las rutas que citaba no existían.
 *
 * Lo caro no es que estuviera viejo: es que **nadie podía notarlo**. Una
 * regla que nadie comprueba se convierte en folclore, y entonces deja de
 * gobernar nada. Los dos hallazgos FATAL de la auditoría de 2026-08-08
 * eran reglas que este fichero enunciaba y que ningún gate miraba.
 *
 * Qué se comprueba:
 *
 *   1. Toda ruta entre backticks que parezca del repo existe en disco.
 *   2. Todo símbolo de contrato que cite (`IAlgo`) existe en el código.
 *
 * Qué NO se comprueba, y por qué: **las líneas de cita (`>`)**. Ahí es
 * donde viven las notas de "esta sección decía X y era mentira", que
 * nombran a propósito lo que ya no existe. Borrar esa arqueología para
 * contentar a un lint sería perder el motivo por el que la regla es como
 * es. La convención, entonces, es explícita: en una cita se puede
 * nombrar lo muerto; fuera de ella, todo lo que se nombra existe.
 *
 * Uso:
 *   bun run lint:bootstrap-drift
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** El fichero que gobierna el trabajo de los agentes. */
const BOOTSTRAP = fromRoot("docs", "delendai", "AGENT-BOOTSTRAP.md");

/**
 * Una ruta del repo entre backticks.
 *
 * Exige una barra y una extensión conocida, o una barra final. Sin eso
 * entrarían `z.object({...})` y media docena de expresiones que llevan
 * barra sin ser rutas.
 */
const RUTA = /`([\w.@-]+(?:\/[\w.@${}-]+)+\/?(?:\.\w+)?)`/g;

/** Extensiones que cuentan como fichero del repo. */
const EXTENSIONES = [".ts", ".js", ".json", ".md", ".yml", ".yaml"];

/**
 * Un símbolo de contrato: `IAlgo`, `IOtraCosa`.
 *
 * Fuera de un bloque de código hay que exigir backticks, o entrarían
 * palabras de la prosa. Dentro no los hay —es código— y **ahí es donde
 * importa**: `IRouterAdapter` vivía en el bloque de §3.8, sin backticks,
 * durante tres reorganizaciones.
 */
const SIMBOLO = /`(I[A-Z]\w+)`/g;
const SIMBOLO_EN_CODIGO = /\b(I[A-Z]\w+)\b/g;

interface IProblem {
  readonly line: number;
  readonly detail: string;
}

/** ¿La línea es una cita? Ahí se permite nombrar lo que ya no existe. */
function esCita(line: string): boolean {
  return /^\s*>/.test(line);
}

/** Rutas que el host expande, no nosotros. */
function esPlantilla(ruta: string): boolean {
  return ruta.includes("${");
}

/** ¿Parece una ruta de este repo, y no una URL o un paquete npm? */
function pareceRutaDelRepo(ruta: string): boolean {
  if (ruta.startsWith("http") || ruta.startsWith("@")) return false;
  if (ruta.endsWith("/")) return true;
  return EXTENSIONES.some((ext) => ruta.endsWith(ext));
}

/** Resuelve una ruta del bootstrap, que puede ser relativa a `docs/delendai/`. */
function candidatos(ruta: string): string[] {
  const limpia = ruta.replace(/^\.\//, "");
  return [
    join(REPO_ROOT, limpia),
    join(REPO_ROOT, "docs", "delendai", limpia),
    // `../../packages/...` desde el propio bootstrap.
    join(REPO_ROOT, "docs", "delendai", ruta),
  ];
}

async function existeAlguno(rutas: readonly string[]): Promise<boolean> {
  const { stat } = await import("node:fs/promises");
  for (const r of rutas) {
    try {
      await stat(r);
      return true;
    } catch {
      /* siguiente */
    }
  }
  return false;
}

async function main(): Promise<number> {
  const source = await readFile(BOOTSTRAP, "utf8");
  const lines = source.split("\n");
  const problems: IProblem[] = [];

  // Todo el código del repo, para buscar los símbolos citados.
  const sources = await collectFiles(fromRoot("packages"), [".ts"]);
  const codigo = (
    await Promise.all(sources.map((f) => readFile(f, "utf8")))
  ).join("\n");

  let rutasVistas = 0;
  let simbolosVistos = 0;
  let enCodigo = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Los bloques cercados **sí** se miran: es donde vivía el
    // `IRouterAdapter` que este gate existe para cazar. Solo se salta
    // la línea del delimitador, y se recuerda si estamos dentro para
    // buscar los símbolos sin backticks.
    if (/^\s*```/.test(line)) {
      enCodigo = !enCodigo;
      continue;
    }
    // Una cita es arqueología: puede nombrar lo que ya no existe.
    if (esCita(line)) continue;

    for (const m of line.matchAll(RUTA)) {
      const ruta = m[1] ?? "";
      if (!pareceRutaDelRepo(ruta) || esPlantilla(ruta)) continue;
      rutasVistas += 1;
      if (!(await existeAlguno(candidatos(ruta)))) {
        problems.push({ line: i + 1, detail: `ruta que no existe: ${ruta}` });
      }
    }

    for (const m of line.matchAll(enCodigo ? SIMBOLO_EN_CODIGO : SIMBOLO)) {
      const simbolo = m[1] ?? "";
      simbolosVistos += 1;
      if (!codigo.includes(simbolo)) {
        problems.push({
          line: i + 1,
          detail: `símbolo que no existe en el código: ${simbolo}`,
        });
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:bootstrap-drift — ${problems.length} referencia(s) que el código no respalda:\n`,
    );
    for (const p of problems) {
      console.error(`  ✗ AGENT-BOOTSTRAP.md:${p.line} — ${p.detail}`);
    }
    console.error(
      "\n  Este fichero es el contrato de trabajo del repo. Si describe algo\n" +
        "  que ya no existe, cualquier agente que lo lea trabaja contra un mapa\n" +
        "  viejo — que es exactamente cómo se colaron los dos FATAL de a00001.\n" +
        "\n  Para dejar constancia de lo que decía antes, ponlo en una cita (`>`):\n" +
        "  ahí sí se puede nombrar lo que ya no existe.",
    );
    return 1;
  }

  console.log(
    `lint:bootstrap-drift — ${rutasVistas} rutas y ${simbolosVistos} símbolos citados, todos reales`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
