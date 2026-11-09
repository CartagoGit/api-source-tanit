import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readHistory, appendHistory, clearHistory } from "../../packages/core/session/history-run.service.js";
import { projectHistoryDirectory } from "../../packages/core/session/history-paths.helper.js";
import { ProjectHistoryService } from "../../packages/core/session/project-history.service.js";
import { runGenerate } from "../../packages/cli/commands/generate.script.js";
import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { exampleDir } from "../../scripts/helpers/root.helper.js";
import { copyExampleClean } from "../helpers/fixtures.js";
import { closeAllSessions } from "../../packages/core/session/project-session.service.js";

let work = "";
beforeEach(async () => { work = await mkdtemp(join(tmpdir(), "tanit-history-authority-")); });
afterEach(async () => { closeAllSessions(); await rm(work, { recursive: true, force: true }); });

async function generate() {
  const root = join(work, "project");
  await copyExampleClean(exampleDir("express"), root);
  const result = await runGenerate(["--project-root", root, "--output-dir", join(work, "exports")]);
  expect(result.code).toBe(0);
  return root;
}

describe("one persisted history across clients", () => {
  test("CLI generation is visible through the Application API and a fresh CLI reader", async () => {
    const root = await generate();
    const records = await new ProjectHistoryService().summaries(root);
    const cli = await readHistory({ projectRoot: root });
    expect(records).toHaveLength(1);
    expect(cli.entries).toHaveLength(1);
    expect(cli.entries[0]?.endpoints).toBe(records[0]?.count);
    expect(cli.entries[0]?.collectionPath).toBe(records[0]?.output);
    const response = await dispatch(buildRegistry(), "history-list", { projectRoot: root }, { caller: "browser", orchestrator: defaultOrchestrator() });
    expect(response).toMatchObject({ ok: true, value: { entries: [{ id: records[0]!.id, count: cli.entries[0]!.endpoints, snapshotAvailable: true }] } });
  });

  test("legacy runs migrate once, preserve duplicates and cannot pretend to be restorable", async () => {
    const root = await generate();
    const entry = (await readHistory({ projectRoot: root })).entries[0]!;
    const legacy = process.env["TANIT_LEGACY_HISTORY_FILE"]!;
    const text = `${JSON.stringify(entry)}\n${JSON.stringify(entry)}\n{broken\n`;
    await writeFile(legacy, text);
    const first = await readHistory({ projectRoot: root });
    const second = await readHistory({ projectRoot: root });
    expect(first.entries).toHaveLength(3);
    expect(second.entries).toHaveLength(3);
    expect(second.rejected).toHaveLength(1);
    expect(await readFile(legacy, "utf8")).toBe(text);
    const summary = await new ProjectHistoryService().summaries(root);
    const metadata = summary.filter(item => item.snapshotAvailable === false);
    expect(metadata).toHaveLength(2);
    expect(metadata.every(item => item.sha256 === null && item.source === "legacy")).toBe(true);
    expect(await new ProjectHistoryService().snapshotOf(root, metadata[0]!.id)).toBeUndefined();
    await expect(dispatch(buildRegistry(), "history-re-export", { projectRoot: root, historyId: metadata[0]!.id }, { caller: "browser", orchestrator: defaultOrchestrator() })).resolves.toMatchObject({ ok: false, error: { code: "HISTORY_SNAPSHOT_UNAVAILABLE" } });
  });

  test("summary writes and explicit clear are shared by CLI and application", async () => {
    const root = await generate();
    const entry = (await readHistory({ projectRoot: root })).entries[0]!;
    expect((await appendHistory({ kind: "summary", projectRoot: root, summary: entry.summary })).ok).toBe(true);
    expect(await new ProjectHistoryService().summaries(root)).toHaveLength(2);
    const unrelated = join(process.env["TANIT_HISTORY_DIR"]!, "keep.txt");
    const projectNote = join(projectHistoryDirectory(root, process.env["TANIT_HISTORY_DIR"]!), "notes.json");
    await writeFile(unrelated, "unrelated");
    await writeFile(projectNote, "project notes");
    expect(await clearHistory()).toBe(true);
    expect(await readFile(unrelated, "utf8")).toBe("unrelated");
    expect(await readFile(projectNote, "utf8")).toBe("project notes");
    expect((await readHistory()).entries).toHaveLength(0);
    expect(await new ProjectHistoryService().summaries(root)).toHaveLength(0);
    expect(await clearHistory()).toBe(false);
  });

  test("two outputs from one snapshot remain distinct records with the same source hash", async () => {
    const root = await generate();
    const history = new ProjectHistoryService();
    const original = (await history.list(root))[0]!;
    const snapshot = (await history.snapshotOf(root, original.id))!;
    const next = await history.record(root, snapshot, { source: "export", formats: ["openapi"], output: join(work, "schema.json") });
    expect(next.id).not.toBe(original.id);
    expect(next.sha256).toBe(original.sha256);
    expect(await history.list(root)).toHaveLength(2);
  });
});
