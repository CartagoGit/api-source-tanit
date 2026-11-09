import ts from "typescript";
import { posix } from "node:path";
import type { IProofInput, IProofPlan, IProofStep } from "../../packages/contracts/interfaces/quality/proof-plan.interface.js";
import { PROOF_JOBS, PROOF_GLOBAL_PREFIXES } from "../../packages/contracts/constants/quality/proof-rules.constant.js";
import { SECTIONS, GLOBAL_PATHS, bestSectionFor, sectionsForFiles, withDependents } from "../gates/sections.constant.js";

const isSpec = (file: string): boolean => /\.(?:spec|test)\.ts$/.test(file);
const isBunSpec = (file: string): boolean => file.startsWith("tests/core/state/sqlite/") || file.startsWith("tests/transport/");

function sectionOf(file: string): string | undefined {
  if (file.startsWith("tests/application-api/") || file.startsWith("tests/core/")) return "core";
  if (file.startsWith("tests/scripts-gates/") || file.startsWith("tests/cli/")) return "cli";
  if (file.startsWith("tests/frameworks/")) return "frameworks";
  if (file.startsWith("tests/contracts/")) return "contracts";
  return bestSectionFor(file)?.name;
}

/** Import, barrel and resource closure. Unknown dynamic readers widen the plan. */
export function createProofPlan(input: IProofInput): IProofPlan {
  const changedFiles = input.changes.map(({ path }) => path).sort();
  const reasons: string[] = [];
  if (input.forceFull) reasons.push("Full proof requested (integration or promotion).");
  if (input.uncertainty) reasons.push(input.uncertainty);
  if (!changedFiles.length) reasons.push("No reliable changed-file scope.");
  for (const change of input.changes) {
    const isDocumentation = change.path.startsWith("docs/") || change.path.endsWith(".md");
    if (change.status !== "M" && !isDocumentation) reasons.push(`Structural change: ${change.path}`);
    if (GLOBAL_PATHS.some(prefix => change.path.startsWith(prefix)) || PROOF_GLOBAL_PREFIXES.some(prefix => change.path.startsWith(prefix))) reasons.push(`Global or measured disk reader: ${change.path}`);
    if (!sectionOf(change.path) && !change.path.startsWith("docs/") && !change.path.endsWith(".md")) reasons.push(`Unclassified path: ${change.path}`);
  }
  const reverse = new Map<string, Set<string>>();
  const uncertainReaders = new Set<string>();
  const add = (dependency: string, reader: string): void => {
    const readers = reverse.get(dependency) ?? new Set<string>(); readers.add(reader); reverse.set(dependency, readers);
  };
  const resolve = (reader: string, specifier: string): string | undefined => {
    const stem = posix.normalize(posix.join(posix.dirname(reader), specifier));
    return [stem, stem.replace(/\.js$/, ".ts"), `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`].find(candidate => candidate in input.files);
  };
  for (const [file, source] of Object.entries(input.files)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      let reference: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) reference = node.moduleSpecifier.text;
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(ast);
        if (["import", "require", "vi.mock", "vi.importActual"].includes(callee)) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) reference = arg.text;
          else uncertainReaders.add(file);
        }
        // Filesystem/process readers can consume resources without import edges.
        if (/(?:readFile|readdir|glob|spawn|exec|Bun\.file)/.test(callee)) uncertainReaders.add(file);
      }
      if (reference?.startsWith(".")) {
        const dependency = resolve(file, reference);
        if (dependency) add(dependency, file); else uncertainReaders.add(file);
      }
      if (ts.isPropertyAssignment(node) && ["templateUrl", "styleUrl", "styleUrls"].includes(node.name.getText(ast))) {
        const values = ts.isArrayLiteralExpression(node.initializer) ? node.initializer.elements : [node.initializer];
        for (const value of values) {
          if (ts.isStringLiteral(value)) {
            const dependency = resolve(file, value.text);
            if (dependency) add(dependency, file); else uncertainReaders.add(file);
          } else uncertainReaders.add(file);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const reached = new Set(changedFiles);
  const queue = [...changedFiles];
  for (const dependency of queue) for (const reader of reverse.get(dependency) ?? []) {
    if (!reached.has(reader)) { reached.add(reader); queue.push(reader); }
  }
  let sections = withDependents(sectionsForFiles(changedFiles));
  const selectedNames = new Set(sections.map(section => section.name));
  // Unmeasured readers within a consuming section force all its specs; all
  // downstream sections already appear through the declared section graph.
  const wideSections = new Set([...uncertainReaders].map(sectionOf).filter((name): name is string => !!name && selectedNames.has(name)));
  if (reached.has("tests/app/setup.ts")) wideSections.add("app");
  const allSpecs = Object.keys(input.files).filter(isSpec);
  const selectedSpecs = new Set(allSpecs.filter(file => reached.has(file) || wideSections.has(sectionOf(file) ?? "")));
  for (const section of sections) {
    if (!allSpecs.some(file => sectionOf(file) === section.name && selectedSpecs.has(file))) {
      for (const file of allSpecs) if (sectionOf(file) === section.name) selectedSpecs.add(file);
    }
  }
  const full = reasons.length > 0;
  if (full) sections = [...SECTIONS];
  const specs = (full ? allSpecs : [...selectedSpecs]).filter(file => !isBunSpec(file)).sort();
  // Source changes retain full coverage because the repository freezes aggregate
  // baselines. Documentation-only changes cannot affect those measurements, so
  // they keep the proposal and integration checks without running unrelated tests.
  const docsOnly = changedFiles.length > 0 && changedFiles.every(file => file.startsWith("docs/") || file.endsWith(".md"));
  const jobs = Object.fromEntries(PROOF_JOBS.map(job => {
    if (job === "affected-tests") return [job, !full && specs.length > 0];
    if (job === "test-coverage" && !full && docsOnly) return [job, false];
    return [job, full || ["lint", "test-coverage", "integration-verifier"].includes(job)];
  }));
  if (!full) {
    jobs.typecheck = sections.length > 0;
    jobs["validate-examples"] = sections.some(section => ["contracts", "core", "frameworks", "cli", "e2e"].includes(section.name));
    jobs["bench-check"] = sections.some(section => ["contracts", "core", "frameworks"].includes(section.name));
    jobs["desktop-tests"] = sections.some(section => ["contracts", "core", "cli", "app"].includes(section.name)) || changedFiles.some(file => file.startsWith("packages/desktop/"));
    jobs["validate-package"] = changedFiles.some(file => file.startsWith("packages/") && !file.startsWith("packages/app/") && !file.startsWith("packages/desktop/"));
  }
  const steps: IProofStep[] = [];
  const step = (id: string, job: string, argv: readonly string[]): void => { if (jobs[job]) steps.push({ id, job, argv }); };
  step("typecheck", "typecheck", ["bun", "run", "typecheck", ...(!full ? sections.map(section => section.name) : [])]);
  step("lint", "lint", ["bun", "run", "lint"]);
  step("affected-tests", "affected-tests", ["bun", "run", "scripts/gates/prove.script.ts", "--affected-tests"]);
  step("coverage", "test-coverage", ["bun", "run", "test:coverage"]);
  // Bun-owned surfaces cannot be omitted from the Vitest coverage job.
  step("sqlite", "test-coverage", ["bun", "run", "test:core:sqlite"]);
  step("transport", "test-coverage", ["bun", "run", "test:core:transport"]);
  step("examples", "validate-examples", ["bun", "run", "validate:examples"]);
  step("bench", "bench-check", ["bun", "run", "bench:check"]);
  step("module-resolution", "bench-check", ["bun", "run", "bench:module-resolution"]);
  step("audit", "security-audit", ["bun", "run", "security:audit"]);
  step("package", "validate-package", ["bun", "run", "validate:package"]);
  step("integration", "integration-verifier", ["bun", "run", "lint:integration-verifier", "--audit"]);
  return { version: 1, base: input.base, head: input.head, mode: full ? "full" : "affected", reasons, changedFiles, sections: sections.map(section => section.name), specs, jobs, steps };
}

/** Execute exact planned argv; fail immediately and preserve the failing status. */
export async function executeProof(plan: IProofPlan, run: (step: IProofStep) => Promise<number>, job?: string): Promise<number> {
  if (job && !(job in plan.jobs)) throw new Error(`Unknown proof job: ${job}`);
  if (job && !plan.jobs[job]) throw new Error(`Proof job is not selected by this plan: ${job}`);
  if (job === "desktop-tests") throw new Error("Desktop proof requires the platform CI executor.");
  for (const step of plan.steps) {
    if (job && step.job !== job) continue;
    const status = await run(step);
    if (status !== 0) return status;
  }
  return 0;
}
