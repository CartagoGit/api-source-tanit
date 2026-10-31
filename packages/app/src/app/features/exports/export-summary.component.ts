import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

import { ExportResult } from "../../core/api/exports.client";

/**
 * What was written.
 *
 * It says what the backend actually wrote, and nothing more. The
 * summary used to claim whether Postman was installed — a guess made
 * in the browser, about an application that may not even be on this
 * machine.
 */
@Component({
  selector: "tanit-export-summary",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./export-summary.component.html",
  styleUrls: ["./export-summary.component.scss"],
})
export class ExportSummaryComponent {
  @Input() result: ExportResult | null = null;
  @Output() readonly openFolder = new EventEmitter<string>();
  @Output() readonly openPostman = new EventEmitter<void>();
  @Output() readonly copyPaths = new EventEmitter<readonly string[]>();

  copy(files: readonly { path: string }[]): void { this.copyPaths.emit(files.map((file) => file.path)); }
}
