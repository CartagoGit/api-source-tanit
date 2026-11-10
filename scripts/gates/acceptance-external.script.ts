#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, dirname } from "node:path";
import { fromRoot } from "../helpers/root.helper.js";
import { writeJsonAtomic } from "../../packages/core/helpers/atomic-write.helper.js";
import {
  assessClaims, canonicalJson, CorpusCaseSchema, endpointMetrics,
  jsonValue, materializeCorpus, normalizePath, operationKey, postmanOperations,
} from "../helpers/external-corpus.helper.js";
import { isRecord } from "../../packages/core/helpers/parse-json.helper.js";

function argumentsOf(args: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const allowed = new Set(["case", "project-root", "report", "cli-binary", "api-worker", "output-dir"]);
  for (const argument of args) {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match?.[1] || !match[2] || !allowed.has(match[1]) || values[match[1]] !== undefined) throw new Error(`Invalid argument: ${argument}`);
    values[match[1]] = match[2];
  }
  return values;
}
function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value || !isAbsolute(value)) throw new Error(`--${key} must be an absolute path`);
  return value;
}
function run(command: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Tanit process failed: ${result.error?.message ?? result.status}\n${result.stderr.slice(-3000)}`);
  return result.stdout;
}
function controlledEnvironment(work: string): NodeJS.ProcessEnv {
  // Keep the declared agent identity. Only product configuration is isolated.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(POSTMAN_|TANIT_)/.test(key)));
  return { ...env, TANIT_HISTORY_DIR: join(work, "history"), TANIT_LEGACY_HISTORY_FILE: join(work, "no-legacy-history.json"), TZ: "UTC" };
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}`);
  return value;
}
async function artifact(path: string, directory: string): Promise<unknown> {
  const rel = relative(directory, path);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Tanit returned an artifact outside its output directory");
  const raw = await readFile(path, "utf8");
  if (path.endsWith(".json")) return jsonValue(raw);
  if (!path.endsWith(".yaml")) throw new Error("Unsupported acceptance artifact");
  const { parseYamlLite, unsupportedYamlFeatures } = await import("../../packages/frameworks/scanners/openapi.scanner.js");
  if (unsupportedYamlFeatures(raw).length > 0) throw new Error("Generated YAML exceeds the existing parser's supported subset");
  return parseYamlLite(raw);
}

/** The same registered handlers used by browser/desktop bridges; no mock scanner. */
async function apiWorker(args: Record<string, string>): Promise<void> {
  const projectRoot = required(args, "project-root");
  const outputDirectory = required(args, "output-dir");
  const [{ defaultOrchestrator }, { buildRegistry }, { dispatch }, { closeAllSessions }] = await Promise.all([
    import("../../packages/frameworks/framework.registry.js"),
    import("../../packages/core/application-api/handlers.js"),
    import("../../packages/core/application-api/dispatcher.js"),
    import("../../packages/core/session/project-session.service.js"),
  ]);
  const registry = buildRegistry();
  const context = { caller: "browser" as const, orchestrator: defaultOrchestrator() };
  const invoke = async (name: string, input: unknown): Promise<unknown> => {
    const result = await dispatch(registry, name, input, context);
    if (!result.ok) throw new Error(`${name}: ${result.error.code}: ${result.error.message}`);
    return result.value;
  };
  try {
    await invoke("open-project", { projectRoot, watch: false });
    const endpoints: Array<{ method: string; path: string }> = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = object(await invoke("list-endpoints", { projectRoot, limit: 1000, ...(cursor === undefined ? {} : { cursor }) }), "endpoint page");
      if (!Array.isArray(page.endpoints)) throw new Error("Invalid endpoint list");
      for (const row of page.endpoints) {
        const endpoint = object(row, "endpoint");
        if (typeof endpoint.method !== "string" || typeof endpoint.uri !== "string") throw new Error("Invalid endpoint identity");
        endpoints.push({ method: endpoint.method, path: normalizePath(endpoint.uri) });
      }
      if (page.nextCursor !== null && typeof page.nextCursor !== "string") throw new Error("Invalid pagination cursor");
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (cursor !== undefined) {
        if (seen.has(cursor) || seen.size >= 1000) throw new Error("Pagination did not terminate");
        seen.add(cursor);
      }
    } while (cursor !== undefined);
    const paths: Record<string, string> = {};
    for (const target of ["postman", "openapi"]) {
      const exported = object(await invoke("export", { projectRoot, target, outputDirectory }), "export result");
      if (typeof exported.outputPath !== "string") throw new Error("Export returned no artifact");
      paths[target] = exported.outputPath;
    }
    await writeJsonAtomic(required(args, "report"), { endpoints, paths });
  } finally { await closeAllSessions(); }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = argumentsOf(argv);
  if (args["api-worker"] === "true") { await apiWorker(args); return 0; }
  const id = args.case;
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error("--case must name a committed corpus manifest");
  const source = await realpath(required(args, "project-root"));
  const reportPath = required(args, "report");
  const reportDirectory = await realpath(dirname(reportPath));
  const reportRelative = relative(source, reportDirectory);
  if (reportRelative !== ".." && !reportRelative.startsWith("../") && !isAbsolute(reportRelative)) throw new Error("Write acceptance reports outside the third-party input tree");
  const work = await mkdtemp(join(tmpdir(), "tanit-external-acceptance-"));
  try {
  const corpus = CorpusCaseSchema.parse(jsonValue(await readFile(fromRoot("tests", "acceptance", "external-corpus", `${id}.json`), "utf8")));
    const input = join(work, "input"), cliOutput = join(work, "cli"), apiOutput = join(work, "api");
    await materializeCorpus(source, input, corpus);
    const binary = args["cli-binary"];
    if (binary !== undefined) {
      if (!isAbsolute(binary)) throw new Error("--cli-binary must be absolute");
      const rel = relative(source, await realpath(binary));
      if (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)) throw new Error("Do not execute a binary from the third-party project");
    }
    const cli = object(jsonValue(run(binary ?? process.execPath, [
      ...(binary === undefined ? [fromRoot("packages", "cli", "cli.script.ts")] : []),
      "generate", `--project-root=${input}`, `--output-dir=${cliOutput}`, "--formats=postman,openapi", "--json",
    ], controlledEnvironment(join(work, "cli-state")))), "CLI report");
    if (cli.ok !== true || typeof cli.collectionPath !== "string" || !Array.isArray(cli.extraPaths)) throw new Error("CLI returned no successful export");
    const cliOpenapi = cli.extraPaths.find((path): path is string => typeof path === "string" && path.endsWith(".openapi.yaml"));
    if (!cliOpenapi) throw new Error("CLI returned no OpenAPI artifact");
    const workerReport = join(work, "api-result.json");
    run(process.execPath, [fromRoot("scripts", "gates", "acceptance-external.script.ts"), "--api-worker=true", `--project-root=${input}`, `--output-dir=${apiOutput}`, `--report=${workerReport}`], controlledEnvironment(join(work, "api-state")));
    const worker = object(jsonValue(await readFile(workerReport, "utf8")), "API report");
    const paths = object(worker.paths, "API artifact paths");
    if (typeof paths.postman !== "string" || typeof paths.openapi !== "string" || !Array.isArray(worker.endpoints)) throw new Error("API returned incomplete artifacts");
    const [cliCollection, apiCollection, cliContract, apiContract] = await Promise.all([
      artifact(cli.collectionPath, cliOutput), artifact(paths.postman, apiOutput), artifact(cliOpenapi, cliOutput), artifact(paths.openapi, apiOutput),
    ]);
    const expected = corpus.endpoints.map(operationKey);
    const cliOperations = postmanOperations(cliCollection), apiOperations = postmanOperations(apiCollection);
    const listed = worker.endpoints.map((entry) => {
      const endpoint = object(entry, "API listed endpoint");
      if (typeof endpoint.method !== "string" || typeof endpoint.path !== "string") throw new Error("Invalid listed identity");
      return operationKey({ method: endpoint.method, path: endpoint.path });
    });
    const routing = { cli: endpointMetrics(expected, cliOperations.map((item) => item.key)), api: endpointMetrics(expected, listed) };
    const semanticParity = canonicalJson(cliOperations) === canonicalJson(apiOperations);
    const contractsParity = canonicalJson(cliContract) === canonicalJson(apiContract);
    const claims = { cli: assessClaims(corpus, cliCollection, cliContract), api: assessClaims(corpus, apiCollection, apiContract) };
    const allClaims = [...claims.cli.responses, ...claims.api.responses, ...claims.cli.schemas, ...claims.api.schemas];
    const passed = routing.cli.passed && routing.api.passed && semanticParity && contractsParity &&
      [...claims.cli.schemas, ...claims.api.schemas].every((claim) => claim.result !== "incorrect");
    await writeJsonAtomic(reportPath, {
      version: 1, case: id, framework: corpus.framework, repository: corpus.repository, revision: corpus.revision,
      analyzer: { packageVersion: object(jsonValue(await readFile(fromRoot("package.json"), "utf8")), "Tanit manifest").version, cli: binary ?? "source", api: "current source handlers" },
      license: corpus.license, inputScope: corpus.inputScope, verifiedSourceFiles: Object.keys(corpus.sourceFiles).length,
      routing, semanticParity, contractsParity, claims, passed,
      acceptanceScope: "Static route identity and CLI/API semantic parity",
      responseSchemaClaimsComplete: allClaims.length === 0 ? null : allClaims.every((claim) => claim.result === "matched"),
      betaReleaseCertified: false,
      scope: "Static analysis only. Endpoint parity and reviewed claims; unknowns do not certify full schemas, live HTTP behavior or a beta release.",
    });
    console.log(`${id}: ${routing.cli.matched}/${routing.cli.expected} CLI, ${routing.api.matched}/${routing.api.expected} API; semantic parity ${semanticParity}; contract parity ${contractsParity}`);
    return passed ? 0 : 1;
  } catch (error) {
    await writeJsonAtomic(reportPath, { version: 1, case: id, passed: false, status: "execution-error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}
if (import.meta.main) {
  try { process.exit(await main()); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
