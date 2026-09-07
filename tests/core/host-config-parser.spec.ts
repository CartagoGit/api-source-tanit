/**
 * x00058 — AST-only host config parser.
 *
 * Replaces the `await import(\`${url}?t=...\`)` path that executed
 * arbitrary TypeScript code from the host project. The parser walks
 * `ExportNamedDeclaration → VariableDeclaration → {…}` and reads
 * literal objects/arrays without ever invoking a function.
 *
 * These tests pin the security guarantee: a `require("fs")` or any
 * other executable statement in the host file is parsed but never run.
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseHostConfigSource,
  parseHostConfigFile,
} from "../../packages/core/discovery/host-config-parser";

describe("x00058 — host-config-parser (AST, no execution)", () => {
  describe("project-config extraction", () => {
    test("(1) extracts `export const config = { … }`", () => {
      const result = parseHostConfigSource(
        `
          import type { ProjectConfig } from "../../../contracts/interfaces/core/project-config.interface.js";
          export const config: ProjectConfig = {
            name: "example-app",
            collectionName: "Example",
            collectionDescription: "desc",
            baseUrl: "http://localhost",
            variables: [{ key: "k", value: "v", type: "string" }],
            filePrefixes: { "routes/api.php": [] },
            zones: [],
            zoneOrder: [],
            defaultZone: "Other",
            authDescriptions: {},
            loginEndpointName: "Login",
          };
        `,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const value = result.value as { name?: string; variables?: unknown[] };
      expect(value.name).toBe("example-app");
      expect(value.variables).toHaveLength(1);
    });

    test("(2) accepts `export default { … }`", () => {
      const result = parseHostConfigSource(
        `
          export default {
            name: "default-app",
            collectionName: "Default",
            collectionDescription: "d",
            baseUrl: "http://localhost",
            variables: [],
            filePrefixes: {},
            zones: [],
            zoneOrder: [],
            defaultZone: "Other",
            authDescriptions: {},
            loginEndpointName: "Login",
          };
        `,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(true);
    });

    test("(3) accepts `export const projectConfig = { … }` (alias)", () => {
      const result = parseHostConfigSource(
        `
          export const projectConfig = {
            name: "alias-app",
            collectionName: "Alias",
            collectionDescription: "d",
            baseUrl: "http://localhost",
            variables: [],
            filePrefixes: {},
            zones: [],
            zoneOrder: [],
            defaultZone: "Other",
            authDescriptions: {},
            loginEndpointName: "Login",
          };
        `,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(true);
    });

    test("(4) does NOT execute `require(\"fs\").writeFileSync` (security)", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "x00058-"));
      try {
        const malicious = join(tmp, "evil.txt");
        const configPath = join(tmp, "config.constant.ts");
        writeFileSync(
          configPath,
          `
            const fs = require("fs");
            fs.writeFileSync("${malicious}", "PWNED");
            export const config = {
              name: "evil",
              collectionName: "evil",
              collectionDescription: "evil",
              baseUrl: "http://localhost",
              variables: [],
              filePrefixes: {},
              zones: [],
              zoneOrder: [],
              defaultZone: "Other",
              authDescriptions: {},
              loginEndpointName: "Login",
            };
          `,
          "utf8",
        );
        const result = await parseHostConfigFile(configPath, "project-config");
        expect(result.ok).toBe(true);
        // The marker file MUST NOT have been created.
        const fs = await import("node:fs");
        expect(fs.existsSync(malicious)).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    test("(5) does NOT execute `import(\"fs\")` (security)", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "x00058-"));
      try {
        const malicious = join(tmp, "evil2.txt");
        const configPath = join(tmp, "config.constant.ts");
        writeFileSync(
          configPath,
          `
            (async () => {
              const fs = await import("fs");
              fs.writeFileSync("${malicious}", "PWNED");
            })();
            export const config = {
              name: "evil2",
              collectionName: "evil2",
              collectionDescription: "evil2",
              baseUrl: "http://localhost",
              variables: [],
              filePrefixes: {},
              zones: [],
              zoneOrder: [],
              defaultZone: "Other",
              authDescriptions: {},
              loginEndpointName: "Login",
            };
          `,
          "utf8",
        );
        const result = await parseHostConfigFile(configPath, "project-config");
        expect(result.ok).toBe(true);
        const fs = await import("node:fs");
        expect(fs.existsSync(malicious)).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    test("(6) syntax errors surface with line/column diagnostics", () => {
      const result = parseHostConfigSource(
        `export const config = { name: "x", ;;;`,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.kind).toBe("syntax-error");
      expect(result.diagnostics[0]?.line).not.toBeNull();
    });

    test("(7) missing export → diagnostic, not crash", () => {
      const result = parseHostConfigSource(
        `export const somethingElse = { foo: 1 };`,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.kind).toBe("missing-export");
    });

    test("(8) non-object config (string) → diagnostic with hint", () => {
      const result = parseHostConfigSource(
        `export const config = "not an object";`,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.kind).toBe("type-mismatch");
      expect(result.diagnostics[0]?.hint).toContain("--allow-config-execution");
    });

    test("(9) config without `name` → diagnostic", () => {
      const result = parseHostConfigSource(
        `export const config = { foo: 1 };`,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.kind).toBe("type-mismatch");
    });

    test("(10) identifier reference (would-be import) → diagnostic with hint", () => {
      const result = parseHostConfigSource(
        `
          import { other } from "./elsewhere";
          export const config = { name: other, collectionName: "x" };
        `,
        "config.constant.ts",
        "project-config",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics.some((d) =>
        d.kind === "unsupported-expression",
      )).toBe(true);
    });
  });

  describe("manual-endpoints extraction", () => {
    test("(11) extracts `export const ALL_ENDPOINTS = [ … ]`", () => {
      const result = parseHostConfigSource(
        `
          export const ALL_ENDPOINTS = [
            { method: "GET", uri: "/users" },
            { method: "POST", uri: "/orders" },
          ];
        `,
        "endpoints.constant.ts",
        "manual-endpoints",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const value = result.value as Array<{ method: string }>;
      expect(value).toHaveLength(2);
      expect(value[0]?.method).toBe("GET");
    });

    test("(12) `export const endpoints = [ … ]` (alias)", () => {
      const result = parseHostConfigSource(
        `export const endpoints = [{ method: "GET", uri: "/x" }];`,
        "endpoints.constant.ts",
        "manual-endpoints",
      );
      expect(result.ok).toBe(true);
    });

    test("(13) missing export → empty diagnostic, not crash", () => {
      const result = parseHostConfigSource(
        `export const unrelated = 42;`,
        "endpoints.constant.ts",
        "manual-endpoints",
      );
      expect(result.ok).toBe(false);
    });

    test("(14) non-array → diagnostic", () => {
      const result = parseHostConfigSource(
        `export const ALL_ENDPOINTS = "not an array";`,
        "endpoints.constant.ts",
        "manual-endpoints",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.kind).toBe("type-mismatch");
    });
  });
});