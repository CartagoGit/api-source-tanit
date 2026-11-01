/**
 * x00064 — `runWithConcurrency()` preserves input order with
 * bounded parallelism.
 */
import { describe, expect, test } from "vitest";
import { runWithConcurrency } from "../../packages/core/helpers/concurrency.helper";

describe("x00064 — runWithConcurrency", () => {
  test("(1) preserves input order regardless of task duration", async () => {
    const tasks = [
      async () => {
        await new Promise<void>((r) => setTimeout(() => r(), 30));
        return "a";
      },
      async () => "b",
      async () => {
        await new Promise<void>((r) => setTimeout(() => r(), 5));
        return "c";
      },
      async () => "d",
    ];
    const out = await runWithConcurrency(tasks, 4);
    expect(out).toEqual(["a", "b", "c", "d"]);
  });

  test("(2) respects the in-flight cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(() => r(), 10));
      inFlight--;
      return i;
    });
    await runWithConcurrency(tasks, 4);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  test("(3) empty input → empty output", async () => {
    const out = await runWithConcurrency([], 8);
    expect(out).toEqual([]);
  });

  test("(4) single task returns single-element array", async () => {
    const out = await runWithConcurrency([async () => 42], 8);
    expect(out).toEqual([42]);
  });

  test("(5) errors propagate from the failing task", async () => {
    const tasks = [
      async () => "ok",
      async () => {
        throw new Error("boom");
      },
      async () => "after",
    ];
    await expect(runWithConcurrency(tasks, 4)).rejects.toThrow("boom");
  });

  test("(6) limit=0 or negative is treated as 1 (sequential)", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const tasks = Array.from({ length: 4 }, () => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(() => r(), 5));
      inFlight--;
    });
    await runWithConcurrency(tasks, 0);
    expect(maxInFlight).toBe(1);
  });
});