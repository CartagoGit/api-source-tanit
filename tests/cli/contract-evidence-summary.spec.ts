import { describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../packages/cli/commands/summary.script.js";
import { isRecord, parseJson } from "../../packages/core/helpers/parse-json.helper.js";
import { ContractEvidenceReportSchema } from "../../packages/contracts/constants/core/contract-evidence.constant.js";

describe("CLI presentation of shared documentation evidence", () => {
  test("text and JSON preserve raw document/code observations from the actual pipeline", async () => {
    const root = await mkdtemp(join(tmpdir(), "tanit-cli-evidence-"));
    const original = [...process.argv];
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await writeFile(join(root, "package.json"), '{"name":"evidence","dependencies":{"express":"4"}}');
      await writeFile(join(root, "main.js"), "const express=require('express'); const app=express(); app.get('/observed', (req,res)=>res.json({ok:true}));");
      await writeFile(join(root, "openapi.json"), '{"openapi":"3.0.3","info":{"title":"Original","version":"1"},"paths":{"/documented":{"get":{"description":"Original documentation","responses":{"200":{"description":"OK"}}}}}}');
      process.argv = ["bun", "summary", "--project-root", root, "--format", "text", "--no-history"];
      expect(await main()).toBe(0);
      const text = output.mock.calls.map(call => String(call[0])).join("\n");
      expect(text).toContain("Documentation/code"); expect(text).toContain("unknown is not absence");
      expect(text).toContain("[unknown] GET /documented"); expect(text).toContain("[unknown] GET /observed");
      expect(text).toContain("openapi.json"); expect(text).toContain("main.js");
      output.mockClear(); process.argv = ["bun", "summary", "--project-root", root, "--format", "json", "--no-history"];
      expect(await main()).toBe(0);
      const parsed = parseJson(output.mock.calls.map(call => String(call[0])).join("\n"));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.reason);
      if (!isRecord(parsed.value) || !Array.isArray(parsed.value.contractEvidence)) throw new Error("Missing shared contract report");
      const report = ContractEvidenceReportSchema.parse(parsed.value.contractEvidence[0]);
      expect(report.operations.map(operation => [operation.method, operation.path, operation.status])).toEqual([["GET", "/documented", "unknown"], ["GET", "/observed", "unknown"]]);
    } finally { process.argv = original; output.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });
});
