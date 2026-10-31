import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { CheckClient } from "../../core/api/check.client";
import { describePending } from "../../core/api/pending-operation.helper";
import { ProjectStore } from "../../core/state/project.store";

/**
 * The drift check.
 *
 * The action is CLI-only for now, and the section says so when the
 * call comes back saying so. It used to carry its own `projectRoot`
 * input, defaulting to `"."` — and the shell never passed one, so
 * the check would have been asked for the current directory instead
 * of the project the user opened.
 */
@Component({
  selector: "tanit-check",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="check-title"><h2 id="check-title">Check</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Checking…" : "Check project" }}</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class CheckComponent {
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(CheckClient);

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    try {
      const result = await this.client.check(root) as { passed?: boolean; issues?: ReadonlyArray<string> };
      this.message.set(result.passed ? "Project is in sync." : (result.issues ?? []).join("; "));
    } catch (error) {
      this.message.set(describePending("check", error));
    } finally {
      this.running.set(false);
    }
  }
}