import { describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { EmptyStateComponent } from "../../packages/app/src/app/shared/empty-state/empty-state.component";

describe("external template in jit", () => {
  it("renders the external template", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [EmptyStateComponent] });
    const fixture = TestBed.createComponent(EmptyStateComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".empty")).not.toBeNull();
  });
});
