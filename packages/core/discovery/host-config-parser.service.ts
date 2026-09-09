/**
 * `host-config-parser.ts` — AST-only parser for `config.constant.ts`
 * and `endpoints.constant.ts` (x00058).
 *
 * Reads the host project's `config.constant.ts` and `endpoints.constant.ts`
 * WITHOUT executing them. The previous implementation used
 * `await import(\`${url}?t=${Date.now()}\`)` which evaluates arbitrary
 * TypeScript/JavaScript in Tanit's process. For projects we trust
 * (the developer's own repo) that was acceptable; for projects a
 * CI/agent runs against (the increasingly common case — MCP, web UI,
 * third-party repos), it is a security boundary violation.
 *
 * What this parser handles:
 *
 * - `export const config = { … }` (the canonical `ProjectConfig` shape).
 * - `export default { … }` (the second-most common shape; legacy).
 * - `export const projectConfig = { … }` (third alias).
 * - `export const ALL_ENDPOINTS = [ … ]` (manual endpoint overrides).
 * - `export const endpoints = [ … ]` (alias).
 *
 * What it does NOT execute:
 *
 * - `require("fs")`, `import("fs")`, etc.
 * - Function bodies (they're treated as opaque values).
 * - Spread of dynamic values (`{ ...someOtherVar }`).
 * - Template literals with expressions (`` `${foo}` ``).
 * - Imported bindings (`import { x } from "..."` resolves to `undefined`
 *   for `x`, not to the imported value — but if the constant is the
 *   import target itself, the parser surfaces a clear error).
 *
 * The parser is intentionally narrow: any `ProjectConfig` we can
 * support today (a literal object of strings/arrays/objects) goes
 * through. Anything more exotic keeps the explicit
 * `--allow-config-execution` escape hatch.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse as babelParse, type ParserPlugin } from "@babel/parser";
// `@babel/types` exposes the runtime type-guards as named exports.
// We pull in only the ones we use to keep the import surface narrow.
import {
  isArrayExpression,
  isBooleanLiteral,
  isIdentifier,
  isNoop,
  isNullLiteral,
  isNumericLiteral,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  isTemplateLiteral,
  isVariableDeclaration,
} from "@babel/types";
import type {
  File,
  Node,
  ObjectExpression,
  ObjectProperty,
  StringLiteral,
  VariableDeclaration,
} from "@babel/types";

import type { EndpointSpec } from "../../contracts/interfaces/core/endpoint-legacy.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type {
  HostConfigKind,
  HostConfigParseResult,
  IHostConfigDiagnostic,
} from "../../contracts/interfaces/core/host-config.interface.js";

/**
 * Re-export the contract types so existing importers keep working
 * with `import type { … } from "./host-config-parser.service.js"`.
 */
export type { HostConfigKind, HostConfigParseResult, IHostConfigDiagnostic };

const BABEL_PLUGINS: ReadonlyArray<ParserPlugin> = [
  "typescript",
  "decorators-legacy",
  "classProperties",
];

/**
 * Reads `absPath` and parses the host constant. Pure I/O + AST —
 * no execution.
 *
 * - `kind: "project-config"` returns the exported object under one of
 *   `config` / `projectConfig` / `default`.
 * - `kind: "manual-endpoints"` returns the array exported under one of
 *   `ALL_ENDPOINTS` / `endpoints` / `default`.
 */
export async function parseHostConfigFile<T>(
  absPath: string,
  kind: HostConfigKind,
): Promise<HostConfigParseResult<T>> {
  const file = basename(absPath);
  let source: string;
  try {
    source = await readFile(absPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "syntax-error",
          file,
          line: null,
          column: null,
          message:
            err instanceof Error
              ? `Cannot read ${absPath}: ${err.message}`
              : `Cannot read ${absPath}`,
        },
      ],
    };
  }
  return parseHostConfigSource<T>(source, file, kind);
}

/**
 * Pure-AST parse (no I/O). Exposed so tests can hand the parser a
 * literal source string without touching the filesystem.
 */
export function parseHostConfigSource<T>(
  source: string,
  file: string,
  kind: HostConfigKind,
): HostConfigParseResult<T> {
  let program: File;
  try {
    program = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...BABEL_PLUGINS],
      errorRecovery: false,
    });
  } catch (err) {
    const diag = babelErrorToDiagnostic(err, file);
    return { ok: false, diagnostics: [diag] };
  }

  if (kind === "project-config") {
    return parseProjectConfigFromAst(program, file) as HostConfigParseResult<T>;
  }
  return parseManualEndpointsFromAst(program, file) as HostConfigParseResult<T>;
}

// ---------------------------------------------------------------------------
// ProjectConfig parser
// ---------------------------------------------------------------------------

const PROJECT_CONFIG_NAMES = ["config", "projectConfig", "default"] as const;

function parseProjectConfigFromAst(
  program: File,
  file: string,
): HostConfigParseResult<ProjectConfig> {
  for (const name of PROJECT_CONFIG_NAMES) {
    const decl = findNamedExport(program, name);
    if (!decl) continue;
    const declarator = decl.declarations[0];
    if (!declarator || !isIdentifier(declarator.id) || declarator.id.name !== name) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "missing-export",
            file,
            line: decl.loc?.start.line ?? null,
            column: decl.loc?.start.column ?? null,
            message: `Could not bind export '${name}' to a VariableDeclarator.`,
          },
        ],
      };
    }
    if (!declarator.init) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "missing-export",
            file,
            line: decl.loc?.start.line ?? null,
            column: decl.loc?.start.column ?? null,
            message: `Export '${name}' has no initial value.`,
          },
        ],
      };
    }
    if (!isObjectExpression(declarator.init)) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "type-mismatch",
            file,
            line: declarator.init.loc?.start.line ?? null,
            column: declarator.init.loc?.start.column ?? null,
            message: `Export '${name}' must be a literal object (ProjectConfig). Found ${declarator.init.type}.`,
            hint: "Use `--allow-config-execution` to evaluate a computed config.",
          },
        ],
      };
    }
    const value = objectExpressionToValue(declarator.init, file);
    if (!value.ok) {
      return { ok: false, diagnostics: value.diagnostics };
    }
    const cfg = value.value as unknown as ProjectConfig;
    if (
      typeof cfg !== "object" ||
      cfg === null ||
      typeof (cfg as { name?: unknown }).name !== "string"
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "type-mismatch",
            file,
            line: declarator.init.loc?.start.line ?? null,
            column: declarator.init.loc?.start.column ?? null,
            message: `Export '${name}' is not a valid ProjectConfig (missing \`name\`).`,
          },
        ],
      };
    }
    return { ok: true, value: cfg };
  }
  return {
    ok: false,
    diagnostics: [
      {
        kind: "missing-export",
        file,
        line: null,
        column: null,
        message: `No \`config\` / \`projectConfig\` / \`default\` export found.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Manual endpoints parser
// ---------------------------------------------------------------------------

const ENDPOINTS_NAMES = ["ALL_ENDPOINTS", "endpoints", "default"] as const;

function parseManualEndpointsFromAst(
  program: File,
  file: string,
): HostConfigParseResult<EndpointSpec[]> {
  for (const name of ENDPOINTS_NAMES) {
    const decl = findNamedExport(program, name);
    if (!decl) continue;
    const declarator = decl.declarations[0];
    if (!declarator || !isIdentifier(declarator.id) || declarator.id.name !== name) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "missing-export",
            file,
            line: decl.loc?.start.line ?? null,
            column: decl.loc?.start.column ?? null,
            message: `Could not bind export '${name}' to a VariableDeclarator.`,
          },
        ],
      };
    }
    if (!declarator.init || !isArrayExpression(declarator.init)) {
      return {
        ok: false,
        diagnostics: [
          {
            kind: "type-mismatch",
            file,
            line: declarator.init?.loc?.start.line ?? null,
            column: declarator.init?.loc?.start.column ?? null,
            message: `Export '${name}' must be a literal array.`,
          },
        ],
      };
    }
    const elements: unknown[] = [];
    const diagnostics: IHostConfigDiagnostic[] = [];
    for (const el of declarator.init.elements) {
      if (el === null) continue;
      const v = valueToLiteral(el, file);
      if (v.ok) {
        elements.push(v.value);
      } else {
        diagnostics.push(...v.diagnostics);
      }
    }
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }
    return { ok: true, value: elements as EndpointSpec[] };
  }
  return {
    ok: false,
    diagnostics: [
      {
        kind: "missing-export",
        file,
        line: null,
        column: null,
        message: `No \`ALL_ENDPOINTS\` / \`endpoints\` / \`default\` export found.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function findNamedExport(
  program: File,
  name: string,
): VariableDeclaration | null {
  const stmts = (program as unknown as { program: { body: Node[] } }).program.body;
  for (const stmt of stmts) {
    // `export const foo = { ... }`
    if (
      stmt.type === "ExportNamedDeclaration" &&
      isVariableDeclaration((stmt as { declaration: Node }).declaration)
    ) {
      const decl = (stmt as { declaration: VariableDeclaration }).declaration;
      const hit = decl.declarations.find(
        (d: { id: Node }) =>
          isIdentifier(d.id) &&
          (d.id as { name: string }).name === name &&
          ((stmt as { exportKind?: string }).exportKind === "type"
            ? false
            : true),
      );
      if (hit) return decl;
    }
    // `export default { ... }`
    if (stmt.type === "ExportDefaultDeclaration") {
      const declStmt = stmt as { declaration: Node };
      if (
        isObjectExpression(declStmt.declaration) &&
        name === "default"
      ) {
        // Wrap the ObjectExpression in a synthetic VariableDeclaration so
        // the caller's VariableDeclarator extraction logic works.
        const decl = {
          type: "VariableDeclaration",
          declarations: [
            {
              type: "VariableDeclarator",
              id: { type: "Identifier", name: "default" },
              init: declStmt.declaration,
            },
          ],
        } as unknown as VariableDeclaration;
        return decl;
      }
    }
  }
  return null;
}

/**
 * ObjectExpression → JS value (recursive). All children are pure
 * literals; unsupported expressions surface diagnostics instead of
 * being silently dropped.
 */
function objectExpressionToValue(
  node: ObjectExpression,
  file: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; diagnostics: ReadonlyArray<IHostConfigDiagnostic> } {
  const out: Record<string, unknown> = {};
  const diagnostics: IHostConfigDiagnostic[] = [];
  for (const prop of node.properties) {
    if (!isObjectProperty(prop)) {
      diagnostics.push({
        kind: "unsupported-expression",
        file,
        line: prop.loc?.start.line ?? null,
        column: prop.loc?.start.column ?? null,
        message: `Spread / method shorthand in a config object is not supported by the AST parser.`,
        hint: "Use --allow-config-execution to evaluate computed configs.",
      });
      continue;
    }
    const key = propertyKeyToString(prop);
    if (key === null) {
      diagnostics.push({
        kind: "unsupported-expression",
        file,
        line: prop.loc?.start.line ?? null,
        column: prop.loc?.start.column ?? null,
        message: "Computed property keys are not supported.",
      });
      continue;
    }
    const v = valueToLiteral(prop.value, file);
    if (v.ok) {
      out[key] = v.value;
    } else {
      diagnostics.push(...v.diagnostics);
    }
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, value: out };
}

function propertyKeyToString(prop: ObjectProperty): string | null {
  if (isIdentifier(prop.key)) return prop.key.name;
  if (isStringLiteral(prop.key)) return prop.key.value;
  return null;
}

function valueToLiteral(
  node: Node,
  file: string,
):
  | { ok: true; value: unknown }
  | { ok: false; diagnostics: ReadonlyArray<IHostConfigDiagnostic> } {
  if (isStringLiteral(node) || isNoop(node)) {
    return { ok: true, value: (node as StringLiteral).value };
  }
  if (isNumericLiteral(node)) {
    return { ok: true, value: (node as { value: number }).value };
  }
  if (isBooleanLiteral(node)) {
    return { ok: true, value: (node as { value: boolean }).value };
  }
  if (isNullLiteral(node)) {
    return { ok: true, value: null };
  }
  if (isTemplateLiteral(node) && node.expressions.length === 0) {
    const first = node.quasis[0];
    return { ok: true, value: first ? first.value.cooked ?? "" : "" };
  }
  if (isArrayExpression(node)) {
    const elements: unknown[] = [];
    const diagnostics: IHostConfigDiagnostic[] = [];
    for (const el of node.elements) {
      if (el === null) {
        elements.push(null);
        continue;
      }
      const v = valueToLiteral(el, file);
      if (v.ok) {
        elements.push(v.value);
      } else {
        diagnostics.push(...v.diagnostics);
      }
    }
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }
    return { ok: true, value: elements };
  }
  if (isObjectExpression(node)) {
    const v = objectExpressionToValue(node, file);
    if (v.ok) return { ok: true, value: v.value };
    return { ok: false, diagnostics: v.diagnostics };
  }
  if (isIdentifier(node)) {
    // Identifiers resolve to undefined; this is the "I refuse to
    // execute" answer for `import { foo } from "..."`. We surface
    // it as a diagnostic only when the identifier is an imported
    // binding — that's what the security guarantee protects.
    return {
      ok: false,
      diagnostics: [
        {
          kind: "unsupported-expression",
          file,
          line: node.loc?.start.line ?? null,
          column: node.loc?.start.column ?? null,
          message: `Identifier '${node.name}' resolves to undefined (the AST parser does not evaluate imports).`,
          hint: "Inline the literal, or use --allow-config-execution.",
        },
      ],
    };
  }
  return {
    ok: false,
    diagnostics: [
      {
        kind: "unsupported-expression",
        file,
        line: node.loc?.start.line ?? null,
        column: node.loc?.start.column ?? null,
        message: `Expression of type '${node.type}' is not supported by the AST parser.`,
        hint: "Inline a literal, or use --allow-config-execution.",
      },
    ],
  };
}

function babelErrorToDiagnostic(
  err: unknown,
  file: string,
): IHostConfigDiagnostic {
  // @babel/parser errors carry `(line, column)` on the object.
  const anyErr = err as {
    message?: string;
    loc?: { line?: number; column?: number };
    code?: string;
  };
  return {
    kind: "syntax-error",
    file,
    line: anyErr.loc?.line ?? null,
    column: anyErr.loc?.column ?? null,
    message: anyErr.message ?? "Unknown parse error",
  };
}