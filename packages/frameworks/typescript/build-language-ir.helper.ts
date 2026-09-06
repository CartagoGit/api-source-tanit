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
  IConstantBinding,
  IImportBinding,
  IReexport,
  IRouteCallExpression,
} from "../../contracts/interfaces/core/language-ir.interface.js";
import { collectMethodCallsFromProgram } from "./collect-method-calls.helper.js";
import { collectConstantsFromProgram } from "./collect-constants.helper.js";
import { collectAliasesFromBody, collectReexportsFromBody } from "./symbol-resolver.helper.js";

/** Resultado del parse único: las cuatro primitivas del LanguageIR. */
export interface ILanguageIR {
  /** Multi-style route calls (`app.get`, `this.router.get`, `app[M]`…). */
  readonly calls: ReadonlyArray<IRouteCallExpression>;
  /** `const X = <literal>` bindings for constant propagation. */
  readonly bindings: ReadonlyArray<IConstantBinding>;
  /** Import aliases with `importedName` (x00048 S1). */
  readonly aliases: ReadonlyArray<IImportBinding>;
  /** `export { x } from "./y"` reexports. */
  readonly reexports: ReadonlyArray<IReexport>;
}

function isJsxFile(filename: string): boolean {
  return /\.[jt]sx$/.test(filename);
}

interface BabelNodeLite {
  readonly [key: string]: unknown;
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
  const prog = program as BabelNodeLite;
  const body = Array.isArray(prog["body"]) ? (prog["body"] as never[]) : [];

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
  body: ReadonlyArray<never>,
  filename: string,
): IImportBinding[] {
  const out: IImportBinding[] = [];
  collectAliasesFromBody(body, filename, out);
  return out;
}

/** Análogo a `runAliasesCollector` para reexports. */
function runReexportsCollector(
  body: ReadonlyArray<never>,
  filename: string,
): IReexport[] {
  const out: IReexport[] = [];
  collectReexportsFromBody(body, filename, out);
  return out;
}