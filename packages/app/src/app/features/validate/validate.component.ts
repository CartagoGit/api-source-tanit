import { ChangeDetectionStrategy, Component, inject, input, signal } from "@angular/core";
import { HostBridgeClient } from "../../core/api/host-bridge.client";
import { describePending } from "../../core/api/pending-operation.helper";

@Component({
  selector: "tanit-validate",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="validate-title"><h2 id="validate-title">Validate</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Validating…" : "Validate project" }}</button>@if (issues().length) { <ul aria-label="Diagnostics">@for (issue of issues(); track issue) { <li>{{ issue }}</li> }</ul> }@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class ValidateComponent {
  readonly projectRoot = input(".");
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly issues = signal<ReadonlyArray<string>>([]);
  private readonly bridge = inject(HostBridgeClient);

  async run(): Promise<void> {
    this.running.set(true);
    try {
      // `validate` has no handler yet: validating a collection against
      // the Postman schema is CLI-only.
      const result = await this.bridge.requestPending("validate", { projectRoot: this.projectRoot() }) as { valid?: boolean; issues?: ReadonlyArray<string> };
      this.issues.set(result.issues ?? []);
      this.message.set(result.valid ? "Project is valid." : "Validation found diagnostics.");
    } catch (error) {
      this.issues.set([]);
      this.message.set(describePending("validate", error));
    } finally {
      this.running.set(false);
    }
  }
}