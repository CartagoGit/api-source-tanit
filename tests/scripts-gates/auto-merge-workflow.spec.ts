import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromRoot } from "../../scripts/helpers/root.helper.js";

const execute = promisify(execFile);
const workflow = fromRoot(".github", "workflows", "auto-approve.yml");
const probe = `
const workflow = Bun.YAML.parse(await Bun.file(process.argv[1]).text());
const job = workflow.jobs.approve;
const step = job.steps.find(step => step.name === "Activar el auto-merge");
const requests = [];
const github = { graphql: async (query, variables) => {
  requests.push({ query, variables });
  if (process.argv[2] === "rejected") throw new Error("GitHub denied auto-merge");
  return { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { enabledAt: "now" } } } };
}};
const context = { payload: { pull_request: {
  node_id: "PR_verified", head: { sha: "candidate-sha" }, html_url: "https://example.test/pr/1"
}}};
const core = { info() {}, warning() { throw new Error("A rejection must not become a warning"); } };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let error = null;
try { await new AsyncFunction("github", "context", "core", step.with.script)(github, context, core); }
catch (caught) { error = caught.message; }
console.log(JSON.stringify({ requests, error, permissions: job.permissions, condition: job.if, stepCondition: step.if }));
`;

async function run(mode: string) {
  const { stdout } = await execute("bun", ["-e", probe, workflow, mode]);
  return JSON.parse(stdout) as {
    requests: Array<{ query: string; variables: { id: string; head: string } }>;
    error: string | null;
    permissions: Record<string, string>;
    condition: string;
    stepCondition: string;
  };
}

describe("the actual auto-merge workflow", () => {
  test("enables guarded merge commits with write permissions after verified CI", async () => {
    const result = await run("accepted");
    expect(result.error).toBeNull();
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.query).toContain("enablePullRequestAutoMerge");
    expect(result.requests[0]?.query).toContain("expectedHeadOid: $head");
    expect(result.requests[0]?.query).toContain("mergeMethod: MERGE");
    expect(result.requests[0]?.variables).toEqual({ id: "PR_verified", head: "candidate-sha" });
    expect(result.permissions).toMatchObject({ "contents": "write", "pull-requests": "write", "checks": "read" });
    expect(result.condition).toContain("pull_request.user.login");
    expect(result.condition).toContain("pull_request.draft == false");
    expect(result.stepCondition).toBe("steps.wait.outputs.conclusion == 'success'");
  });

  test("propagates GitHub rejection so a successful job cannot hide a stranded PR", async () => {
    const result = await run("rejected");
    expect(result.error).toBe("GitHub denied auto-merge");
  });
});
