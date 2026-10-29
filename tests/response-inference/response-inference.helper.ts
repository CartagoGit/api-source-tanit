/**
 * Shared doubles for the response-inference specs (proposal `r00020`
 * S3).
 *
 * Every inferrer of this slice is exercised the same way: read a
 * **real fixture** of the framework, hand the inferrer the route the
 * scanner would have produced, and check what it answers. The
 * fixtures live in `tests/fixtures/<framework>-responses/` and are
 * the same files the scanners read, so the specs do not describe a
 * framework the repo does not analyse.
 *
 * The helper exists so the eight specs do not repeat the same twenty
 * lines of path arithmetic. It is a **test** helper: it lives with
 * the specs that use it and it is not published.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { moduleDir } from "../../packages/core/helpers/module-path.helper.js";
import type {
  IResponseInferContext,
  IResponseRoute,
} from "../../packages/contracts/interfaces/core/response-inferrer.interface.js";
import type {
  IFrameworkSourceFileLike,
  IResponseSchema,
} from "../../packages/contracts/interfaces/core/responses.interface.js";

/** The root of the repository's fixtures. */
const FIXTURES = join(moduleDir(import.meta.url), "..", "fixtures");

/**
 * The directory of a fixture.
 */
export function fixtureDir(fixture: string): string {
  return join(FIXTURES, fixture);
}

/**
 * Reads a file of a fixture, by its path relative to the fixture.
 */
export function readFixture(fixture: string, relativePath: string): string {
  return readFileSync(join(FIXTURES, fixture, relativePath), "utf8");
}

/**
 * The route the scanner would have produced for a declaration.
 *
 * The fields are the ones `ParsedRoute` carries and the inferrers
 * read: the method, the URI with its prefixes, the URI as the code
 * declares it, the file and the line.
 */
export function routeOf(init: {
  readonly method: string;
  readonly uri: string;
  readonly rawUri?: string;
  readonly sourceFile?: string;
  readonly lineNumber?: number;
  readonly controllerClass?: string;
  readonly actionName?: string;
}): IResponseRoute {
  return {
    method: init.method,
    uri: init.uri,
    ...(init.rawUri === undefined ? {} : { rawUri: init.rawUri }),
    ...(init.sourceFile === undefined ? {} : { sourceFile: init.sourceFile }),
    ...(init.lineNumber === undefined ? {} : { lineNumber: init.lineNumber }),
    ...(init.controllerClass === undefined
      ? {}
      : { controllerClass: init.controllerClass }),
    ...(init.actionName === undefined ? {} : { actionName: init.actionName }),
  };
}

/**
 * The context of an inferrer that reads a fixture.
 *
 * `readSource` resolves paths **inside the fixture**, which is how the
 * Rails and Laravel inferrers reach their controller: the route is
 * declared in `routes.rb` and the response is rendered in another
 * file of the same project.
 */
export function contextOf(
  fixture: string,
  framework: string,
  relativePath: string,
): IResponseInferContext {
  const root = fixtureDir(fixture);
  return {
    framework,
    source: {
      path: join(root, relativePath),
      content: readFileSync(join(root, relativePath), "utf8"),
      framework,
    },
    readSource: (candidate: string): IFrameworkSourceFileLike | null => {
      try {
        return {
          path: join(root, candidate),
          content: readFileSync(join(root, candidate), "utf8"),
          framework,
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * The context of an inferrer that reads a snippet of source code.
 *
 * Used by the edge-case tests, whose subject is a shape no fixture
 * needs to hold.
 */
export function contextOfSource(
  framework: string,
  content: string,
  relativePath = "src/routes.ts",
): IResponseInferContext {
  return {
    framework,
    source: {
      path: relativePath,
      content,
      framework,
    },
  };
}

/**
 * The line (1-based) of the first line of `content` that contains
 * `needle`.
 *
 * The fixtures are real files with real line numbers, and a spec that
 * says "the route declared at line 7" is a spec that breaks when the
 * fixture grows. Reading the line from the file keeps the two in
 * sync.
 */
export function lineOf(content: string, needle: string): number {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 0 : index + 1;
}

/**
 * The fields of a structural schema, as the graph declares them.
 *
 * A schema-graph is a map of nodes and a root id; the fields of the
 * response are the **children of the root**. The helper returns them
 * with the name and whether they are required, which is what the
 * specs assert on.
 */
export function fieldsOf(
  schema: IResponseSchema | undefined,
): ReadonlyArray<{ readonly name: string; readonly required: boolean }> {
  if (schema === undefined || schema.kind !== "schema-graph") return [];
  const root = schema.graph.nodes.get(schema.graph.root);
  return (root?.children ?? []).map((child) => ({
    name: child.name,
    required: child.required === true,
  }));
}
