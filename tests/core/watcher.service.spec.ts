/**
 * The file watcher.
 *
 * The test that matters most in this file is the one for the output
 * folder. The tool **writes inside what it watches**: the collection
 * goes to `<project>/export-to-postman/`, which hangs from the watched
 * root. A watcher that does not ignore it sees its own write,
 * regenerates, writes, sees itself again — and never stops. It is the
 * same shape of infinite loop that took down an entire WSL session in
 * this repo.
 */
import { describe, expect, test, vi } from "vitest";

import { createDebouncer, shouldIgnore } from "../../packages/core/domain/watcher.service";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { DEFAULT_DEBOUNCE_MS } from "../../packages/contracts/constants/core/runtime-limits.constant";
import { IGNORED_DIRS } from "../../packages/contracts/constants/core/watch.constant";

describe("shouldIgnore", () => {
  // THE test. Without this, the watcher feeds itself.
  test("the output folder is ignored, which is what prevents the loop", () => {
    expect(shouldIgnore(`${OUTPUT_DIR_NAME}/api.postman_collection.json`)).toBe(true);
  });

  test("and also nested inside the project", () => {
    expect(shouldIgnore(`packages/api/${OUTPUT_DIR_NAME}/x.json`)).toBe(true);
  });

  test("is in the default list, does not depend on being configured", () => {
    expect(IGNORED_DIRS.has(OUTPUT_DIR_NAME)).toBe(true);
  });

  test.each(["node_modules", "vendor", ".git", "dist", "__pycache__", ".venv"])(
    "%s is ignored",
    (dir) => {
      expect(shouldIgnore(`${dir}/something.js`)).toBe(true);
    },
  );

  test("an actual routes file is NOT ignored", () => {
    expect(shouldIgnore("src/routes/users.route.ts")).toBe(false);
    expect(shouldIgnore("app/Http/Controllers/UserController.php")).toBe(false);
    expect(shouldIgnore("routes/api.php")).toBe(false);
  });

  test("editor temp files are ignored", () => {
    expect(shouldIgnore("src/users.ts~")).toBe(true);
    expect(shouldIgnore("src/.users.ts.swp")).toBe(true);
  });

  test("an empty path is ignored instead of crashing", () => {
    expect(shouldIgnore("")).toBe(true);
    expect(shouldIgnore(".")).toBe(true);
  });

  test("extra folders can be added without losing the defaults", () => {
    const extra = new Set(["my-stuff"]);
    expect(shouldIgnore("my-stuff/x.ts", extra)).toBe(true);
    expect(shouldIgnore("node_modules/x.ts", extra)).toBe(true);
    expect(shouldIgnore("src/x.ts", extra)).toBe(false);
  });

  test("works with Windows separators", () => {
    expect(shouldIgnore(`node_modules\\package\\index.js`)).toBe(true);
    expect(shouldIgnore(`src\\routes\\users.ts`)).toBe(false);
  });
});

describe("createDebouncer", () => {
  test("groups several consecutive changes into a single call", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(100, fn);
    d.trigger("a");
    d.trigger("b");
    d.trigger("c");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(["a", "b", "c"]);
    vi.useRealTimers();
  });

  test("does not repeat the same path in the batch", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(50, fn);
    d.trigger("a");
    d.trigger("a");
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith(["a"]);
    vi.useRealTimers();
  });

  test("the clock resets with every change", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(100, fn);
    d.trigger("a");
    vi.advanceTimersByTime(80);
    d.trigger("b");
    vi.advanceTimersByTime(80);
    // 160 ms have passed but only 80 since the last: not yet.
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("the batch is emptied after firing", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(10, fn);
    d.trigger("a");
    vi.advanceTimersByTime(10);
    d.trigger("b");
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenNthCalledWith(2, ["b"]);
    vi.useRealTimers();
  });

  // Without `cancel`, the process does not stop on Ctrl+C: a timer is
  // left pending and the event loop still has work.
  test("cancel prevents the pending fire", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(50, fn);
    d.trigger("a");
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending()).toBe(0);
    vi.useRealTimers();
  });

  test("el valor por defecto es razonable para un Ctrl+S", () => {
    expect(DEFAULT_DEBOUNCE_MS).toBeGreaterThan(50);
    expect(DEFAULT_DEBOUNCE_MS).toBeLessThan(1000);
  });
});
