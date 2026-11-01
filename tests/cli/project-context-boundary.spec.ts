/**
 * The list of who may read the global route state.
 *
 * `lint:project-context` checks that no one outside that list reads it.
 * This checks **the list itself**: a permission with no written reason
 * is a permission no one will be able to review six months from now, and
 * debt with no declared exit is debt that stays.
 *
 * The distinction between `entrypoint`/`facade` and `debt` is not
 * decorative: the first two are permanent and legitimate —a CLI
 * command resolves its root because that is its job—, the third is
 * what remains to be migrated. Mixing them would cause the debt to
 * stop being counted.
 */
import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";

import { EXCEPTIONS } from "../../scripts/gates/lint-project-context.script";
import { fromRoot } from "../../scripts/helpers/root.helper";

describe("the lock exceptions", () => {
  test("there is at least one, and not all of them are debt", () => {
    expect(EXCEPTIONS.length).toBeGreaterThan(0);
    expect(EXCEPTIONS.some((e) => e.kind !== "debt")).toBe(true);
  });

  test.for([...EXCEPTIONS])("$path points to something that exists", ({ path }) => {
    expect(existsSync(fromRoot(path)), path).toBe(true);
  });

  /**
   * THE test. A permission with no reason is a permission that gets
   * copied without thinking. The sentence must say something, not
   * fill the gap.
   */
  test.for([...EXCEPTIONS])("$path explains why", ({ path, why }) => {
    expect(why.length, path).toBeGreaterThan(40);
  });

  /**
   * Debt has to say **how it is paid off**. Without that it stays as
   * a permanent exception under another name, which is how they
   * remain.
   */
  test.for(EXCEPTIONS.filter((e) => e.kind === "debt"))(
    "$path says what is needed to stop being debt",
    ({ path, why }) => {
      expect(why, path).toMatch(/Se va cuando|Se va con|cuando esos/);
    },
  );

  test("no repeated paths: two permissions for the same thing hide one", () => {
    const rutas = EXCEPTIONS.map((e) => e.path);
    expect(new Set(rutas).size).toBe(rutas.length);
  });

  /**
   * The list can only shrink. This number is a measured ceiling, not
   * a goal: if it rises, someone has added debt instead of paying it
   * off.
   */
  test("declared debt does not grow", () => {
    const deuda = EXCEPTIONS.filter((e) => e.kind === "debt");
    expect(deuda.length).toBeLessThanOrEqual(3);
  });
});
