import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fromRoot } from "../../scripts/helpers/root.helper.js";

// Exercise the real verifier against isolated installs: a plain stable install
// (no Git) checked by version, and a Git checkout held to the pinned commit.
// No installed DelendAI or network is required.
const probe = `
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'tanit-runtime-'));
const stable = join(root, 'stable');
const runtime = join(root, 'runtime');
const project = join(root, 'project');
const verifier = join(project, 'scripts/integrations/delendai-runtime.sh');
const git = (...args) => {
 const r = Bun.spawnSync(['git', '-C', runtime, ...args], {env: {...process.env, DELENDAI_AGENT_ID: 'runtime-fixture'}});
 if (r.exitCode !== 0) throw new Error(r.stderr.toString());
 return r.stdout.toString().trim();
};
const install = async (dir, version) => {
 await mkdir(join(dir, 'packages/core'), {recursive:true});
 await writeFile(join(dir, 'packages/core/package.json'), JSON.stringify({version}));
};
try {
 await install(runtime, '0.3.0');
 await writeFile(join(runtime, 'packages/core/index.js'), 'export {}');
 git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
 git('add', '.'); git('commit', '-qm', 'fixture');
 const commit = git('rev-parse', 'HEAD');
 await mkdir(join(project, 'scripts/integrations'), {recursive:true});
 await copyFile(process.argv[1], verifier);
 await writeFile(join(project, 'scripts/integrations/delendai-runtime.json'), JSON.stringify({version:'0.3.0',commit}));
 const run = (dir, ...args) => {
  const r = Bun.spawnSync(['bash', verifier, ...args], {env: {...process.env, DELENDAI_RUNTIME_DIR:dir}});
  return {code:r.exitCode, out:r.stdout.toString(), error:r.stderr.toString()};
 };
 const missing = run(stable, '--verify');
 await install(stable, '0.3.0');
 const unlinked = run(stable, '--verify');
 const stableVerified = run(stable, '--link', '--verify');
 const unknown = run(stable, '--serve');
 const verified = run(runtime, '--link', '--verify');
 await writeFile(join(runtime, 'packages/core/index.js'), 'export const mutated = true');
 const dirty = run(runtime, '--verify');
 git('add', '.'); git('commit', '-qm', 'same declared version, different code');
 const moved = run(runtime, '--verify');
 await install(stable, '0.4.0');
 const mismatch = run(stable, '--verify');
 console.log(JSON.stringify({missing, unlinked, stableVerified, unknown, verified, dirty, moved, mismatch, commit}));
} finally { await rm(root, {recursive:true,force:true}); }
`;

describe("pinned optional DelendAI runtime", () => {
  test("verifies the install identity and plugin resolution", () => {
    const result = spawnSync("bun", ["-e", probe, fromRoot("scripts/integrations/delendai-runtime.sh")], {
      encoding: "utf8", timeout: 30000,
    });
    expect(result.status, result.stderr).toBe(0);
    const data = JSON.parse(result.stdout) as Record<string, { code: number; out: string; error: string }> & { commit: string };
    expect(data.missing?.code).toBe(1);
    expect(data.missing?.error).toContain("runtime missing");
    expect(data.unlinked?.code).toBe(1);
    expect(data.unlinked?.error).toContain("--link");
    expect(data.stableVerified?.code).toBe(0);
    expect(data.stableVerified?.out.trim()).toBe("DelendAI 0.3.0");
    expect(data.unknown?.code).toBe(1);
    expect(data.unknown?.error).toContain("unknown argument");
    expect(data.verified?.code).toBe(0);
    expect(data.verified?.out.trim()).toBe(`DelendAI 0.3.0 ${data.commit}`);
    expect(data.dirty?.code).toBe(1);
    expect(data.dirty?.error).toContain("tracked changes");
    expect(data.moved?.code).toBe(1);
    expect(data.moved?.error).toContain("expected commit");
    expect(data.mismatch?.code).toBe(1);
    expect(data.mismatch?.error).toContain("core version differs");
  }, 30000);
});
