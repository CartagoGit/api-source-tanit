import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { HostBridgeClient } from "../../core/api/host-bridge.client";
import { describePending } from "../../core/api/pending-operation.helper";
import { ProjectStore } from "../../core/state/project.store";

/**
 * The validation.
 *
 * Validating a collection against the Postman schema is CLI-only, and
 * the section says so when the call comes back saying so. It used to
 * carry its own `projectRoot` input, defaulting to `"."` — and the
 * shell never passed one, so the validation would have been asked for
 * the current directory instead of the open project.
 */
@Component({
  selector: "tanit-validate",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="validate-title"><h2 id="validate-title">Validate</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Validating…" : "Validate project" }}</button>@if (issues().length) { <ul aria-label="Diagnostics">@for (issue of issues(); track issue) { <li>{{ issue }}</li> }</ul> }@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class ValidateComponent {
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly issues = signal<ReadonlyArray<string>>([]);
  private readonly project = inject(ProjectStore);
  private readonly bridge = inject(HostBridgeClient);

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    try {
      // `validate` has no handler yet: validating a collection against
      // the Postman schema is CLI-only.
      const result = await this.bridge.requestPending("validate", { projectRoot: root }) as { valid?: boolean; issues?: ReadonlyArray<string> };
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