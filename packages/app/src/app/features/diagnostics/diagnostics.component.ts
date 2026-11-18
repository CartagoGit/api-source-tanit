import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";

import type { IContractSource, IContractComparison } from "../../../../../contracts/interfaces/core/contract-evidence.interface";

import { ProjectStore } from "../../core/state/project.store";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * What the scan noticed about the project.
 *
 * ## What this section used to be
 *
 * A navigation entry with **nothing behind it**. "Diagnostics" was in
 * the sidebar, the shell had no case for it, and it fell through to
 * the generic empty state — a blank page with the word "Diagnostics"
 * on it.
 *
 * ## What it is
 *
 * The scan's own warnings ("no endpoints were found", "this folder
 * is not a route file") and the detectors that crashed reading a
 * file. The backend already knew all of it — the snapshot carries
 * them — and the app threw them away.
 *
 * Now the summary carries them and this section draws them.
 */
@Component({
  selector: "tanit-diagnostics",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./diagnostics.component.html",
  styleUrls: ["./diagnostics.component.scss"],
})
export class DiagnosticsComponent {
  readonly i18n = inject(I18nService);
  private readonly project = inject(ProjectStore);

  /**
   * The diagnostics of the open project.
   *
   * The list is empty when there is no project — not an error: there
   * is nothing to report about a project that is not open.
   */
  readonly diagnostics = computed(() => this.project.summary()?.diagnostics ?? []);
  readonly contractReports = computed(() => this.project.summary()?.contractEvidence ?? []);
  readonly showMatches = signal(false);
  readonly addPage = (limit: number): number => limit + 100;
  readonly operationLimit = signal(100);
  readonly comparisons = computed(() => this.contractReports().flatMap(report => report.operations)
    .filter(operation => this.showMatches() || operation.status !== "matched"));
  readonly visibleComparisons = computed(() => this.comparisons().slice(0, this.operationLimit()));
  readonly comparisonCount = computed(() => this.contractReports().reduce((total, report) => total + report.operations.length, 0));

  coverageLabel(value: IContractSource["completeness"]): string {
    if (value === "complete") return this.i18n.translate("contracts.coverage.complete");
    if (value === "partial") return this.i18n.translate("contracts.coverage.partial");
    return this.i18n.translate("contracts.coverage.unknown");
  }

  statusLabel(value: IContractComparison["status"]): string {
    switch (value) {
      case "matched": return this.i18n.translate("contracts.status.matched");
      case "documented-only": return this.i18n.translate("contracts.status.documented-only");
      case "observed-only": return this.i18n.translate("contracts.status.observed-only");
      case "conflict": return this.i18n.translate("contracts.status.conflict");
      case "unknown": return this.i18n.translate("contracts.status.unknown");
    }
  }
}
