/**
 * `buildLanguageIR(source, filename)` — x00048 S3 (a00016 S6.d).
 *
 * Aggregate the LanguageIR with a **single Babel parse per file**.
 *
 * Contexto
 * ────────
 * Los scanners TS-flavored consumen cuatro primitivas del
 * LanguageIR:
 *
 *   - `IRouteCallExpression[]`  — `collectMethodCallsFromSource`
 *   - `IConstantBinding[]`      — `collectConstantsFromSource`
 *   - `IImportBinding[]`        — `collectAliases` (walker interno)
 *   - `IReexport[]`             — `collectReexports` (walker interno)
 *
 * Cada una abría su propio `babelParse()` sobre el mismo fichero:
 * 4 parses por archivo. Con cientos de archivos por proyecto y 6
 * scanners TS, eso son miles de parses redundantes por scan.
 *
 * Este helper parsea una vez y alimenta los walkers AST-level de
 * cada collector (`collectMethodCallsFromProgram`,
 * `collectConstantsFromProgram`, `collectAliasesFromBody`,
 * `collectReexportsFromBody`). La regla de emisión de cada
 * collector sigue viviendo en su módulo — aquí sólo se comparte
 * el AST.
 *
 * Por qué un wrapper fino, no un walker unificado
 * ────────────────────────────────────────────────
 * Cada walker está parametrizado sobre su propio acumulador y
 * sus tests (28+ specs) lo ejercitan en aislamiento con fuentes
 * sintéticas. Fusionarlos perdería esa cobertura sin ganar nada:
 * el beneficio del single-parse es el **AST compartido**, no el
 * walker compartido.
 *
 * Diagnósticos
 * ────────────
 * Si Babel no puede parsear el archivo, el motivo entra en
 * `diagnostics` (si se pasa) y el resultado es un `ILanguageIR`
 * vacío. Mismo contrato de degradación que
 * `collectMethodCallsFromSource` y `parseModule`: sin ruido, sin
 * abortar el scan.
 *
 * Uso
 * ───
 * ```ts
 * const ir = buildLanguageIR(raw, file, diagnostics);
 * const propagated = propagateConstants(ir.calls, ir.bindings);
 * const resolved = resolveCallee(propagated, ir.aliases, ir.reexports);
 * ```
 */
import { parse as babelParse, type ParserPlugin } from "@babel/parser";

import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IImportBinding,
  ILanguageIR,
  IReexport,
} from "../../contracts/interfaces/core/language-ir.interface.js";
import { collectMethodCallsFromProgram } from "./collect-method-calls.helper.js";
import { collectConstantsFromProgram } from "./collect-constants.helper.js";
import { collectAliasesFromBody, collectReexportsFromBody } from "./symbol-resolver.helper.js";

// `ILanguageIR` vive en contracts (r00007); se re-exporta aquí para
// comodidad de los scanners, pero la fuente de verdad es el contrato.
export type { ILanguageIR };

function isJsxFile(filename: string): boolean {
  return /\.(tsx|jsx)$/.test(filename);
}

/**
 * Nodo Babel mínimamente tipado. Estructuralmente compatible con el
 * `BabelNode` interno de los collectors (`type: string` + índice
 * permissivo): se puede pasar a `collectAliasesFromBody` /
 * `collectReexportsFromBody` sin ningún cast.
 *
 * Es el mismo patrón documentado de `symbol-resolver.helper.ts` y
 * `collect-method-calls.helper.ts`: no arrastramos `@babel/types`
 * (~2500 tipos de dependencia); los walkers leen sólo los campos que
 * inspeccionan y el índice permissivo deja el resto en `unknown`.
 */
interface BabelNodeLite {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Cast permisivo de nodo Babel — el mismo patrón documentado de
 * `symbol-resolver.helper.ts` y `collect-method-calls.helper.ts`:
 * no arrastramos `@babel/types` (~2500 tipos de dependencia); los
 * walkers leen sólo los campos que inspeccionan y el índice
 * permissivo deja el resto en `unknown`.
 */
function asNode(value: unknown): BabelNodeLite {
  return value as BabelNodeLite;
}

function asNodeArray(value: unknown): ReadonlyArray<BabelNodeLite> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNodeLite>) : [];
}

/**
 * Parsea `source` una vez y corre los cuatro collectors AST-level
 * sobre el mismo `Program`.
 *
 * La configuración de Babel (plugins `typescript` + `decorators`,
 * `jsx` condicional, `errorRecovery`, `sourceType: module`) es la
 * MISMA que usa `collectMethodCallsFromSource` — el único de los
 * cuatro que históricamente añadía `jsx` por extensión. Los otros
 * three aceptan el mismo superset sin problema: plugins extra no
 * cambian el AST de un fichero que no los usa.
 */
export function buildLanguageIR(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): ILanguageIR {
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  if (isJsxFile(filename)) plugins.push("jsx");

  let program: unknown;
  try {
    const ast = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...plugins],
      errorRecovery: true,
    });
    program = ast.program;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return { calls: [], bindings: [], aliases: [], reexports: [] };
  }

  return buildLanguageIRFromProgram(program, filename);
}

/**
 * Variante AST-level (x00048 S3): toma un `Program` de Babel ya
 * parseado — el que devuelve `parseModuleWithProgram` del frontend —
 * y corre los cuatro collectors sin volver a parsear.
 *
 * Este es el camino del single-parse REAL en los scanners: el
 * frontend parsea una vez (`parseModuleWithProgram`), consume su
 * cuerpo para el `TSFile` (assignments, decorators, classes…) y
 * entrega el mismo `Program` a este helper, que alimenta los
 * walkers del LanguageIR. Un archivo = un parse, punto.
 */
export function buildLanguageIRFromProgram(
  program: unknown,
  filename: string,
): ILanguageIR {
  const prog = asNode(program);
  const body = asNodeArray(prog["body"]);

  return {
    calls: collectMethodCallsFromProgram(prog, filename),
    bindings: collectConstantsFromProgram(prog, filename),
    aliases: runAliasesCollector(body, filename),
    reexports: runReexportsCollector(body, filename),
  };
}

/**
 * `collectAliasesFromBody` recibe `(body, sourceFile, out)` y muta
 * `out`. Este wrapper le da la forma funcional que consume
 * `buildLanguageIR` sin cambiar la firma del collector (sus tests
 * siguen ejercitándolo directamente).
 */
function runAliasesCollector(
  body: ReadonlyArray<BabelNodeLite>,
  filename: string,
): IImportBinding[] {
  const out: IImportBinding[] = [];
  collectAliasesFromBody(body, filename, out);
  return out;
}

/** Análogo a `runAliasesCollector` para reexports. */
function runReexportsCollector(
  body: ReadonlyArray<BabelNodeLite>,
  filename: string,
): IReexport[] {
  const out: IReexport[] = [];
  collectReexportsFromBody(body, filename, out);
  return out;
}