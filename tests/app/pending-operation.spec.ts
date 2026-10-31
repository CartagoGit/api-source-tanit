/**
 * The pending operations have to leave a trace.
 *
 * A call that cannot work — one whose handler does not exist yet —
 * used to reject with nothing catching it: the screen kept the
 * message it had, which was none, and the user pressed a button and
 * nothing happened. These tests pin the behaviour that replaced it.
 */
import { describe, expect, test } from "vitest";

import { describePending } from "../../packages/app/src/app/core/api/pending-operation.helper";

describe("describePending", () => {
  test("names the CLI command that does what the handler does not", () => {
    const message = describePending("check", new Error("UNKNOWN_HANDLER"));

    expect(message).toContain("CLI-only");
    expect(message).toContain("apisrc check --project-root <path>");
  });

  test("keeps the carrier's own words, so the failure is not hidden", () => {
    const message = describePending("validate", new Error("the session is gone"));

    expect(message).toContain("the session is gone");
    expect(message).toContain("apisrc validate --project-root <path>");
  });

  test("says it is not available yet when no CLI command does it", () => {
    const message = describePending("service-detail", new Error("UNKNOWN_HANDLER"));

    expect(message).toContain("not available in the app yet");
    expect(message).not.toContain("apisrc");
  });

  test("does not invent a reason when the carrier gave none", () => {
    const message = describePending("push", undefined);

    expect(message).toContain("CLI-only");
    expect(message).toContain("apisrc push --project-root <path> --workspace <id>");
    expect(message).not.toContain("undefined");
  });
});
