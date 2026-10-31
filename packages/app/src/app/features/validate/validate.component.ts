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
  templateUrl: "./validate.component.html",
  styleUrls: ["./validate.component.scss"],
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