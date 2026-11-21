import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { CheckClient } from "../../core/api/check.client";
import { ProjectStore } from "../../core/state/project.store";
import type { ICheckReport } from "../../../../../contracts/interfaces/core/application-api.interface";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The drift check.
 *
 * ## What it used to be
 *
 * A button that called an operation with no handler and told the
 * user, every time, that the action was CLI-only. The comparison
 * lived in the CLI and the app could not reach it.
 *
 * ## What it is
 *
 * The comparison moved to the core and the Application API exposes
 * it. The screen asks, and draws **the answer**: the routes the
 * collection is missing, and the requests the code does not declare.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the check would have been
 * asked for the current directory instead of the project the user
 * opened.
 */
@Component({
  selector: "tanit-check",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./check.component.html",
  styleUrls: ["./check.component.scss"],
})
export class CheckComponent {
  readonly i18n = inject(I18nService);
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly report = signal<ICheckReport | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(CheckClient);

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set(this.i18n.translate("common.openProjectFirst"));
      return;
    }
    this.running.set(true);
    this.message.set(null);
    this.report.set(null);
    try {
      const report = await this.client.check(root);
      this.report.set(report);
      this.message.set(
        report.inSync
          ? this.i18n.translate("check.inSync")
          : `Out of sync: ${report.missingInCollection.length} route(s) missing from the collection, ${report.missingInSource.length} request(s) not in the code.`,
      );
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }
}