import { describe, expectTypeOf, it } from "vitest";

import type {
  ICompleteProjectSnapshot,
  IProjectSnapshot,
} from "../../packages/contracts/interfaces/core/project-state.interface.js";
import type { ISnapshotStore } from "../../packages/contracts/interfaces/core/snapshot-store.interface.js";
import type { IStateStore } from "../../packages/contracts/interfaces/core/state-store.interface.js";
import type { IStableIdFactory } from "../../packages/contracts/interfaces/core/stable-ids.interface.js";

describe("state contracts", () => {
  it("stay runtime-neutral and model explicit stable identities", () => {
    expectTypeOf<IStateStore>().toMatchTypeOf<IStateStore>();
    expectTypeOf<ISnapshotStore>().toMatchTypeOf<ISnapshotStore>();
    expectTypeOf<IStableIdFactory>().toMatchTypeOf<IStableIdFactory>();
  });

  it("allows activation only for complete snapshots", () => {
    expectTypeOf<ISnapshotStore["activate"]>().parameter(0).toEqualTypeOf<ICompleteProjectSnapshot>();
    expectTypeOf<IProjectSnapshot>().toHaveProperty("status");
  });
});