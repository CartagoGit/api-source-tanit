import { describe, expect, test } from "vitest";
import { frontmatterProblem } from "../../scripts/gates/lint-proposals.script.js";

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
