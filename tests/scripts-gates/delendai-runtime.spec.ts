import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fromRoot } from "../../scripts/helpers/root.helper.js";

// Exercise the real launcher against an isolated Git installation, including
// a same-version commit change. No installed DelendAI or network is required.
const probe = `
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'tanit-runtime-'));
const runtime = join(root, 'runtime');
const project = join(root, 'project');
const launcher = join(project, 'scripts/integrations/delendai-runtime.sh');
const git = (...args) => {
 const r = Bun.spawnSync(['git', '-C', runtime, ...args], {env: {...process.env, DELENDAI_AGENT_ID: 'runtime-fixture'}});
 if (r.exitCode !== 0) throw new Error(r.stderr.toString());
 return r.stdout.toString().trim();
};
try {
 await mkdir(join(runtime, 'packages/cli/src'), {recursive:true});
 await mkdir(join(runtime, 'packages/core'), {recursive:true});
 await mkdir(join(project, 'scripts/integrations'), {recursive:true});
 await writeFile(join(runtime, 'packages/cli/src/index.ts'), 'console.log("PINNED_CLI_EXECUTED")');
 await writeFile(join(runtime, 'packages/core/package.json'), JSON.stringify({version:'0.3.0'}));
 git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
 git('add', '.'); git('commit', '-qm', 'fixture');
 const commit = git('rev-parse', 'HEAD');
 await copyFile(process.argv[1], launcher);
 await writeFile(join(project, 'scripts/integrations/delendai-runtime.json'), JSON.stringify({version:'0.3.0',commit}));
 const run = (...args) => {
  const r = Bun.spawnSync(['bash', launcher, ...args], {env: {...process.env, DELENDAI_RUNTIME_DIR:runtime}});
  return {code:r.exitCode, out:r.stdout.toString(), error:r.stderr.toString()};
 };
 const unlinked = run('--verify');
 const verified = run('--link', '--verify');
 const launched = run();
 await writeFile(join(runtime, 'packages/cli/src/index.ts'), 'throw new Error("MUTATED_CLI_EXECUTED")');
 const dirty = run();
 git('add', '.'); git('commit', '-qm', 'same declared version, different code');
 const moved = run();
 console.log(JSON.stringify({unlinked, verified, launched, dirty, moved, commit}));
} finally { await rm(root, {recursive:true,force:true}); }
`;

describe("pinned optional DelendAI runtime", () => {
  test("verifies code identity and plugin resolution before executing", () => {
    const result = spawnSync("bun", ["-e", probe, fromRoot("scripts/integrations/delendai-runtime.sh")], {
      encoding: "utf8", timeout: 30000,
    });
    expect(result.status, result.stderr).toBe(0);
    const data = JSON.parse(result.stdout) as Record<string, { code: number; out: string; error: string }>;
    expect(data.unlinked?.code).toBe(1);
    expect(data.unlinked?.error).toContain("--link");
    expect(data.verified?.code).toBe(0);
    expect(data.verified?.out).toContain("DelendAI 0.3.0");
    expect(data.launched?.code).toBe(0);
    expect(data.launched?.out).toContain("PINNED_CLI_EXECUTED");
    expect(data.dirty?.code).toBe(1);
    expect(data.dirty?.error).toContain("tracked changes");
    expect(data.moved?.code).toBe(1);
    expect(data.moved?.error).toContain("expected commit");
    expect(data.moved?.error).not.toContain("MUTATED_CLI_EXECUTED");
  }, 30000);
});
