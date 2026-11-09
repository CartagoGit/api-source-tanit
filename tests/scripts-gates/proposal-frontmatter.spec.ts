import { describe, expect, test } from "vitest";
import { doneFolderFor, frontmatterProblem, isReachableSha, parseShippedIn } from "../../scripts/gates/lint-proposals.script.js";

describe("proposal frontmatter boundaries", () => {
  test("accepts complete metadata with LF and CRLF", () => {
    for (const newline of ["\n", "\r\n"]) {
      expect(frontmatterProblem(["---", "id: x00001", "---", "# Proposal"].join(newline))).toBeNull();
    }
  });

  test("rejects a body heading before the closing delimiter", () => {
    expect(frontmatterProblem("---\nid: x00001\n# Proposal\n\n---\n"))
      .toContain("antes del cuerpo");
  });

  test("rejects absent opening and closing delimiters", () => {
    expect(frontmatterProblem("# Proposal")).toContain("inicial");
    expect(frontmatterProblem("---\nid: x00001\n")).toContain("cierre");
  });
});

describe("proposal shipped-in frontmatter", () => {
  test("reads the canonical inline list emitted by DelendAI 0.3", () => {
    const frontmatter = [
      "---",
      'id: x00090',
      'status: done',
      'shipped-in: [b8c341a1d28f9e4]',
      '---',
    ].join("\n");
    expect(parseShippedIn(frontmatter)).toEqual(["b8c341a1d28f9e4"]);
  });

  test("reads canonical block lists with comments and legacy camelCase block and inline lists", () => {
    const quotedSha = "b8c3410123456789012345678901234567890123";
    const canonical = ["---", "shipped-in:", "  - abcdef012345 # first", "  - 0123456789ab", `  - "${quotedSha}"`, "---"].join("\n");
    const legacyInline = ["---", "shippedIn: [abcdef012345, 0123456789ab]", "---"].join("\n");
    const legacyBlock = ["---", "shippedIn:", "  - abcdef012345", "  - 0123456789ab", "---"].join("\n");
    expect(parseShippedIn(canonical)).toEqual(["abcdef012345", "0123456789ab", quotedSha]);
    expect(parseShippedIn(legacyInline)).toEqual(["abcdef012345", "0123456789ab"]);
    expect(parseShippedIn(legacyBlock)).toEqual(["abcdef012345", "0123456789ab"]);
  });

  test("keeps missing and malformed SHA metadata fail-closed", async () => {
    expect(parseShippedIn("---\nid: x00090\n---")).toEqual([]);
    const malformed = parseShippedIn("---\nshipped-in: [abcdef012345, not-a-sha]\n---");
    expect(malformed).toEqual(["abcdef012345", "not-a-sha"]);
    expect(await isReachableSha(malformed[1]!)).toBe(false);
  });
});

describe("proposal storage matches DelendAI reconciliation", () => {
  test("uses the stable id family when historical semantic kind differs", () => {
    expect(doneFolderFor("x12345", "chore")).toBe("done/fixes");
    expect(doneFolderFor("f12345", "fix")).toBe("done/feats");
  });
  test("keeps the recorded kind for legacy ids", () => {
    expect(doneFolderFor("p12345", "chore")).toBe("done/chores");
  });
});
