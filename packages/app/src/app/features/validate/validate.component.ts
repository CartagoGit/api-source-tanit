import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { ValidateClient } from "../../core/api/validate.client";
import { ProjectStore } from "../../core/state/project.store";
import type { IValidationResult } from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The validation.
 *
 * ## What it used to be
 *
 * A button that called an operation with no handler and told the
 * user, every time, that the action was CLI-only. The invariants of
 * a well-formed collection lived in the CLI and the app could not
 * reach them.
 *
 * ## What it is
 *
 * The invariants moved to the core and the Application API exposes
 * them. The screen asks, and draws **the answer**: the errors and
 * the warnings, separated — a missing `_postman_id` is a warning and
 * does not make the collection invalid.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the validation would have
 * been asked for the current directory instead of the open project.
 */
@Component({
  selector: "tanit-validate",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="validate-title"><h2 id="validate-title">Validate</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Validating…" : "Validate project" }}</button>@if (message(); as value) { <p role="status">{{ value }}</p> }@if (result(); as answer) { <dl class="counts"><dt>Requests</dt><dd>{{ answer.requests }}</dd><dt>Folders</dt><dd>{{ answer.folders }}</dd><dt>Variables</dt><dd>{{ answer.variables }}</dd></dl>@if (answer.errors.length) { <h3>Errors</h3><ul role="list">@for (issue of answer.errors; track issue.message) { <li>{{ issue.message }}</li> }</ul> }@if (answer.warnings.length) { <h3>Warnings</h3><ul role="list">@for (issue of answer.warnings; track issue.message) { <li>{{ issue.message }}</li> }</ul> } }</section>`,
  styles: `.counts { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); margin-top: var(--space-4); } dt { color: var(--color-muted); } dd { margin: 0; font-variant-numeric: tabular-nums; } h3 { margin-top: var(--space-4); font-size: 14px; }`,
})
export class ValidateComponent {
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly result = signal<IValidationResult | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(ValidateClient);

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    this.result.set(null);
    try {
      const result = await this.client.validate(root);
      this.result.set(result);
      this.message.set(
        result.ok
          ? `Valid Postman v2.1.0 collection${result.warnings.length ? ", with warnings" : ""}.`
          : `Invalid collection: ${result.errors.length} error(s).`,
      );
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }
}