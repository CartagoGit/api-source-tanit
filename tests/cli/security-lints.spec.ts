/**
 * The two security gates.
 *
 * A security lint that finds nothing is indistinguishable from a
 * broken one — and both go green. That is why what is tested here is
 * not that they pass on the repo (that is what `bun run lint` does),
 * but that they **catch** what they say they catch and that they
 * **do not flag** what is not.
 *
 * The second matters as much as the first: the fixtures in this repo
 * are fake API projects, full of `password` and `token` on purpose.
 * A lint that flagged them would be noise, and a noisy lint ends up
 * disabled.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findSecrets } from "../../scripts/gates/lint-secrets.script";
import { findSastIssues } from "../../scripts/gates/lint-sast.script";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "security-lints-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * Test credentials are **assembled at runtime**.
 *
 * They must carry the real shape so the lint recognises them, but if
 * the full literal were written in this file it would be a valid-
 * shaped credential inside the repository. GitHub's push protection
 * blocked the first attempt for exactly that — and was right: a
 * scanner cannot tell yours from a real one.
 *
 * Splitting them in half, the file contains no matching string, and
 * the temp file written below does. That is where the lint has to
 * catch it.
 */
const SAMPLES = {
  postman: "PMAK-" + "65a1b2c3d4e5f60718293a4b" + "abc123def456789012345678",
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  github: "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789",
  slack: "xox" + "b-123456789012-abcdefghijklmnop",
  privateKey: "-----BEGIN " + "RSA PRIVATE KEY-----",
  urlCreds: "postgres://admin:" + "s3cr3tPass" + "@db.example.com/x",
  realistic: "Xk9$" + "mQ2pLw7#nR4tYb8Zc1Vd",
} as const;

/** Writes a temporary file and returns its path. */
async function fixture(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("lint:secrets catches real credentials", () => {
  test.each([
    ["Postman key", SAMPLES.postman],
    ["AWS key", SAMPLES.aws],
    ["GitHub token", SAMPLES.github],
    ["Slack token", SAMPLES.slack],
    ["private key", SAMPLES.privateKey],
    ["URL with credentials", SAMPLES.urlCreds],
  ])("%s", async (name, value) => {
    const path = await fixture(`${name.replace(/\s+/g, "-")}.ts`, `const k = "${value}";`);
    const found = await findSecrets([path]);
    expect(found.length, `did not catch: ${name}`).toBeGreaterThan(0);
  });

  test("an assignment with a value that looks real", async () => {
    const path = await fixture(
      "assignment.ts",
      `const config = { apiKey: "${SAMPLES.realistic}" };`,
    );
    expect((await findSecrets([path])).length).toBeGreaterThan(0);
  });

  // The value is not leaked whole in the error message, which would
  // end up in the CI output.
  test("the finding comes out redacted, not in the clear", async () => {
    const path = await fixture("redaction.ts", `const secret = "${SAMPLES.realistic}";`);
    const found = await findSecrets([path]);
    expect(found[0]?.what).toContain("*");
    expect(found[0]?.what).not.toContain(SAMPLES.realistic);
  });
});

describe("lint:secrets does NOT flag what is not a secret", () => {
  test.each([
    ["a placeholder", 'const apiKey = "your-api-key-here";'],
    ["an environment variable", 'const token = process.env["POSTMAN_API_KEY"];'],
    ["a Postman template", 'const token = "{{token}}";'],
    ["a fixture value", 'password = "fake"'],
    ["a phrase", 'const secret = "la contraseña va en el entorno";'],
    ["an example field", '{"password": "changeme"}'],
    ["a short value", 'const token = "abc123";'],
    ["the variable name", 'const password = "password";'],
  ])("%s", async (name, code) => {
    const path = await fixture(`ok-${name.replace(/\s+/g, "-")}.ts`, code);
    expect(await findSecrets([path]), code).toEqual([]);
  });

  test("`lint:secrets ignore` exempts the line", async () => {
    const path = await fixture(
      "exempted.ts",
      `const k = "${SAMPLES.aws}"; // lint:secrets ignore — from AWS docs`,
    );
    expect(await findSecrets([path])).toEqual([]);
  });
});

describe("lint:sast catches dangerous patterns", () => {
  test.each([
    ["eval", "const r = eval(sourceFromScannedProject);"],
    ["new Function", "const f = new Function(userInput);"],
    ["exec with interpolation", "execSync(`git log ${projectRoot}`);"],
    ["exec with concatenation", 'execSync("ls " + projectRoot);'],
    ["env dump", "log(JSON.stringify(process.env));"],
    ["key in log", "console.log(`key: ${apiKey}`);"],
  ])("%s", async (name, code) => {
    const path = await fixture(`sast-${name.replace(/\s+/g, "-")}.ts`, code);
    const found = await findSastIssues([path]);
    expect(found.length, `did not catch: ${code}`).toBeGreaterThan(0);
  });

  test("each finding explains the why and the fix", async () => {
    const path = await fixture("sast-explains.ts", "const r = eval(x);");
    const found = await findSastIssues([path]);
    expect(found[0]?.rule.why.length).toBeGreaterThan(20);
    expect(found[0]?.rule.fix.length).toBeGreaterThan(10);
  });
});

describe("lint:sast does NOT flag what is safe", () => {
  test.each([
    ["spawnSync with array", 'spawnSync(bunBin, ["run", script], { cwd });'],
    ["exec without interpolation", 'execSync("command -v bun");'],
    ["a concrete environment variable", 'const key = process.env["POSTMAN_API_KEY"];'],
    // Naming the variable in help text is not printing its value.
    ["the key name in help", 'console.error("  POSTMAN_API_KEY=<key> expostman push");'],
    ["a comment that mentions eval", "// never use eval( here"],
  ])("%s", async (name, code) => {
    const path = await fixture(`sast-ok-${name.replace(/\s+/g, "-")}.ts`, code);
    expect(await findSastIssues([path]), code).toEqual([]);
  });

  test("`lint:sast ignore` exempts the line", async () => {
    const path = await fixture(
      "sast-exempted.ts",
      "const r = eval(x); // lint:sast ignore — value is a constant from the repo itself",
    );
    expect(await findSastIssues([path])).toEqual([]);
  });
});
