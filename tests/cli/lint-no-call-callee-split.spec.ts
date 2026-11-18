import { describe, expect, test } from "vitest";

import { main } from "../../scripts/gates/lint-no-call-callee-split.script";

describe("lint:no-call-callee-split", () => {
  test("exit 0 en develop actual (los 22 scanners usan method/receiver, no split)", async () => {
    expect(await main()).toBe(0);
  });
});
