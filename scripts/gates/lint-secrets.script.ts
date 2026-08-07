#!/usr/bin/env bun
/**
 * `bun run lint:secrets` — que no se comitee una credencial.
 *
 * Se escribe aquí en vez de usar `secretlint` o `detect-secrets` por el
 * mismo motivo que los otros ocho lints: un gate que solo corre en CI
 * avisa **después** de que la credencial esté en el historial de Git, y
 * quitarla de ahí ya no es editar un fichero. Este corre en local, en el
 * mismo comando que el resto, antes del commit.
 *
 * Dos familias de reglas, con criterios muy distintos:
 *
 *   1. **Prefijos de proveedor.** `pmak-`, `AKIA`, `ghp_`, `xox…`. Son
 *      formatos públicos y reconocibles: si aparece uno, es una clave.
 *      Prácticamente cero falsos positivos.
 *   2. **Asignaciones a nombres sospechosos** (`password`, `secret`,
 *      `apiKey`) con un valor que **parece real**. Aquí sí hay riesgo de
 *      falso positivo, así que se exige longitud y variedad de
 *      caracteres, y se descartan los marcadores de posición.
 *
 * Lo segundo importa mucho en este repo: los fixtures son proyectos de
 * API de mentira, llenos de `password` y `token` a propósito. Un lint que
 * los marcara sería ruido, y un lint ruidoso se acaba desactivando.
 *
 * Uso:
 *   bun run lint:secrets
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Formatos de credencial que son inconfundibles. */
const PROVIDER_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "clave de API de Postman", re: /\bPMAK-[A-Za-z0-9]{20,}/ },
  { name: "clave de acceso de AWS", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "token de GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "token de Slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "clave de OpenAI", re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: "clave de Google", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "clave privada", re: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/ },
  { name: "URL con credenciales", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/ },
];

/** Nombres de variable que suelen guardar un secreto. */
const SECRET_NAME_RE =
  /\b(?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key|auth[_-]?key)\b\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/i;

/**
 * Valores que **no** son un secreto aunque estén en un campo que lo
 * parezca.
 *
 * Los fixtures y los ejemplos están llenos de estos a propósito: son
 * proyectos de API de mentira que tienen que enseñar un campo
 * `password`. Marcarlos sería ruido, y un lint ruidoso se desactiva.
 */
const PLACEHOLDER_RE =
  /^(?:|x+|\.+|-+|_+|\*+|fake|dummy|example|sample|test|demo|changeme|placeholder|redacted|none|null|undefined|your[-_ ].*|my[-_ ].*|<.*>|\{\{.*\}\}|\$\{.*\}|\$[A-Z_]+|process\.env.*|secret|password|token|apikey|api_key|string|value|hunter2|s3cr3t)$/i;

/**
 * Un valor solo cuenta como secreto si tiene pinta de serlo.
 *
 * Una credencial de verdad es larga y mezcla clases de caracteres. Una
 * cadena como `"contraseña de prueba"` no cumple ninguna de las dos.
 */
function looksLikeSecret(value: string): boolean {
  if (value.length < 16) return false;
  if (PLACEHOLDER_RE.test(value.trim())) return false;
  // Un espacio significa que es una frase, no una clave.
  if (/\s/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(value),
  ).length;
  return classes >= 3;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "export-to-postman",
  "coverage",
]);

/** Extensiones que se revisan. Un binario no se mira. */
const CHECKED_EXTENSIONS = [
  ".ts", ".js", ".mjs", ".cjs", ".json", ".jsonc", ".yaml", ".yml",
  ".env", ".sh", ".ps1", ".php", ".py", ".go", ".rs", ".java", ".kt",
  ".cs", ".rb", ".ex", ".exs", ".md", ".txt", ".toml",
];

/**
 * Ficheros exentos.
 *
 * Solo el propio lint, que enumera los patrones y no puede acusarse a sí
 * mismo.
 *
 * Su spec **no** está exento: compone las credenciales de prueba en
 * tiempo de ejecución, así que en el fichero no hay ninguna cadena que
 * case. Es mejor que una exención — un fichero exento deja de mirarse
 * también para lo que sí importa, y una credencial con forma válida
 * dentro del repositorio la marca cualquier escáner externo. La
 * protección de push de GitHub bloqueó el primer intento por eso mismo,
 * y tenía razón: no puede distinguir la de prueba de una de verdad.
 */
const ALLOWED = new Set(["scripts/gates/lint-secrets.script.ts"]);

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full, out);
    } else if (CHECKED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

interface IFinding {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

/** Enseña lo justo para reconocerlo, sin volver a filtrarlo entero. */
function redact(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…${"*".repeat(6)}…${value.slice(-2)}`;
}

export async function findSecrets(files: ReadonlyArray<string>): Promise<IFinding[]> {
  const findings: IFinding[] = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;

    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      // `lint:secrets ignore` en la propia línea la exime, y obliga a
      // decir por qué al lado.
      if (line.includes("lint:secrets ignore")) continue;

      for (const { name, re } of PROVIDER_PATTERNS) {
        const match = re.exec(line);
        if (match) {
          findings.push({
            file: rel,
            line: i + 1,
            what: `${name}: ${redact(match[0])}`,
          });
        }
      }

      const named = SECRET_NAME_RE.exec(line);
      if (named?.[1] && looksLikeSecret(named[1])) {
        findings.push({
          file: rel,
          line: i + 1,
          what: `valor con pinta de credencial: ${redact(named[1])}`,
        });
      }
    }
  }
  return findings;
}

async function main(): Promise<number> {
  const files = await collect(REPO_ROOT);
  const findings = await findSecrets(files);

  if (findings.length > 0) {
    console.error(`lint:secrets — ${findings.length} posible(s) credencial(es):\n`);
    for (const f of findings) {
      console.error(`  ✗ ${f.file}:${f.line} — ${f.what}`);
    }
    console.error(
      "\n  Si de verdad no es un secreto, añade `lint:secrets ignore` en la\n" +
        "  línea con el motivo al lado. Si lo es: sácalo del código, ponlo en\n" +
        "  una variable de entorno y **rótalo** — ya está en el historial de\n" +
        "  Git aunque lo borres ahora.\n",
    );
    return 1;
  }

  console.log(
    `lint:secrets — ${files.length} ficheros, ninguna credencial ` +
      `(${PROVIDER_PATTERNS.length} formatos de proveedor + heurística de valor)`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
